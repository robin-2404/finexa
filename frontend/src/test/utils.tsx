import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { AuthProvider } from "@/auth/AuthProvider";
import { setCsrfToken, setUnauthorizedHandler } from "@/api/client";
import { TooltipProvider } from "@/components/ui/misc";

export interface MockReq { url: URL; method: string; body: unknown; headers: Record<string, string> }
export type Handler = (req: MockReq) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>;

export const err = (status: number, code: string, message: string, details: unknown[] = []) => ({ status, body: { error: { code, message, details } } });

export const SESSION = { user: { id: 1, email: "ana@example.com", created_at: "2026-09-18T10:00:00Z" }, csrf_token: "csrf-abc", expires_at: "2026-09-19T10:00:00Z" };

/** Route fetch by "METHOD /path" (path without /api/v1). Unhandled routes fail the test loudly. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: MockReq[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const req: MockReq = {
      url, method, headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(req);
    const key = `${method} ${url.pathname.replace("/api/v1", "")}`;
    const h = routes[key];
    if (!h) throw new Error(`Unhandled request in test: ${key}`);
    const r = await h(req);
    const status = r.status ?? 200;
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn, count: (key: string) => calls.filter((c) => `${c.method} ${c.url.pathname.replace("/api/v1", "")}` === key).length };
}

export function renderApp(ui: ReactElement, { route = "/" }: { route?: string } = {}) {
  setCsrfToken(null);
  setUnauthorizedHandler(null);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <TooltipProvider>{ui}</TooltipProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

/** A tiny router probe so tests can assert where navigation landed. */
import { useLocation } from "react-router-dom";
export function LocationProbe() {
  const l = useLocation();
  return <output data-testid="location">{l.pathname + l.search}</output>;
}
