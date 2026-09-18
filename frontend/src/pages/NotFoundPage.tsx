import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Compass } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { Wordmark } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  const { pathname } = useLocation();
  const { status } = useAuth();
  const signedIn = status === "authenticated";
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6">
      <div className="w-full max-w-md text-center">
        <Link to="/" className="inline-block" aria-label="FINEXA home"><Wordmark /></Link>
        <div className="mx-auto mt-10 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground"><Compass className="size-6" aria-hidden /></div>
        <h1 className="mt-4 text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          There's nothing at <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{pathname}</code>. It may have moved, or the link may be mistyped.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {signedIn ? (
            <>
              <Button asChild><Link to="/overview">Go to Overview</Link></Button>
              <Button asChild variant="secondary"><Link to="/investigation">Open Investigation</Link></Button>
            </>
          ) : (
            <>
              <Button asChild><Link to="/">Back to homepage</Link></Button>
              <Button asChild variant="secondary"><Link to="/login">Log in</Link></Button>
            </>
          )}
        </div>
        <Link to="/" className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" aria-hidden /> FINEXA home</Link>
      </div>
    </div>
  );
}
