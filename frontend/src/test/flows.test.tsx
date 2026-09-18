import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SimulationEvent } from "@/api/types";
import { setCsrfToken } from "@/api/client";
import { TooltipProvider } from "@/components/ui/misc";
import { PolicyRehearsal } from "@/features/PolicyRehearsal";
import { useSimulationStream } from "@/hooks/useSimulationStream";
import { TransactionDetailPage } from "@/pages/TransactionDetailPage";
import { err, mockApi } from "./utils";

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } } });
const wrap = (ui: React.ReactNode, route = "/") => (
  <QueryClientProvider client={client()}><MemoryRouter initialEntries={[route]}><TooltipProvider>{ui}</TooltipProvider></MemoryRouter></QueryClientProvider>
);

/* ---------------------------------------------------------------- replay stream */
const ev = (n: number, run = "run1"): SimulationEvent => ({
  event_id: `evt-${String(n).padStart(6, "0")}`, sequence: n, run_id: run, transaction_ref: `TXN-${String(n).padStart(6, "0")}`,
  source_time_seconds: n, source_time_label: "T+00:00:00", processed_at: "2026-09-18T10:00:00Z", amount: 1, score: 0.1,
  risk_band: "low", recommended_action: "allow", model_version: "m", policy_version: "p", known_outcome: null,
});
const simState = (over: object = {}) => ({ run_id: "run1", status: "running", processed: 0, total: 1000, ...over });

function StreamProbe({ max = 5 }: { max?: number }) {
  const s = useSimulationStream({ maxRows: max, idleMs: 20, activeMs: 20, maxBackoffMs: 40 });
  return (
    <div>
      <output data-testid="conn">{s.connection}</output>
      <output data-testid="run">{s.runId}</output>
      <output data-testid="skipped">{s.skipped}</output>
      <ul>{s.events.map((e) => <li key={e.event_id}>{e.event_id}</li>)}</ul>
    </div>
  );
}
const ids = () => screen.queryAllByRole("listitem").map((li) => li.textContent);

describe("useSimulationStream", () => {
  it("follows the cursor without duplicates, stays bounded, and starts near the tail of a long backlog", async () => {
    const requested: number[] = [];
    let served = 30;
    mockApi({
      "GET /simulation": () => ({ body: simState({ processed: served }) }),
      "GET /simulation/events": ({ url }) => {
        const cursor = Number(url.searchParams.get("cursor"));
        requested.push(cursor);
        expect(url.searchParams.get("run_id")).toBe("run1");
        const events = Array.from({ length: Math.min(3, served - cursor) }, (_, i) => ev(cursor + i + 1));
        const next = cursor + events.length;
        if (next === served) setTimeout(() => (served += 3), 30); // more arrive later
        return { body: { events, next_cursor: next, has_more: next < served, run_id: "run1", status: "running", label: "x" } };
      },
    });
    render(wrap(<StreamProbe max={5} />));
    await waitFor(() => expect(ids()[0]).toBe("evt-000033"), { timeout: 3000 });
    expect(requested[0]).toBe(25); // 30 processed - 5 buffered rows: the older backlog is not fetched
    expect(screen.getByTestId("skipped")).toHaveTextContent("25");
    expect(ids()).toHaveLength(5);
    expect(new Set(ids()).size).toBe(5);
    expect(requested.every((c, i) => i === 0 || c >= requested[i - 1])).toBe(true); // cursor never goes backwards
  });

  it("restarts from the new run when the backend answers 409 SIMULATION_RESET", async () => {
    let phase = 0;
    mockApi({
      "GET /simulation": () => ({ body: simState({ run_id: phase === 0 ? "run1" : "run2", processed: 0 }) }),
      "GET /simulation/events": ({ url }) => {
        const run = url.searchParams.get("run_id");
        if (phase === 0 && run === "run1" && url.searchParams.get("cursor") === "2") { phase = 1; return err(409, "SIMULATION_RESET", "reset"); }
        if (run === "run1") return { body: { events: [ev(1), ev(2)], next_cursor: 2, has_more: false, run_id: "run1", status: "running", label: "x" } };
        return { body: { events: [ev(1, "run2")], next_cursor: 1, has_more: false, run_id: "run2", status: "running", label: "x" } };
      },
    });
    render(wrap(<StreamProbe />));
    await waitFor(() => expect(ids()).toEqual(["evt-000002", "evt-000001"]));
    await waitFor(() => expect(screen.getByTestId("run")).toHaveTextContent("run2"), { timeout: 3000 });
    await waitFor(() => expect(ids()).toEqual(["evt-000001"])); // buffer cleared, then the new run's first event
  });

  it("marks the stream as reconnecting on network failure and resumes from the same cursor", async () => {
    let fail = false;
    const cursors: number[] = [];
    mockApi({
      "GET /simulation": () => ({ body: simState() }),
      "GET /simulation/events": ({ url }) => {
        const cursor = Number(url.searchParams.get("cursor"));
        cursors.push(cursor);
        if (fail) throw new TypeError("Failed to fetch");
        const events = cursor === 0 ? [ev(1), ev(2)] : cursor === 2 ? [ev(3)] : [];
        return { body: { events, next_cursor: cursor + events.length, has_more: false, run_id: "run1", status: "running", label: "x" } };
      },
    });
    render(wrap(<StreamProbe />));
    await waitFor(() => expect(ids()).toEqual(["evt-000002", "evt-000001"]));
    fail = true;
    await waitFor(() => expect(screen.getByTestId("conn")).toHaveTextContent("reconnecting"), { timeout: 3000 });
    fail = false;
    await waitFor(() => expect(ids()).toEqual(["evt-000003", "evt-000002", "evt-000001"]), { timeout: 4000 });
    expect(screen.getByTestId("conn")).toHaveTextContent("live");
    expect(cursors.filter((c) => c === 2).length).toBeGreaterThan(1); // retried the same cursor, no skipped/duplicated events
  });

  it("stops polling when unmounted", async () => {
    const api = mockApi({
      "GET /simulation": () => ({ body: simState() }),
      "GET /simulation/events": () => ({ body: { events: [], next_cursor: 0, has_more: false, run_id: "run1", status: "running", label: "x" } }),
    });
    const { unmount } = render(wrap(<StreamProbe />));
    await waitFor(() => expect(api.count("GET /simulation/events")).toBeGreaterThan(1));
    unmount();
    const n = api.count("GET /simulation/events");
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    expect(api.count("GET /simulation/events")).toBe(n);
  });
});

