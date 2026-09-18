/** Only same-app, known protected destinations are honoured as post-login return targets. */
const ALLOWED = [/^\/overview$/, /^\/monitor$/, /^\/investigation(\/TXN-\d{6,})?$/, /^\/patterns$/];
export const DEFAULT_DESTINATION = "/overview";

const hasControlChars = (s: string) => [...s].some((c) => c.charCodeAt(0) < 32);

export function safeNext(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_DESTINATION;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return DEFAULT_DESTINATION;
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || hasControlChars(value)) return DEFAULT_DESTINATION;
  let url: URL;
  try {
    url = new URL(value, "http://internal.invalid");
  } catch {
    return DEFAULT_DESTINATION;
  }
  if (url.origin !== "http://internal.invalid") return DEFAULT_DESTINATION;
  if (!ALLOWED.some((re) => re.test(url.pathname))) return DEFAULT_DESTINATION;
  return url.pathname + url.search;
}

export const loginUrl = (next?: string) =>
  next && safeNext(next) !== DEFAULT_DESTINATION ? `/login?next=${encodeURIComponent(next)}` : "/login";
