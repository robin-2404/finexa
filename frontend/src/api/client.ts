import type { ApiErrorBody } from "./types";

const RAW_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
export const API_ORIGIN = RAW_BASE.replace(/\/+$/, "");
export const API_ROOT = `${API_ORIGIN}/api/v1`;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorBody["error"]["details"];
  constructor(status: number, code: string, message: string, details: ApiErrorBody["error"]["details"] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
  get isNetwork() {
    return this.code === "NETWORK_ERROR";
  }
  get isAuth() {
    return this.status === 401 && (this.code === "UNAUTHENTICATED" || this.code === "SESSION_EXPIRED");
  }
  /** First validation message for a field location suffix, e.g. "password". */
  fieldMessage(field: string): string | undefined {
    return this.details.find((d) => d.location?.split(".").pop() === field)?.message;
  }
}

// The CSRF token is kept in memory only (never localStorage) and refreshed from /auth/me.
let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};
export const getCsrfToken = () => csrfToken;

type UnauthorizedHandler = (code: string) => void;
let onUnauthorized: UnauthorizedHandler | null = null;
export const setUnauthorizedHandler = (h: UnauthorizedHandler | null) => {
  onUnauthorized = h;
};

type Query = Record<string, string | number | boolean | null | undefined>;
export interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  /** Auth endpoints handle their own 401s and must not trigger the global session-expired flow. */
  skipUnauthorizedHandler?: boolean;
}

export function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${API_ROOT}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function request<T>(method: "GET" | "POST" | "PATCH", path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      credentials: "include",
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK_ERROR", `Cannot reach the FINEXA backend at ${API_ORIGIN}. Check that it is running and that this origin is allowed by its CORS settings.`);
  }

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }
  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error;
    const apiErr = err
      ? new ApiError(res.status, err.code, err.message, err.details ?? [])
      : new ApiError(res.status, "HTTP_ERROR", `Unexpected response from the server (HTTP ${res.status}).`);
    if (apiErr.isAuth && !opts.skipUnauthorizedHandler) onUnauthorized?.(apiErr.code);
    throw apiErr;
  }
  return data as T;
}

export const get = <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>("GET", path, { query, signal });
export const post = <T>(path: string, body?: unknown, opts: Omit<RequestOptions, "body"> = {}) => request<T>("POST", path, { ...opts, body: body ?? {} });
export const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, { body });