/* -------------------------------------------------------------- policy rehearsal */
const metrics = (over: { demand?: number; within?: number; overflow?: number } = {}) => ({
  population: { rows: 1000, known_fraud: 10, known_legitimate: 990, fraud_prevalence: 0.01, fraud_value_total: 500 },
  alerts: { hold_recommended: 4, review_demand: over.demand ?? 40, cases_within_capacity: over.within ?? 40, overflow: over.overflow ?? 0, allowed: 900, batches: 1, review_capacity_per_batch: null, batch_size: null },
  known_fraud: { recommended_hold: 3, recommended_review: 4, review_within_capacity: 4, review_overflow: 0, allowed: 3, flagged_total: 7, flagged_share_of_fraud: 0.7 },
  known_legitimate: { recommended_hold: 1, recommended_review: 36, review_within_capacity: 36, review_overflow: 0, allowed: 953, flagged_total: 37 },
  fraud_value: { recommended_hold: 300, review_within_capacity: 100, review_overflow: 0, allowed: 100, allowed_or_unreviewed: 100 },
  flag_precision: 0.16,
});

describe("PolicyRehearsal", () => {
  beforeEach(() => setCsrfToken("csrf"));
  afterEach(() => setCsrfToken(null));
  const routes = (calls: unknown[]) => ({
    "GET /health": () => ({ body: { status: "ok", ready: true, policy_version: "policy-v1:r0.010000:h0.900000", model_version: "m", reasons: [] } }),
    "GET /model/evaluation": () => ({ body: { thresholds: { review: 0.01, hold: 0.9 } } }),
    "POST /policies/compare": ({ body }: { body: unknown }) => {
      calls.push(body);
      const b = body as { policies: { name: string; review_capacity: number | null; review_threshold: number; hold_threshold: number }[]; split: string };
      return {
        body: {
          scope: "policy_rehearsal", split: b.split, model_version: "m", notes: ["Backend note."],
          evaluation_split_note: b.split === "test" ? "FINAL EVALUATION on the reserved test split; do not tune against it." : "Validation split: appropriate for interactive tuning.",
          results: b.policies.map((p) => ({ name: p.name, review_threshold: p.review_threshold, hold_threshold: p.hold_threshold, policy_version: "pv", metrics: metrics({ within: p.review_capacity ?? 40, overflow: Math.max(0, 40 - (p.review_capacity ?? 40)) }) })),
        },
      };
    },
  });

  it("validates threshold ordering and capacity inline, and does not call the API when invalid", async () => {
    const calls: unknown[] = [];
    const api = mockApi(routes(calls));
    render(wrap(<PolicyRehearsal />));
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText("Review threshold")).toHaveValue("0.01"));
    const review = screen.getByLabelText("Review threshold");
    await user.clear(review);
    await user.type(review, "0.95");
    await user.clear(screen.getByLabelText(/review capacity per batch/i));
    await user.type(screen.getByLabelText(/review capacity per batch/i), "2.5");
    await user.click(screen.getByRole("button", { name: /run comparison/i }));
    expect(await screen.findByText(/hold threshold must be greater than the review threshold/i)).toBeInTheDocument();
    expect(screen.getByText(/whole number of cases/i)).toBeInTheDocument();
    expect(api.count("POST /policies/compare")).toBe(0);
  });

  it("runs baseline vs proposed on the validation split and explains overflow honestly", async () => {
    const calls: unknown[] = [];
    mockApi(routes(calls));
    render(wrap(<PolicyRehearsal />));
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText("Review threshold")).toHaveValue("0.01"));
    const cap = screen.getByLabelText(/review capacity per batch/i);
    await user.clear(cap);
    await user.type(cap, "10");
    await user.click(screen.getByRole("button", { name: /run comparison/i }));
    expect(await screen.findByRole("heading", { name: "Baseline" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Proposed" })).toBeInTheDocument();
    expect(screen.getByText("Tuning: validation split")).toBeInTheDocument();
    expect(screen.getAllByText("Historical simulation").length).toBeGreaterThan(0);
    const first = calls[0] as { policies: { name: string; review_capacity: number | null }[]; split: string; acknowledge_final_evaluation: boolean };
    expect(first.split).toBe("validation");
    expect(first.acknowledge_final_evaluation).toBe(false);
    expect(first.policies.map((p) => [p.name, p.review_capacity])).toEqual([["Baseline", null], ["Proposed", 10]]);
    expect(await screen.findByText(/never counted as reviewed/i)).toBeInTheDocument();
    expect(screen.getByText(/not verified prevention or recovery/i)).toBeInTheDocument();
    const proposed = screen.getByRole("heading", { name: "Proposed" }).closest(".rounded-lg") as HTMLElement;
    expect(within(proposed).getByText("Overflow").closest("div")).toHaveTextContent("30");
    expect(calls.length).toBe(2); // comparison + capacity sweep
    const sweep = calls[1] as { policies: { review_capacity: number }[] };
    expect(sweep.policies.map((p) => p.review_capacity)).toEqual([0, 4, 10, 20, 30, 40]);
  });

  it("requires explicit acknowledgement before using the reserved test split", async () => {
    const calls: unknown[] = [];
    const api = mockApi(routes(calls));
    render(wrap(<PolicyRehearsal />));
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText("Review threshold")).toHaveValue("0.01"));
    await user.click(screen.getByRole("radio", { name: /test split/i }));
    await user.click(screen.getByRole("button", { name: /run comparison/i }));
    expect(await screen.findByText(/confirm that this is a one-off final evaluation/i)).toBeInTheDocument();
    expect(api.count("POST /policies/compare")).toBe(0);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /run comparison/i }));
    expect(await screen.findByText("Final evaluation: test split")).toBeInTheDocument();
    expect((calls[0] as { split: string; acknowledge_final_evaluation: boolean })).toMatchObject({ split: "test", acknowledge_final_evaluation: true });
  });

  it("shows the backend's error instead of stale or fake results", async () => {
    mockApi({ ...routes([]), "POST /policies/compare": () => err(503, "MODEL_NOT_READY", "The service is not ready: model artifacts missing") });
    render(wrap(<PolicyRehearsal />));
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText("Review threshold")).toHaveValue("0.01"));
    await user.click(screen.getByRole("button", { name: /run comparison/i }));
    expect(await screen.findByText("Model not ready")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Baseline" })).not.toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------- case saving */
const detail = (over: object = {}) => ({
  transaction_ref: "TXN-000123", split: "test", source_time_seconds: 100, source_time_label: "T+00:01:40", amount: 12.5, score: 0.98,
  risk_band: "high", recommended_action: "hold", known_outcome: null, review_status: "unreviewed", analyst_assessment: null,
  features: Object.fromEntries(Array.from({ length: 28 }, (_, i) => [`V${i + 1}`, i / 10])), model_version: "m1", policy_version: "policy-v1:r0.010000:h0.900000", cluster_id: 2, ...over,
});
const emptyCase = { transaction_ref: "TXN-000123", persisted: false, review_status: "unreviewed", analyst_assessment: null, assessed_at: null, closed_at: null, created_at: null, updated_at: null, model_version_at_last_update: null, policy_version_at_last_update: null, score_at_last_update: null, action_at_last_update: null, notes: [], history: [], current: { score: 0.98, risk_band: "high", recommended_action: "hold", model_version: "m1", policy_version: "pv" } };
const savedCase = { ...emptyCase, persisted: true, updated_at: "2026-09-18T10:00:00Z", model_version_at_last_update: "m1", policy_version_at_last_update: "pv", score_at_last_update: 0.98, action_at_last_update: "hold", notes: [{ id: 1, note: "Checked similar cases", author: "ana@example.com", created_at: "2026-09-18T10:00:00Z", model_version: "m1", policy_version: "pv" }], history: [{ field: "note_added", old_value: null, new_value: null, changed_at: "2026-09-18T10:00:00Z", model_version: "m1", policy_version: "pv" }] };

function detailRoutes(extra: Record<string, Parameters<typeof mockApi>[0][string]> = {}) {
  return {
    "GET /health": () => ({ body: { status: "ok", ready: true, policy_version: "policy-v1:r0.010000:h0.900000", model_version: "m1", reasons: [] } }),
    "GET /model/evaluation": () => ({ body: { thresholds: { review: 0.01, hold: 0.9 } } }),
    "GET /transactions/TXN-000123": () => ({ body: detail() }),
    "GET /transactions/TXN-000123/explanation": () => ({ body: { transaction_ref: "TXN-000123", model_version: "m1", note: "n", status: "available", method: "single_feature_substitution", method_description: "desc", contribution_scale: "log_odds", additive: false, baseline_logit: null, logit: 4, contributions: [{ feature: "V14", value: -7, contribution: 4, direction: "increases_score" }, { feature: "V3", value: 2, contribution: -1.5, direction: "decreases_score" }, { feature: "Time", value: 5, contribution: 0, direction: "neutral" }], unavailable_reason: null } }),
    "GET /transactions/TXN-000123/similar": () => ({ body: { transaction_ref: "TXN-000123", reference_set: "train", space: "s", k: 2, neighbors: [{ transaction_ref: "TXN-000009", distance: 1.2, amount: 3, source_time_seconds: 5, known_outcome: "fraud", cluster_id: 2 }, { transaction_ref: "TXN-000010", distance: 2.4, amount: 4, source_time_seconds: 6, known_outcome: "legitimate", cluster_id: 2 }], known_fraud_among_neighbors: 1, note: "Similar records only." } }),
    "GET /transactions/TXN-000123/case": () => ({ body: emptyCase }),
    ...extra,
  };
}
const renderDetail = () => render(wrap(<Routes><Route path="/investigation/:transactionId" element={<TransactionDetailPage />} /></Routes>, "/investigation/TXN-000123"));

describe("case investigation page", () => {
  beforeEach(() => setCsrfToken("csrf"));
  afterEach(() => setCsrfToken(null));

  it("separates model prediction, analyst judgment and the (hidden) known outcome, with non-causal explanation wording", async () => {
    mockApi(detailRoutes());
    renderDetail();
    const line = (t: string) => (_: string, el: Element | null) => !!el && el.tagName === "SPAN" && el.children.length > 0 && el.textContent?.replace(/\s+/g, " ").trim() === t;
    expect(await screen.findByText(line("V14 increased the model score."))).toBeInTheDocument();
    expect(screen.getByText(line("V3 decreased the model score."))).toBeInTheDocument();
    expect(screen.getByText(/not causal proof/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Model prediction")).toHaveTextContent("m1");
    expect(screen.getByLabelText("Analyst judgment")).toHaveTextContent(/unreviewed/i);
    const known = screen.getByLabelText("Known historical outcome");
    expect(known).toHaveTextContent(/hidden/i);
    expect(known).not.toHaveTextContent(/known (fraud|legitimate)/i); // this transaction's own label stays hidden
    expect(await screen.findByText((_, el) => el?.tagName === "P" && /^1 of 2 similar historical cases are known fraud/.test(el.textContent ?? ""))).toBeInTheDocument();
    expect(screen.getByText("Model risk score").closest("div")).toHaveTextContent("0.980");
    expect(screen.getByText(/not a probability/i)).toBeInTheDocument();
    expect(screen.getByText(/no measurable effect/i)).toBeInTheDocument();
  });

  it("shows an explicit unavailable state and keeps the score", async () => {
    mockApi(detailRoutes({
      "GET /transactions/TXN-000123/explanation": () => ({ body: { transaction_ref: "TXN-000123", model_version: "m1", note: "n", status: "unavailable", method: null, method_description: null, contribution_scale: null, additive: null, baseline_logit: null, logit: null, contributions: [], unavailable_reason: "explanation computation failed (RuntimeError)" } }),
    }));
    renderDetail();
    expect(await screen.findByText("Explanation unavailable")).toBeInTheDocument();
    expect(screen.getByText(/computation failed/i)).toBeInTheDocument();
    expect(screen.getAllByText("0.980").length).toBeGreaterThan(0);
  });

  it("saves a note with a CSRF header, shows success and the decision receipt", async () => {
    let saved = false;
    const api = mockApi(detailRoutes({
      "GET /transactions/TXN-000123/case": () => ({ body: saved ? savedCase : emptyCase }),
      "PATCH /transactions/TXN-000123/case": () => { saved = true; return { body: savedCase }; },
    }));
    renderDetail();
    const user = userEvent.setup();
    const save = await screen.findByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    expect(screen.getByText(/no analyst action has been recorded/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Add a note"), "Checked similar cases");
    expect(save).toBeEnabled();
    await user.click(save);
    expect(await screen.findByText("Checked similar cases")).toBeInTheDocument();
    const patch = api.calls.find((c) => c.method === "PATCH")!;
    expect(patch.body).toEqual({ note: "Checked similar cases" });
    expect((patch.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf");
    expect(await screen.findByText("Decision receipt")).toBeInTheDocument();
    expect((await screen.findAllByText(/policy version/i)).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Add a note")).toHaveValue("");
  });

  it("won't close a case without an assessment and never sends the request", async () => {
    const api = mockApi(detailRoutes({ "PATCH /transactions/TXN-000123/case": () => ({ body: savedCase }) }));
    renderDetail();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Save changes" });
    screen.getByLabelText("Review status").focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("option", { name: "Closed" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/choose an analyst assessment before closing/i);
    expect(api.count("PATCH /transactions/TXN-000123/case")).toBe(0);
  });

  it("surfaces a save failure without losing the typed note", async () => {
    mockApi(detailRoutes({ "PATCH /transactions/TXN-000123/case": () => err(403, "CSRF_FAILED", "Missing or invalid CSRF token.") }));
    renderDetail();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Add a note"), "keep me");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/csrf/i);
    expect(screen.getByLabelText("Add a note")).toHaveValue("keep me");
  });

  it("reveals the dataset label only on request", async () => {
    mockApi(detailRoutes({
      "GET /transactions/TXN-000123": ({ url }) => ({ body: detail({ known_outcome: url.searchParams.get("reveal_outcome") === "true" ? "fraud" : null }) }),
    }));
    renderDetail();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /reveal dataset label/i }));
    await waitFor(() => expect(screen.getByLabelText("Known historical outcome")).toHaveTextContent("Known fraud"));
  });

  it("shows a helpful not-found state for an unknown transaction", async () => {
    mockApi(detailRoutes({ "GET /transactions/TXN-000123": () => err(404, "TRANSACTION_NOT_FOUND", "No transaction") }));
    renderDetail();
    expect(await screen.findByText("No transaction TXN-000123")).toBeInTheDocument();
  });
});

vi.stubGlobal("scrollTo", () => {});
