import { Info, TrendingDown, TrendingUp } from "lucide-react";
import type { Explanation } from "@/api/types";
import { formatFeatureValue, formatLogit } from "@/lib/format";
import { cn } from "@/lib/utils";

const METHOD_LABEL: Record<string, string> = {
  single_feature_substitution: "Single-feature substitution",
  linear_logodds_decomposition: "Linear log-odds decomposition",
};

/**
 * Transaction-specific feature contributions. Wording is deliberately non-causal, and anonymous
 * features (V1..V28) are never given a business meaning.
 */
export function ExplanationPanel({ explanation }: { explanation: Explanation | null }) {
  if (!explanation) return <p className="text-sm text-muted-foreground">Explanation was not requested.</p>;

  if (explanation.status === "unavailable") {
    return (
      <div role="status" className="flex gap-3 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="font-semibold">Explanation unavailable</p>
          <p className="mt-0.5 text-[13px]">{explanation.unavailable_reason ?? "The backend could not compute contributions."} The model score above is unaffected, and no reasons are inferred in its place.</p>
        </div>
      </div>
    );
  }

  const all = explanation.contributions;
  const items = all.filter((c) => c.direction !== "neutral" && Math.abs(c.contribution) > 1e-9);
  const noEffect = all.length - items.length;
  const max = Math.max(...items.map((c) => Math.abs(c.contribution)), 1e-9);
  const up = items.filter((c) => c.direction === "increases_score").length;
  const down = items.filter((c) => c.direction === "decreases_score").length;

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">
        Largest contributions to this transaction's model score ({up} raising, {down} lowering among those shown). Values are log-odds changes.
      </p>
      <ul className="space-y-2" aria-label="Feature contributions">
        {items.map((c) => {
          const raise = c.direction === "increases_score";
          const lower = c.direction === "decreases_score";
          const w = `${(Math.abs(c.contribution) / max) * 100}%`;
          return (
            <li key={c.feature} className="grid grid-cols-[minmax(0,1fr)] gap-1 sm:grid-cols-[210px_minmax(0,1fr)_64px] sm:items-center sm:gap-3">
              <div className="min-w-0 text-[13px]">
                <span className="flex items-center gap-1.5">
                  {raise ? <TrendingUp className="size-3.5 shrink-0 text-danger" aria-hidden /> : lower ? <TrendingDown className="size-3.5 shrink-0 text-primary" aria-hidden /> : null}
                  <span className="font-medium">{c.feature}</span>{" "}
                  <span>{raise ? "increased" : lower ? "decreased" : "did not change"} the model score.</span>
                </span>
                <span className="tabular block pl-5 text-xs text-muted-foreground">value {formatFeatureValue(c.value)}</span>
              </div>
              <div className="grid h-3 grid-cols-2 items-center" aria-hidden>
                <div className="flex justify-end pr-px">{lower && <span className="h-2.5 rounded-l-sm bg-primary/70" style={{ width: w }} />}</div>
                <div className="border-l border-input pl-px">{raise && <span className="block h-2.5 rounded-r-sm bg-danger/75" style={{ width: w }} />}</div>
              </div>
              <span className={cn("tabular text-right text-[13px] font-medium", raise && "text-danger", lower && "text-primary-ink")}>{formatLogit(c.contribution)}</span>
            </li>
          );
        })}
      </ul>
      {noEffect > 0 && (
        <p className="text-xs text-muted-foreground">{noEffect} other feature{noEffect > 1 ? "s" : ""} among the largest {all.length} had no measurable effect on this score ({all.filter((c) => c.direction === "neutral" || Math.abs(c.contribution) <= 1e-9).map((c) => c.feature).join(", ")}).</p>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary/70" aria-hidden />Lowered the score</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-danger/75" aria-hidden />Raised the score</span>
      </div>
      <div className="rounded-md bg-muted/70 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        <p><span className="font-medium text-foreground">Method: {METHOD_LABEL[explanation.method ?? ""] ?? explanation.method}.</span> {explanation.method_description}</p>
        <p className="mt-1">Features are anonymous, so no business meaning is implied. These contributions describe how the model scored this transaction; they are not causal proof that it is or isn't fraud.</p>
      </div>
    </div>
  );
}
