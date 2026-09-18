import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/endpoints";
import { ApiError, setCsrfToken, setUnauthorizedHandler } from "@/api/client";
import type { AuthUser } from "@/api/types";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Set when a session that existed is no longer valid (used to show a message on the login page). */
  sessionExpired: boolean;
  error: ApiError | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
export const ME_KEY = ["auth", "me"] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [sessionExpired, setSessionExpired] = useState(false);

  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async ({ signal }) => {
      try {
        const s = await api.me(signal);
        setCsrfToken(s.csrf_token);
        return s;
      } catch (e) {
        if (e instanceof ApiError && e.isAuth) {
          setCsrfToken(null);
          if (e.code === "SESSION_EXPIRED") setSessionExpired(true);
          return null; // definitively signed out
        }
        throw e; // network / server problems are not "signed out"
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  // Any protected call that returns 401 signs the user out client-side.
  useEffect(() => {
    setUnauthorizedHandler((code) => {
      setCsrfToken(null);
      setSessionExpired(code === "SESSION_EXPIRED");
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
      qc.setQueryData(ME_KEY, null);
    });
    return () => setUnauthorizedHandler(null);
  }, [qc]);

  const login = useCallback(
    async (email: string, password: string) => {
      const s = await api.login(email, password);
      setCsrfToken(s.csrf_token);
      setSessionExpired(false);
      qc.setQueryData(ME_KEY, s);
    },
    [qc],
  );
  const signup = useCallback(
    async (email: string, password: string) => {
      const s = await api.signup(email, password);
      setCsrfToken(s.csrf_token);
      setSessionExpired(false);
      qc.setQueryData(ME_KEY, s);
    },
    [qc],
  );
  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* the cookie may already be gone or the server unreachable; clear local state regardless */
    }
    setCsrfToken(null);
    setSessionExpired(false);
    qc.clear();
    qc.setQueryData(ME_KEY, null);
  }, [qc]);

  const value = useMemo<AuthContextValue>(() => {
    let status: AuthStatus = "loading";
    if (me.isError) status = "error";
    else if (me.data) status = "authenticated";
    else if (me.data === null) status = "unauthenticated";
    return {
      status,
      user: me.data?.user ?? null,
      sessionExpired,
      error: me.error instanceof ApiError ? me.error : me.error ? new ApiError(0, "UNKNOWN", String(me.error)) : null,
      login,
      signup,
      logout,
      retry: () => void me.refetch(),
    };
  }, [me.data, me.isError, me.error, me.refetch, sessionExpired, login, signup, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
