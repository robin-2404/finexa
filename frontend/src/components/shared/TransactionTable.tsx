import { Link, useNavigate } from "react-router-dom";
import type { TransactionSummary } from "@/api/types";
import { ActionBadge, AssessmentBadge, OutcomeBadge, RiskBadge, ScoreCell, StatusBadge } from "@/components/shared/badges";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/misc";
import { formatAmount, formatElapsed } from "@/lib/format";
import { cn } from "@/lib/utils";

const SPLIT_LABEL = { train: "Train", validation: "Validation", test: "Test" } as const;

export interface TableThresholds { review?: number; hold?: number }

/** Dense transaction table. Row click and the reference link both open the investigation. */
export function TransactionTable({
  rows, showOutcome, showStatus, showSplit, compact, thresholds, caption,
}: {
  rows: TransactionSummary[];
  showOutcome?: boolean;
  showStatus?: boolean;
  showSplit?: boolean;
  compact?: boolean;
  thresholds?: TableThresholds;
  caption: string;
}) {
  const navigate = useNavigate();
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <THead>
        <tr>
          <TH>Reference</TH>
          <TH>Elapsed time</TH>
          <TH className="text-right">Amount</TH>
          <TH className="text-right">Model risk score</TH>
          <TH>Risk band</TH>
          <TH>Recommended</TH>
          {showSplit && <TH>Split</TH>}
          {showStatus && <TH>Case</TH>}
          {showOutcome && <TH>Known outcome</TH>}
        </tr>
      </THead>
      <TBody>
        {rows.map((t) => (
          <TR key={t.transaction_ref} className="cursor-pointer" onClick={() => navigate(`/investigation/${t.transaction_ref}`)}>
            <TD className={cn("font-medium", compact && "py-1.5")}>
              <Link to={`/investigation/${t.transaction_ref}`} className="rounded text-primary-ink hover:underline" onClick={(e) => e.stopPropagation()}>
                {t.transaction_ref}
              </Link>
            </TD>
            <TD className="whitespace-nowrap text-muted-foreground" title="Elapsed dataset time, not a clock time">{formatElapsed(t.source_time_seconds)}</TD>
            <TD className="text-right">{formatAmount(t.amount)}</TD>
            <TD><ScoreCell score={t.score} review={thresholds?.review} hold={thresholds?.hold} /></TD>
            <TD><RiskBadge band={t.risk_band} /></TD>
            <TD><ActionBadge action={t.recommended_action} /></TD>
            {showSplit && <TD className="text-muted-foreground">{SPLIT_LABEL[t.split]}</TD>}
            {showStatus && (
              <TD>
                <div className="flex flex-wrap items-center gap-1.5"><StatusBadge status={t.review_status} />{t.analyst_assessment && <AssessmentBadge value={t.analyst_assessment} />}</div>
              </TD>
            )}
            {showOutcome && <TD><OutcomeBadge outcome={t.known_outcome} /></TD>}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
