/** The API exposes the active thresholds inside policy_version ("policy-v1:r0.010715:h0.973679"). */
export function parsePolicyThresholds(version: string | null | undefined): { review: number; hold: number } | null {
  const m = /:r([0-9.]+):h([0-9.]+)$/.exec(version ?? "");
  if (!m) return null;
  const review = Number(m[1]);
  const hold = Number(m[2]);
  return Number.isFinite(review) && Number.isFinite(hold) ? { review, hold } : null;
}
