import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/api/client";
import { api } from "@/api/endpoints";
import type { SimulationEvent } from "@/api/types";
import { MAX_BUFFERED_EVENTS, mergeEvents } from "@/lib/stream";

export type StreamConnection = "connecting" | "live" | "reconnecting";

export interface StreamOptions {
  maxRows?: number;
  /** ms between polls while nothing is pending; tests override these. */
  idleMs?: number;
  activeMs?: number;
  maxBackoffMs?: number;
}

/**
 * Polls /simulation/events using the backend's cursor + run_id semantics.
 *  - a cursor is only advanced from `next_cursor`, and events are also de-duplicated by sequence
 *  - a 409 SIMULATION_RESET clears the buffer and restarts from the new run
 *  - network failures back off (1s -> max) and resume from the same cursor, so nothing is duplicated
 *  - the buffer is bounded; on mount only the most recent `maxRows` already-processed events are fetched
 *  - the loop is aborted and its timer cleared on unmount
 */
export function useSimulationStream({ maxRows = MAX_BUFFERED_EVENTS, idleMs = 1500, activeMs = 700, maxBackoffMs = 10_000 }: StreamOptions = {}) {
  const [events, setEvents] = useState<SimulationEvent[]>([]);
  const [connection, setConnection] = useState<StreamConnection>("connecting");
  const [runId, setRunId] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [totalReceived, setTotalReceived] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    let run: string | null = null;
    let cursor = 0;
    let lastSeq = 0;
    let buffer: SimulationEvent[] = [];
    let backoff = 0;

    const schedule = (ms: number) => {
      if (!stopped) timer = setTimeout(tick, ms);
    };

    const startRun = (id: string, processed: number) => {
      run = id;
      cursor = Math.max(0, processed - maxRows); // do not replay an unbounded backlog
      lastSeq = cursor;
      buffer = [];
      setRunId(id);
      setEvents([]);
      setTotalReceived(0);
      setSkipped(cursor);
    };

    async function tick() {
      if (stopped) return;
      try {
        if (run === null) {
          const s = await api.simulation();
          if (stopped) return;
          startRun(s.run_id, s.processed);
        }
        const res = await api.simEvents({ cursor, limit: 100, run_id: run ?? undefined }, ctrl.signal);
        if (stopped) return;
        backoff = 0;
        setConnection("live");
        cursor = res.next_cursor;
        if (res.events.length) {
          // Pure update: the loop is the only writer, so merge outside React's state updater.
          const m = mergeEvents(buffer, res.events, lastSeq, maxRows);
          buffer = m.buffer;
          lastSeq = m.lastSequence;
          if (m.added) {
            setEvents(buffer);
            setTotalReceived((n) => n + m.added);
          }
        }
        schedule(res.has_more ? 40 : res.status === "running" ? activeMs : idleMs);
      } catch (e) {
        if (stopped || (e instanceof DOMException && e.name === "AbortError")) return;
        if (e instanceof ApiError && e.code === "SIMULATION_RESET") {
          run = null; // re-read the state and follow the new run from its start
          setConnection("connecting");
          schedule(100);
          return;
        }
        if (e instanceof ApiError && e.isAuth) return; // global handler redirects to login; stop polling
        setConnection("reconnecting");
        backoff = Math.min(backoff ? backoff * 2 : 1000, maxBackoffMs);
        schedule(backoff);
      }
    }

    // A reset triggered from this page restarts the run immediately instead of waiting for a 409.
    const onReset = () => {
      run = null;
    };
    window.addEventListener("finexa:sim-reset", onReset);
    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ctrl.abort();
      window.removeEventListener("finexa:sim-reset", onReset);
    };
  }, [maxRows, idleMs, activeMs, maxBackoffMs]);

  const notifyReset = useCallback(() => window.dispatchEvent(new Event("finexa:sim-reset")), []);
  return { events, connection, runId, skipped, totalReceived, notifyReset };
}
