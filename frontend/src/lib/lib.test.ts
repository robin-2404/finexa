import { describe, expect, it } from "vitest";
import type { SimulationEvent } from "@/api/types";
import { formatAmount, formatElapsed, formatPercent, formatScore, formatThreshold, NA, normalizeRef } from "./format";
import { parsePolicyThresholds } from "./policy";
import { DEFAULT_DESTINATION, loginUrl, safeNext } from "./safe-redirect";
import { mergeEvents } from "./stream";
import { checkPassword } from "./validation";

describe("safeNext (post-login return destination)", () => {
  it.each([
    ["/investigation/TXN-000123", "/investigation/TXN-000123"],
    ["/investigation?split=test&page=2", "/investigation?split=test&page=2"],
    ["/monitor", "/monitor"],
    ["%2Fpatterns", "/patterns"],
  ])("accepts %s", (input, expected) => expect(safeNext(input)).toBe(expected));

  it.each([
    "//evil.example/overview",
    "https://evil.example/overview",
    "javascript:alert(1)",
    "/\\evil.example",
    "/login",
    "/signup",
    "/unknown-route",
    "/investigation/../../etc",
    "/investigation/notaref",
    "overview",
    "/overview\n/x",
    "%E0%A4%A",
    "",
  ])("rejects %j", (input) => expect(safeNext(input)).toBe(DEFAULT_DESTINATION));

  it("falls back for null/undefined and builds login URLs only for meaningful destinations", () => {
    expect(safeNext(null)).toBe(DEFAULT_DESTINATION);
    expect(safeNext(undefined)).toBe(DEFAULT_DESTINATION);
    expect(loginUrl("/overview")).toBe("/login");
    expect(loginUrl("/monitor")).toBe("/login?next=%2Fmonitor");
    expect(loginUrl("//evil.example")).toBe("/login");
  });
});

describe("display formatting", () => {
  it("shows scores on the 0-1 scale and never as 0 by default", () => {
    expect(formatScore(0.87654)).toBe("0.877");
    expect(formatScore(0.0004)).toBe("<0.001");
    expect(formatScore(0.99988)).toBe(">0.999");
    expect(formatScore(1)).toBe("1.000");
    expect(formatScore(0)).toBe("0.000");
    expect(formatScore(null)).toBe(NA);
    expect(formatScore(undefined)).toBe(NA);
  });
  it("keeps null as n/a rather than zero, and amounts carry no currency", () => {
    expect(formatAmount(null)).toBe(NA);
    expect(formatPercent(null)).toBe(NA);
    expect(formatAmount(1234.5)).toBe("1,234.50");
    expect(formatAmount(0)).toBe("0.00");
    expect(formatAmount(12)).not.toMatch(/[$€£₹¥]/);
  });
  it("renders elapsed dataset time and threshold precision", () => {
    expect(formatElapsed(97121)).toBe("T+26:58:41");
    expect(formatElapsed(0)).toBe("T+00:00:00");
    expect(formatElapsed(null)).toBe(NA);
    expect(formatThreshold(0.010714792669)).toBe("0.01071");
    expect(formatThreshold(0.9736793)).toBe("0.9737");
  });
  it("normalises transaction references from search input", () => {
    expect(normalizeRef("123")).toBe("TXN-000123");
    expect(normalizeRef("txn-45")).toBe("TXN-000045");
    expect(normalizeRef(" TXN-000123 ")).toBe("TXN-000123");
    expect(normalizeRef("abc")).toBeNull();
    expect(normalizeRef("TXN-")).toBeNull();
    expect(normalizeRef("")).toBeNull();
  });
  it("parses active thresholds out of policy_version", () => {
    expect(parsePolicyThresholds("policy-v1:r0.010715:h0.973679")).toEqual({ review: 0.010715, hold: 0.973679 });
    expect(parsePolicyThresholds("garbage")).toBeNull();
    expect(parsePolicyThresholds(null)).toBeNull();
  });
});

describe("password requirements mirror the backend", () => {
  const ok = (pw: string, email = "a@b.co") => checkPassword(pw, email).every((c) => c.ok);
  it("accepts a valid password and rejects each violation", () => {
    expect(ok("correct horse 42")).toBe(true);
    expect(ok("short1")).toBe(false);
    expect(ok("onlyletterslong")).toBe(false);
    expect(ok("12345678901")).toBe(false);
    expect(ok("x1".repeat(70))).toBe(false); // > 128
    expect(ok("A@b.co", "a@b.co")).toBe(false);
  });
});

const ev = (n: number): SimulationEvent => ({
  event_id: `evt-${String(n).padStart(6, "0")}`, sequence: n, run_id: "r", transaction_ref: `TXN-${n}`, source_time_seconds: n,
  source_time_label: "T+00:00:00", processed_at: "2026-09-18T10:00:00Z", amount: 1, score: 0.1, risk_band: "low",
  recommended_action: "allow", model_version: "m", policy_version: "p", known_outcome: null,
});

describe("mergeEvents (bounded, duplicate-free stream buffer)", () => {
  it("prepends newest first and ignores already-seen sequences", () => {
    const a = mergeEvents([], [ev(1), ev(2), ev(3)], 0);
    expect(a.buffer.map((e) => e.sequence)).toEqual([3, 2, 1]);
    const b = mergeEvents(a.buffer, [ev(2), ev(3), ev(4)], a.lastSequence);
    expect(b.buffer.map((e) => e.sequence)).toEqual([4, 3, 2, 1]);
    expect(b.added).toBe(1);
    const c = mergeEvents(b.buffer, [ev(1), ev(4)], b.lastSequence);
    expect(c.added).toBe(0);
    expect(c.buffer).toBe(b.buffer);
  });
  it("keeps the buffer bounded", () => {
    let state = { buffer: [] as SimulationEvent[], lastSequence: 0 };
    for (let i = 0; i < 20; i++) state = mergeEvents(state.buffer, [ev(i * 5 + 1), ev(i * 5 + 2), ev(i * 5 + 3), ev(i * 5 + 4), ev(i * 5 + 5)], state.lastSequence, 30);
    expect(state.buffer).toHaveLength(30);
    expect(state.buffer[0].sequence).toBe(100);
    expect(new Set(state.buffer.map((e) => e.event_id)).size).toBe(30);
  });
  it("sorts an out-of-order batch", () => {
    expect(mergeEvents([], [ev(3), ev(1), ev(2)], 0).buffer.map((e) => e.sequence)).toEqual([3, 2, 1]);
  });
});
