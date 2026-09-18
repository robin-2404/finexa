/** Display helpers. Amounts carry no currency (the dataset has no currency metadata); scores are 0-1 model scores. */

const int = new Intl.NumberFormat("en-US");
const amt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const NA = "n/a";

export const formatInt = (n: number | null | undefined) => (n == null ? NA : int.format(n));
export const formatCompact = (n: number | null | undefined) => (n == null ? NA : compact.format(n));
export const formatAmount = (n: number | null | undefined) => (n == null ? NA : amt.format(n));

/** Model risk score on its native 0-1 scale (never a percentage, never "confidence"). */
export function formatScore(s: number | null | undefined): string {
  if (s == null || Number.isNaN(s)) return NA;
  if (s === 0) return "0.000";
  if (s < 0.001) return "<0.001";
  if (s > 0.999 && s < 1) return ">0.999";
  return s.toFixed(3);
}

/** Threshold values keep more precision so 0.0107 is not shown as 0.011. */
export const formatThreshold = (t: number | null | undefined) => (t == null ? NA : Number(t.toPrecision(4)).toString());

/** A share such as prevalence or recall. `digits` defaults to 2 decimals. */
export function formatPercent(x: number | null | undefined, digits = 2): string {
  if (x == null || Number.isNaN(x)) return NA;
  return `${(x * 100).toFixed(digits)}%`;
}

/** Elapsed dataset time, e.g. 97121 -> "T+26:58:41". Not a clock time. */
export function formatElapsed(seconds: number | null | undefined): string {
  if (seconds == null) return NA;
  const s = Math.floor(seconds);
  const p = (n: number) => String(n).padStart(2, "0");
  return `T+${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return NA;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? NA : d.toLocaleTimeString(undefined, { hour12: false });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return NA;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? NA : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

export function formatFeatureValue(v: number | null | undefined): string {
  if (v == null) return NA;
  if (v === 0) return "0";
  const a = Math.abs(v);
  return a >= 1000 || a < 0.001 ? v.toExponential(3) : Number(v.toPrecision(5)).toString();
}

export function formatLogit(v: number | null | undefined): string {
  if (v == null) return NA;
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

/** Normalise "123", "txn-123" or "TXN-000123" to a reference, or null when it is not one. */
export function normalizeRef(input: string): string | null {
  const m = /^(?:txn-?)?(\d{1,9})$/i.exec(input.trim());
  return m ? `TXN-${m[1].padStart(6, "0")}` : null;
}
