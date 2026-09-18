import type { SimulationEvent } from "@/api/types";

export const MAX_BUFFERED_EVENTS = 200;

/**
 * Merge a polled batch (ascending sequence) into the newest-first display buffer.
 * Events at or below `lastSequence` are dropped (no duplicates); the buffer is bounded.
 */
export function mergeEvents(
  buffer: SimulationEvent[],
  incoming: SimulationEvent[],
  lastSequence: number,
  max = MAX_BUFFERED_EVENTS,
): { buffer: SimulationEvent[]; lastSequence: number; added: number } {
  const fresh = incoming.filter((e) => e.sequence > lastSequence).sort((a, b) => a.sequence - b.sequence);
  if (fresh.length === 0) return { buffer, lastSequence, added: 0 };
  const merged = [...fresh.reverse(), ...buffer].slice(0, max);
  return { buffer: merged, lastSequence: merged[0].sequence, added: fresh.length };
}
