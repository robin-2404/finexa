import type { ReactNode } from "react";
import { DatabaseZap, Inbox, RefreshCw, ServerCrash, TriangleAlert } from "lucide-react";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EmptyState({ title, children, action, icon, className }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      <div className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">{icon ?? <Inbox className="size-5" aria-hidden />}</div>
      <p className="text-sm font-semibold">{title}</p>
      {children && <p className="max-w-md text-[13px] text-muted-foreground">{children}</p>}
      {action}
    </div>
  );
}

/** Maps API failures to honest, actionable messages. Never substitutes data. */
export function ErrorState({ error, onRetry, compact, className }: { error: unknown; onRetry?: () => void; compact?: boolean; className?: string }) {
  const err = error instanceof ApiError ? error : null;
  let title = "Something went wrong";
  let body: ReactNode = err?.message ?? (error instanceof Error ? error.message : "Unexpected error.");
  let icon = <TriangleAlert className="size-5" aria-hidden />;

  if (err?.isNetwork) {
    title = "Backend unavailable";
    icon = <ServerCrash className="size-5" aria-hidden />;
    body = err.message;
  } else if (err?.code === "MODEL_NOT_READY") {
    title = "Model not ready";
    icon = <DatabaseZap className="size-5" aria-hidden />;
    body = (
      <>
        {err.message}
        <span className="mt-2 block">
          Train the model, then restart the API: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">python -m app.ml.train</code> (run from <code className="rounded bg-muted px-1.5 py-0.5 text-xs">backend/</code>).
        </span>
      </>
    );
  }
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 text-center", compact ? "px-4 py-8" : "px-6 py-14", className)}>
      <div className="grid size-10 place-items-center rounded-full bg-danger-soft text-danger">{icon}</div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-lg text-[13px] text-muted-foreground">{body}</p>
      {err?.code && !err.isNetwork && <p className="text-xs text-muted-foreground">Error code: {err.code}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-1">
          <RefreshCw /> Retry
        </Button>
      )}
    </div>
  );
}
