import { Navigate, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { Loader2, ServerCrash } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { Button } from "@/components/ui/button";
import { loginUrl, safeNext } from "@/lib/safe-redirect";

export function FullPageStatus({ children, label }: { children?: React.ReactNode; label: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6" role="status" aria-live="polite">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        {children ?? <Loader2 className="size-6 animate-spin text-primary" aria-hidden />}
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

/** Blocks protected routes until the session is resolved; never flashes protected content. */
export function RequireAuth() {
  const { status, error, retry } = useAuth();
  const location = useLocation();

  if (status === "loading") return <FullPageStatus label="Restoring your session…" />;
  if (status === "error") {
    return (
      <FullPageStatus label="">
        <ServerCrash className="size-8 text-danger" aria-hidden />
        <h1 className="text-base font-semibold">Can't reach the FINEXA backend</h1>
        <p className="text-sm text-muted-foreground">{error?.message ?? "The session could not be verified."}</p>
        <Button onClick={retry} variant="secondary">Try again</Button>
      </FullPageStatus>
    );
  }
  if (status === "unauthenticated") {
    return <Navigate to={loginUrl(location.pathname + location.search)} replace />;
  }
  return <Outlet />;
}

/** Login/signup are for signed-out visitors; signed-in users go to their destination. */
export function PublicOnly() {
  const { status } = useAuth();
  const [params] = useSearchParams();
  if (status === "authenticated") return <Navigate to={safeNext(params.get("next"))} replace />;
  return <Outlet />;
}
