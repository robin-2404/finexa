import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Skeleton, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

/** Info icon that reveals a definition on hover and keyboard focus. */
export function InfoTip({ children, label = "Definition" }: { children: ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} className="inline-grid size-5 place-items-center rounded-full text-muted-foreground hover:text-foreground">
          <Info className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}

const SCOPE_TONE = {
  historical: "navy",
  replay: "teal",
  evaluation: "amber",
  training: "outline",
  rehearsal: "amber",
} as const;
export function ScopeBadge({ scope, children }: { scope: keyof typeof SCOPE_TONE; children: ReactNode }) {
  return <Badge tone={SCOPE_TONE[scope]}>{children}</Badge>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight md:text-[22px]">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ title, scope, description, right }: { title: string; scope?: ReactNode; description?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {scope}
        </div>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {right}
    </div>
  );
}

export function MetricCard({
  label, value, sub, definition, loading, tone = "default", className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  definition?: ReactNode;
  loading?: boolean;
  tone?: "default" | "red" | "amber" | "teal";
  className?: string;
}) {
  const accent = { default: "", red: "text-danger", amber: "text-warning", teal: "text-primary-ink" }[tone];
  return (
    <div className={cn("rounded-lg border bg-card p-4 shadow-card", className)}>
      <div className="flex items-center gap-1 text-[13px] text-muted-foreground">
        <span>{label}</span>
        {definition && <InfoTip label={`Definition of ${label}`}>{definition}</InfoTip>}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-24" />
      ) : (
        <div className={cn("tabular mt-1 text-2xl font-semibold tracking-tight", accent)}>{value}</div>
      )}
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Card with a title, scope label and a plain-language summary under a chart (also read by screen readers). */
export function ChartCard({
  title, description, scope, summary, children, right, className,
}: {
  title: string;
  description?: ReactNode;
  scope?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{title}</CardTitle>
            {scope}
          </div>
          {description && <CardDescription className="mt-1">{description}</CardDescription>}
        </div>
        {right}
      </CardHeader>
      <CardContent>
        {children}
        {summary && <p className="mt-3 text-xs text-muted-foreground">{summary}</p>}
      </CardContent>
    </Card>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} className="h-6 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
