import { AlertTriangle, CheckCircle2, CircleDot, Eye, Hand, ShieldAlert, ShieldCheck } from "lucide-react";
import type { Action, Assessment, Outcome, ReviewStatus, RiskBand, SimStatus } from "@/api/types";
import { Badge } from "@/components/ui/misc";
import { formatScore, formatThreshold } from "@/lib/format";
import { cn } from "@/lib/utils";

export function RiskBadge({ band }: { band: RiskBand }) {
  const map = {
    low: { tone: "green", label: "Low", icon: ShieldCheck },
    medium: { tone: "amber", label: "Medium", icon: AlertTriangle },
    high: { tone: "red", label: "High", icon: ShieldAlert },
  } as const;
  const m = map[band];
  return (
    <Badge tone={m.tone}>
      <m.icon aria-hidden /> {m.label}
    </Badge>
  );
}

export function ActionBadge({ action }: { action: Action }) {
  const map = {
    allow: { tone: "outline", label: "Allow", icon: CheckCircle2 },
    review: { tone: "amber", label: "Review", icon: Eye },
    hold: { tone: "red", label: "Hold (simulated)", icon: Hand },
  } as const;
  const m = map[action];
  return (
    <Badge tone={m.tone}>
      <m.icon aria-hidden /> {m.label}
    </Badge>
  );
}

export const STATUS_LABEL: Record<ReviewStatus, string> = { unreviewed: "Unreviewed", in_review: "In review", closed: "Closed" };
export function StatusBadge({ status }: { status: ReviewStatus }) {
  const tone = status === "closed" ? "green" : status === "in_review" ? "teal" : "neutral";
  return <Badge tone={tone}>{STATUS_LABEL[status]}</Badge>;
}

export const ASSESSMENT_LABEL: Record<Assessment, string> = {
  suspected_fraud: "Suspected fraud",
  likely_legitimate: "Likely legitimate",
  inconclusive: "Inconclusive",
};
export function AssessmentBadge({ value }: { value: Assessment | null }) {
  if (!value) return <span className="text-xs text-muted-foreground">No assessment</span>;
  const tone = value === "suspected_fraud" ? "red" : value === "likely_legitimate" ? "green" : "amber";
  return <Badge tone={tone}>{ASSESSMENT_LABEL[value]}</Badge>;
}

export function OutcomeBadge({ outcome }: { outcome: Outcome | null }) {
  if (!outcome) return <span className="text-xs text-muted-foreground">Hidden</span>;
  return <Badge tone={outcome === "fraud" ? "red" : "green"}>{outcome === "fraud" ? "Known fraud" : "Known legitimate"}</Badge>;
}

export function SimStatusBadge({ status }: { status: SimStatus }) {
  const map = {
    idle: { tone: "neutral", label: "Replay idle" },
    running: { tone: "teal", label: "Replay running" },
    paused: { tone: "amber", label: "Replay paused" },
    completed: { tone: "green", label: "Replay complete" },
  } as const;
  const m = map[status];
  return (
    <Badge tone={m.tone}>
      <CircleDot className={cn(status === "running" && "animate-pulse motion-reduce:animate-none")} aria-hidden /> {m.label}
    </Badge>
  );
}

/** Numeric score with a thin bar. Optional threshold ticks show where review/hold start. */
export function ScoreCell({ score, review, hold }: { score: number; review?: number; hold?: number }) {
  const band = hold != null && score >= hold ? "bg-danger" : review != null && score >= review ? "bg-warning" : "bg-primary/70";
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="tabular w-14 text-right font-medium">{formatScore(score)}</span>
      <span className="relative hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
        <span className={cn("absolute inset-y-0 left-0 rounded-full", band)} style={{ width: `${Math.max(2, score * 100)}%` }} />
      </span>
    </div>
  );
}

export const thresholdText = (review?: number, hold?: number) =>
  review != null && hold != null ? `review ≥ ${formatThreshold(review)} · hold ≥ ${formatThreshold(hold)}` : "";
