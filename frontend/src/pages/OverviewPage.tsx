import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import type { Action, RiskBand, Split } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton, Switch } from "@/components/ui/misc";
import { Label } from "@/components/ui/form";
import { ActionBadge, ScoreCell, SimStatusBadge } from "@/components/shared/badges";
import { ChartCard, InfoTip, MetricCard, PageHeader, ScopeBadge, SectionTitle, TableSkeleton } from "@/components/shared/blocks";
import { axisProps, CHART, ChartTip, Legend } from "@/components/shared/charts";
import { ALL, ACTION_OPTIONS, BAND_OPTIONS, FilterSelect, SPLIT_HELP, SPLIT_OPTIONS } from "@/components/shared/filters";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TransactionTable } from "@/components/shared/TransactionTable";
import { useActivePolicy, useActivity, useDataset, useEvaluation, usePatterns, useSimulation, useTransactions } from "@/hooks/queries";
import { formatAmount, formatCompact, formatElapsed, formatInt, formatPercent, formatThreshold } from "@/lib/format";
import { cn } from "@/lib/utils";

type SplitFilter = Split | typeof ALL;
const BUCKETS = [
  { value: 3600, label: "1 hour" },
  { value: 7200, label: "2 hours" },
  { value: 14400, label: "4 hours" },
];

export function OverviewPage() {
  const [split, setSplit] = useState<SplitFilter>("test");
  const [band, setBand] = useState<RiskBand | typeof ALL>(ALL);
  const [action, setAction] = useState<Action | typeof ALL>(ALL);
  const [reveal, setReveal] = useState(false);
  const [bucket, setBucket] = useState(7200);

  const splitParam = split === ALL ? undefined : split;
  const bandParam = band === ALL ? undefined : band;
  const actionParam = action === ALL ? undefined : action;

  const thresholds = useActivePolicy();
  const dataset = useDataset();
  const activity = useActivity({ split: splitParam, risk_band: bandParam, action: actionParam, bucket_seconds: bucket, reveal_outcome: reveal });
  const distribution = useActivity({ split: splitParam, bucket_seconds: 86400 });
  const patterns = usePatterns();
  const sim = useSimulation();
  const evaluation = useEvaluation();
  const recent = useTransactions({ split: splitParam, risk_band: bandParam, action: actionParam, sort: "time", order: "desc", page_size: 8, reveal_outcome: reveal });
  const queue = useTransactions({ split: splitParam, action: "hold", review_status: "unreviewed", sort: "score", order: "desc", page_size: 6 });

  const filtered = split !== "test" || band !== ALL || action !== ALL;

  return (
    <div className="space-y-10">
      <PageHeader
        title="Overview"
        description="Historical transaction activity, the current replay, and held-out evaluation, kept in separate, labelled scopes."
      />

      {/* Filters */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto_auto] lg:items-end">
          <FilterSelect id="f-split" label="Data split" value={split} onChange={(v) => setSplit(v as SplitFilter)} options={[...SPLIT_OPTIONS]} />
          <FilterSelect id="f-band" label="Risk band" value={band} onChange={(v) => setBand(v as RiskBand | typeof ALL)} options={[...BAND_OPTIONS]} />
          <FilterSelect id="f-action" label="Recommended action" value={action} onChange={(v) => setAction(v as Action | typeof ALL)} options={[...ACTION_OPTIONS]} />
          <div>
            <Label htmlFor="f-bucket" className="mb-1.5 block text-xs text-muted-foreground">Chart interval</Label>
            <div id="f-bucket" role="group" aria-label="Chart interval" className="inline-flex rounded-md border bg-muted p-0.5">
              {BUCKETS.map((b) => (
                <button
                  key={b.value} type="button" aria-pressed={bucket === b.value} onClick={() => setBucket(b.value)}
                  className={cn("h-8 rounded px-3 text-[13px]", bucket === b.value ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground")}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 pb-1.5">
            <Switch id="f-reveal" checked={reveal} onCheckedChange={setReveal} aria-describedby="f-reveal-help" />
            <Label htmlFor="f-reveal" className="cursor-pointer text-[13px]">Show known outcomes</Label>
            <InfoTip label="About known outcomes"><span id="f-reveal-help">Reveals the dataset's verified fraud labels for held-out rows. Retrospective view only; labels are hidden by default.</span></InfoTip>
          </div>
          {split !== ALL && <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-full">{SPLIT_HELP[split]}</p>}
        </CardContent>
      </Card>

      {/* Historical dataset */}
      <section aria-labelledby="hist-h">
        <SectionTitle
          title="Historical dataset"
          scope={<ScopeBadge scope="historical">Whole file</ScopeBadge>}
          description="Facts about the supplied dataset. Known fraud here means the dataset's verified label, not a model output."
        />
        {dataset.isError ? (
          <Card><ErrorState error={dataset.error} onRetry={() => dataset.refetch()} compact /></Card>
        ) : (
          <div id="hist-h" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Transactions" loading={dataset.isPending} value={formatInt(dataset.data?.rows)} sub={dataset.data && `${formatInt(dataset.data.splits.counts.test.rows)} in the held-out test split`} definition="Rows in the supplied dataset. Each row is one transaction with elapsed Time, V1 to V28, Amount and a label." />
            <MetricCard label="Known fraud (dataset label)" loading={dataset.isPending} tone="red" value={formatInt(dataset.data?.class_counts.fraud)} sub={dataset.data && `${formatInt(dataset.data.class_counts.legitimate)} known legitimate`} definition="Records whose verified Class label is 1. This is ground truth from the dataset, separate from anything the model flags." />
            <MetricCard label="Fraud prevalence" loading={dataset.isPending} value={formatPercent(dataset.data?.class_counts.fraud_prevalence, 3)} sub="Share of rows labelled fraud" definition="Known fraud divided by all transactions. Fraud is rare, which is why accuracy alone is misleading here." />
            <MetricCard label="Elapsed time covered" loading={dataset.isPending} value={formatElapsed(dataset.data?.time.max)} sub="Dataset-relative, not a calendar span" definition="Time is measured in seconds since the start of the dataset. It is not a date or local clock time." />
          </div>
        )}
      </section>

      {/* Activity + risk distribution */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3" aria-label="Activity and risk">
        <ActivityCard query={activity} reveal={reveal} filtered={filtered} className="xl:col-span-2" />
        <RiskDistribution query={distribution} split={split} thresholds={thresholds} />
      </section>

      {/* Amount + replay + evaluation */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3" aria-label="Amounts, replay and evaluation">
        <AmountCard query={patterns} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:col-span-2">
          <ReplayCard sim={sim} />
          <EvaluationCard evaluation={evaluation} />
        </div>
      </section>

      {/* Queue + recent */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3" aria-label="Transactions">
        <Card className="xl:col-span-1">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Priority investigation queue</CardTitle>
              <p className="mt-1 text-[13px] text-muted-foreground">Highest model risk scores among unreviewed hold recommendations in this split.</p>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {queue.isPending ? <TableSkeleton rows={5} cols={3} /> : queue.isError ? <ErrorState error={queue.error} onRetry={() => queue.refetch()} compact /> : queue.data.items.length === 0 ? (
              <EmptyState title="Nothing waiting for review" action={<Button asChild variant="secondary" size="sm"><Link to="/investigation">Open the full queue</Link></Button>}>
                No unreviewed hold recommendations in this view. Try a different data split.
              </EmptyState>
            ) : (
              <ul className="divide-y">
                {queue.data.items.map((t) => (
                  <li key={t.transaction_ref}>
                    <Link to={`/investigation/${t.transaction_ref}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/50">
                      <span className="min-w-0">
                        <span className="block font-medium text-primary-ink">{t.transaction_ref}</span>
                        <span className="tabular text-xs text-muted-foreground">{formatElapsed(t.source_time_seconds)} · amount {formatAmount(t.amount)}</span>
                      </span>
                      <span className="flex flex-col items-end gap-1"><ScoreCell score={t.score} review={thresholds?.review} hold={thresholds?.hold} /><ActionBadge action={t.recommended_action} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {queue.data && queue.data.total > queue.data.items.length && (
              <div className="px-5 pb-3 pt-2 text-[13px] text-muted-foreground">
                <span className="tabular">{formatInt(queue.data.total)}</span> in total ·{" "}
                <Link to="/investigation" className="inline-flex items-center gap-1 font-medium text-primary-ink hover:underline">Open full queue <ArrowRight className="size-3.5" aria-hidden /></Link>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Recent transactions</CardTitle>
              <p className="mt-1 text-[13px] text-muted-foreground">Latest by elapsed dataset time in the selected view. Click a row to investigate.</p>
            </div>
            {recent.data && <span className="tabular text-xs text-muted-foreground">{formatInt(recent.data.total)} match the filters</span>}
          </CardHeader>
          <CardContent className="px-0 pb-1">
            {recent.isPending ? <TableSkeleton rows={6} cols={6} /> : recent.isError ? <ErrorState error={recent.error} onRetry={() => recent.refetch()} compact /> : recent.data.items.length === 0 ? (
              <EmptyState title="No transactions match these filters">Loosen the risk band or action filter, or pick another data split.</EmptyState>
            ) : (
              <TransactionTable rows={recent.data.items} showOutcome={reveal} thresholds={thresholds ?? undefined} caption="Most recent transactions in the selected view" />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

function ActivityCard({ query, reveal, filtered, className }: { query: ReturnType<typeof useActivity>; reveal: boolean; filtered: boolean; className?: string }) {
  const data = useMemo(() => query.data?.buckets.map((b) => ({ ...b, hour: `${Math.round(b.start_seconds / 3600)}h` })) ?? [], [query.data]);
  const showFraud = !!query.data?.labels_revealed;
  const busiest = data.length ? data.reduce((a, b) => (b.transactions > a.transactions ? b : a)) : null;
  const totals = query.data?.totals;

  const summary = totals && busiest
    ? `${formatInt(totals.transactions)} transactions in this view; ${formatInt(totals.model_flagged)} recommended for review or hold by the model${showFraud && totals.known_fraud != null ? `; ${formatInt(totals.known_fraud)} carry a known fraud label` : ""}. Busiest interval starts ${formatElapsed(busiest.start_seconds)} with ${formatInt(busiest.transactions)} transactions.`
    : undefined;

  return (
    <ChartCard
      className={className}
      title="Transaction activity"
      scope={<ScopeBadge scope="historical">Historical dataset</ScopeBadge>}
      description={`Counts per interval of elapsed dataset time${filtered ? " (filters applied)" : ""}. Model-flagged is a model output; known fraud is the dataset label.`}
      summary={summary}
    >
      {query.isPending ? <Skeleton className="h-64 w-full" /> : query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} compact /> : totals && totals.transactions === 0 ? (
        <EmptyState title="No transactions in this view">Change the filters to see activity.</EmptyState>
      ) : (
        <div role="img" aria-label={summary ?? "Transaction activity chart"} className="space-y-4">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Transactions per interval</p>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="hour" {...axisProps} interval="preserveStartEnd" minTickGap={18} />
                <YAxis {...axisProps} width={42} tickFormatter={(v) => formatCompact(v as number)} />
                <RTooltip cursor={{ fill: "#eef3f8" }} content={(p) => (
                  <ChartTip {...p} title={(d) => `${formatElapsed(d.start_seconds)} to ${formatElapsed(d.end_seconds)}`} rows={(d) => [
                    { label: "Transactions", value: formatInt(d.transactions), color: CHART.tealSoft },
                    { label: "High / Medium / Low", value: `${formatInt(d.by_risk_band.high)} / ${formatInt(d.by_risk_band.medium)} / ${formatInt(d.by_risk_band.low)}` },
                  ]} />
                )} />
                <Bar dataKey="transactions" fill={CHART.tealSoft} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">Model-flagged{showFraud ? " vs known fraud" : ""} per interval</p>
              <Legend items={[{ label: "Model-flagged (review or hold)", color: CHART.amber }, ...(showFraud ? [{ label: "Known fraud (dataset label)", color: CHART.red }] : [])]} />
            </div>
            <ResponsiveContainer width="100%" height={130}>
              <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="hour" {...axisProps} interval="preserveStartEnd" minTickGap={18} label={{ value: "Elapsed dataset time (hours)", position: "insideBottom", offset: -2, fontSize: 11, fill: CHART.axis }} height={34} />
                <YAxis {...axisProps} width={42} allowDecimals={false} />
                <RTooltip cursor={{ fill: "#eef3f8" }} content={(p) => (
                  <ChartTip {...p} title={(d) => `${formatElapsed(d.start_seconds)} to ${formatElapsed(d.end_seconds)}`} rows={(d) => [
                    { label: "Model-flagged", value: formatInt(d.model_flagged), color: CHART.amber },
                    ...(showFraud ? [{ label: "Known fraud", value: formatInt(d.known_fraud), color: CHART.red }] : []),
                  ]} />
                )} />
                <Bar dataKey="model_flagged" fill={CHART.amber} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                {showFraud && <Bar dataKey="known_fraud" fill={CHART.red} radius={[3, 3, 0, 0]} isAnimationActive={false} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
          {!showFraud && !reveal && <p className="text-xs text-muted-foreground">Known fraud is hidden for held-out data. Turn on "Show known outcomes" for a retrospective view.</p>}
        </div>
      )}
    </ChartCard>
  );
}

function RiskDistribution({ query, split, thresholds }: { query: ReturnType<typeof useActivity>; split: SplitFilter; thresholds: { review: number; hold: number } | null }) {
  const t = query.data?.totals;
  const rows: { key: RiskBand; label: string; color: string; hint: string }[] = [
    { key: "high", label: "High", color: "bg-danger", hint: thresholds ? `score ≥ ${formatThreshold(thresholds.hold)} → hold` : "hold" },
    { key: "medium", label: "Medium", color: "bg-warning", hint: thresholds ? `${formatThreshold(thresholds.review)} ≤ score < ${formatThreshold(thresholds.hold)} → review` : "review" },
    { key: "low", label: "Low", color: "bg-success", hint: thresholds ? `score < ${formatThreshold(thresholds.review)} → allow` : "allow" },
  ];
  const summary = t ? `Of ${formatInt(t.transactions)} transactions, ${formatInt(t.by_risk_band.high)} are high risk, ${formatInt(t.by_risk_band.medium)} medium and ${formatInt(t.by_risk_band.low)} low under the active policy.` : undefined;
  return (
    <ChartCard
      title="Risk distribution"
      scope={<ScopeBadge scope="historical">{split === ALL ? "All splits" : SPLIT_OPTIONS.find((s) => s.value === split)?.label}</ScopeBadge>}
      description="Transactions by model risk band under the active policy thresholds."
      summary={summary}
    >
      {query.isPending ? <Skeleton className="h-40 w-full" /> : query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} compact /> : !t || t.transactions === 0 ? (
        <EmptyState title="No transactions in this split" />
      ) : (
        <div className="space-y-4">
          <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={summary}>
            {rows.map((r) => {
              const share = t.by_risk_band[r.key] / t.transactions;
              return share > 0 ? <span key={r.key} className={r.color} style={{ width: `${Math.max(share * 100, 0.6)}%` }} /> : null;
            })}
          </div>
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5">
                  <span className={cn("size-2.5 rounded-sm", r.color)} aria-hidden />
                  <span><span className="block text-sm font-medium">{r.label}</span><span className="tabular block text-xs text-muted-foreground">{r.hint}</span></span>
                </span>
                <span className="text-right"><span className="tabular block text-sm font-semibold">{formatInt(t.by_risk_band[r.key])}</span><span className="tabular block text-xs text-muted-foreground">{formatPercent(t.by_risk_band[r.key] / t.transactions, 2)}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}

function AmountCard({ query }: { query: ReturnType<typeof usePatterns> }) {
  const bins = query.data?.amount_distribution ?? [];
  const top = bins.length ? bins.reduce((a, b) => (b.count > a.count ? b : a)) : null;
  const summary = top ? `Most transactions fall in the ${top.label} amount range (${formatInt(top.count)} of ${formatInt(bins.reduce((s, b) => s + b.count, 0))}).` : undefined;
  return (
    <ChartCard
      title="Amount distribution"
      scope={<ScopeBadge scope="training">Training reference</ScopeBadge>}
      description="Transactions per amount range. Amounts are plain numbers; the dataset has no currency information."
      summary={summary}
    >
      {query.isPending ? <Skeleton className="h-56 w-full" /> : query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} compact /> : (
        <div role="img" aria-label={summary ?? "Amount distribution"}>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={bins} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="label" {...axisProps} interval={0} angle={-35} textAnchor="end" height={54} />
              <YAxis {...axisProps} width={42} tickFormatter={(v) => formatCompact(v as number)} />
              <RTooltip cursor={{ fill: "#eef3f8" }} content={(p) => (
                <ChartTip {...p} title={(d) => `Amount ${d.label}`} rows={(d) => [
                  { label: "Transactions", value: formatInt(d.count), color: CHART.teal },
                  { label: "Known fraud", value: formatInt(d.fraud_count), color: CHART.red },
                  { label: "Fraud prevalence", value: formatPercent(d.fraud_prevalence, 3) },
                ]} />
              )} />
              <Bar dataKey="count" fill={CHART.teal} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

function ReplayCard({ sim }: { sim: ReturnType<typeof useSimulation> }) {
  const s = sim.data;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><CardTitle>Current replay</CardTitle><ScopeBadge scope="replay">Replay</ScopeBadge></div>
        {s && <SimStatusBadge status={s.status} />}
      </CardHeader>
      <CardContent>
        {sim.isPending ? <Skeleton className="h-32 w-full" /> : sim.isError ? <ErrorState error={sim.error} onRetry={() => sim.refetch()} compact /> : s && (
          <div className="space-y-4">
            <p className="text-[13px] text-muted-foreground">Historical simulation of held-out transactions. No labels are shown here.</p>
            <div>
              <div className="flex items-baseline justify-between text-sm"><span className="text-muted-foreground">Processed</span><span className="tabular font-semibold">{formatInt(s.processed)} <span className="font-normal text-muted-foreground">of {formatInt(s.total)}</span></span></div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={s.total} aria-valuenow={s.processed} aria-label="Replay progress">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${s.total ? (s.processed / s.total) * 100 : 0}%` }} />
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {(["allow", "review", "hold"] as const).map((a) => (
                <div key={a} className="rounded-md border bg-background p-2"><dt className="text-xs capitalize text-muted-foreground">{a}{a === "hold" ? " (sim.)" : ""}</dt><dd className="tabular text-lg font-semibold">{formatInt(s.by_action[a])}</dd></div>
              ))}
            </dl>
            <Button asChild variant="secondary" size="sm" className="w-full"><Link to="/monitor">Open Live Monitor <ArrowRight /></Link></Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EvaluationCard({ evaluation }: { evaluation: ReturnType<typeof useEvaluation> }) {
  const t = evaluation.data?.test;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-2">
        <CardTitle>Held-out evaluation</CardTitle>
        <ScopeBadge scope="evaluation">Test split</ScopeBadge>
      </CardHeader>
      <CardContent>
        {evaluation.isPending ? <Skeleton className="h-32 w-full" /> : evaluation.isError ? <ErrorState error={evaluation.error} onRetry={() => evaluation.refetch()} compact /> : t && (
          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">Average precision<InfoTip label="Definition of average precision">{evaluation.data.average_precision_definition}</InfoTip></dt>
                <dd className="tabular text-xl font-semibold">{t.average_precision.toFixed(3)}</dd>
                <dd className="text-xs text-muted-foreground">no-skill: {t.always_legitimate_baseline.average_precision.toFixed(4)}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-xs text-muted-foreground">ROC-AUC<InfoTip label="About ROC-AUC">Secondary metric. It can look strong even when precision is poor for rare fraud.</InfoTip></dt>
                <dd className="tabular text-xl font-semibold">{t.roc_auc.toFixed(3)}</dd>
              </div>
              <div><dt className="text-xs text-muted-foreground">Precision at hold ≥ {formatThreshold(t.operating_points.hold.threshold)}</dt><dd className="tabular font-semibold">{formatPercent(t.operating_points.hold.precision, 1)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Recall at hold</dt><dd className="tabular font-semibold">{formatPercent(t.operating_points.hold.recall, 1)}</dd></div>
            </dl>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {formatInt(t.rows)} rows, {formatInt(t.fraud)} known fraud (prevalence {formatPercent(t.evaluation_prevalence, 3)}). An always-legitimate rule catches none of it (recall 0).
              {evaluation.data.caveat}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
