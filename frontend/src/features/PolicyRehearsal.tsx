import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Play } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { api } from "@/api/endpoints";
import { ApiError } from "@/api/client";
import type { PolicyCompareResponse, PolicyMetrics, PolicyResult, Split } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/overlay";
import { Badge, Skeleton, Table, TBody, TD, TH, THead, TR } from "@/components/ui/misc";
import { ChartCard, InfoTip, ScopeBadge } from "@/components/shared/blocks";
import { axisProps, CHART, ChartTip, Legend } from "@/components/shared/charts";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { useActivePolicy } from "@/hooks/queries";
import { formatAmount, formatInt, formatPercent, formatThreshold } from "@/lib/format";
import { cn } from "@/lib/utils";

const BATCHES = [
  { value: "whole", label: "Whole split (one batch)" },
  { value: "1000", label: "1,000 transactions per batch" },
  { value: "5000", label: "5,000 transactions per batch" },
  { value: "10000", label: "10,000 transactions per batch" },
];

interface Form { review: string; hold: string; capacity: string; batch: string; final: boolean; ack: boolean }
interface Outcome { response: PolicyCompareResponse; sweep: PolicyResult[]; baseline: PolicyResult; proposed: PolicyResult }

/** Threshold as shown in the form: 6 significant digits. */
const exact = (n: number) => String(Number(n.toPrecision(6)));
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

function validate(f: Form) {
  const errors: { review?: string; hold?: string; capacity?: string; ack?: string } = {};
  const r = num(f.review);
  const h = num(f.hold);
  if (!Number.isFinite(r) || r < 0 || r > 1) errors.review = "Enter a number from 0 to 1.";
  if (!Number.isFinite(h) || h < 0 || h > 1) errors.hold = "Enter a number from 0 to 1.";
  if (!errors.review && !errors.hold && !(r < h)) errors.hold = "Hold threshold must be greater than the review threshold.";
  if (f.capacity.trim() !== "") {
    const c = Number(f.capacity);
    if (!Number.isInteger(c) || c < 0) errors.capacity = "Enter a whole number of cases (0 or more), or leave blank for no limit.";
  }
  if (f.final && !f.ack) errors.ack = "Confirm that this is a one-off final evaluation.";
  return errors;
}

export function PolicyRehearsal() {
  const active = useActivePolicy();

  const [form, setForm] = useState<Form>({ review: "", hold: "", capacity: "100", batch: "whole", final: false, ack: false });
  const [touched, setTouched] = useState(false);
  const seeded = useRef(false);
  useEffect(() => {
    if (active && !seeded.current) {
      seeded.current = true;
      setForm((f) => ({ ...f, review: exact(active.review), hold: exact(active.hold) }));
    }
  }, [active]);

  const errors = validate(form);
  const invalid = Object.keys(errors).length > 0;

  const run = useMutation({
    mutationFn: async (f: Form): Promise<Outcome> => {
      const split: Split = f.final ? "test" : "validation";
      const batch = f.batch === "whole" ? null : Number(f.batch);
      // Untouched inputs mean "the active policy": send its exact values, not the 6-digit display.
      const review = f.review === exact(active!.review) ? active!.review : num(f.review);
      const hold = f.hold === exact(active!.hold) ? active!.hold : num(f.hold);
      const proposedSpec = { name: "Proposed", review_threshold: review, hold_threshold: hold, review_capacity: f.capacity.trim() === "" ? null : Number(f.capacity) };
      const base = { split, batch_size: batch, acknowledge_final_evaluation: f.final && f.ack };
      const response = await api.comparePolicies({
        ...base,
        policies: [{ name: "Baseline", review_threshold: active!.review, hold_threshold: active!.hold, review_capacity: null }, proposedSpec],
      });
      const baseline = response.results[0];
      const proposed = response.results[1];
      // Capacity sweep at the proposed thresholds, sized from the proposed review demand.
      const demand = proposed.metrics.alerts.review_demand;
      const caps = [...new Set([0, 0.1, 0.25, 0.5, 0.75, 1].map((p) => Math.round(demand * p)))].sort((a, b) => a - b);
      const sweepRes = await api.comparePolicies({
        ...base,
        policies: caps.map((c) => ({ name: `Capacity ${c}`, review_threshold: proposedSpec.review_threshold, hold_threshold: proposedSpec.hold_threshold, review_capacity: c })),
      });
      return { response, sweep: sweepRes.results, baseline, proposed };
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "The comparison failed."),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (invalid || !active || run.isPending) return;
    run.mutate(form);
  }
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const out = run.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Rehearse a policy</CardTitle>
            <Badge tone="amber">Historical simulation</Badge>
          </div>
          <CardDescription>
            Change the review and hold thresholds and how many cases analysts can review, then compare against the active policy. Every count uses known historical labels; nothing here changes a real payment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Field id="p-review" label="Review threshold" hint="Scores at or above this are recommended for review." error={touched ? errors.review : null}>
                <Input id="p-review" inputMode="decimal" value={form.review} onChange={(e) => set("review", e.target.value)} aria-invalid={touched && !!errors.review} aria-describedby={touched && errors.review ? "p-review-error" : "p-review-hint"} />
              </Field>
              <Field id="p-hold" label="Hold threshold" hint="Scores at or above this get a simulated hold." error={touched ? errors.hold : null}>
                <Input id="p-hold" inputMode="decimal" value={form.hold} onChange={(e) => set("hold", e.target.value)} aria-invalid={touched && !!errors.hold} aria-describedby={touched && errors.hold ? "p-hold-error" : "p-hold-hint"} />
              </Field>
              <Field id="p-capacity" label="Review capacity per batch" hint="Most cases analysts can review per batch. Blank = no limit." error={touched ? errors.capacity : null}>
                <Input id="p-capacity" inputMode="numeric" value={form.capacity} onChange={(e) => set("capacity", e.target.value)} placeholder="No limit" aria-invalid={touched && !!errors.capacity} aria-describedby={touched && errors.capacity ? "p-capacity-error" : "p-capacity-hint"} />
              </Field>
              <div className="space-y-1.5">
                <label htmlFor="p-batch" className="text-sm font-medium">Batch size</label>
                <Select value={form.batch} onValueChange={(v) => set("batch", v)}>
                  <SelectTrigger id="p-batch"><SelectValue /></SelectTrigger>
                  <SelectContent>{BATCHES.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Capacity applies to each batch in dataset-time order.</p>
              </div>
            </div>

            <fieldset className="rounded-lg border bg-background p-4">
              <legend className="px-1 text-sm font-medium">Evaluation split</legend>
              <div className="space-y-2 text-sm">
                <label className="flex items-start gap-2.5"><input type="radio" name="split" className="mt-1 size-4 accent-primary" checked={!form.final} onChange={() => setForm((f) => ({ ...f, final: false, ack: false }))} />
                  <span><span className="font-medium">Validation split</span> (recommended for tuning). Thresholds were chosen here, so results are optimistic.</span></label>
                <label className="flex items-start gap-2.5"><input type="radio" name="split" className="mt-1 size-4 accent-primary" checked={form.final} onChange={() => set("final", true)} />
                  <span><span className="font-medium">Test split</span> (final evaluation only). Reserved so the model isn't tuned to it.</span></label>
                {form.final && (
                  <label className="ml-6 flex items-start gap-2.5 rounded-md bg-warning-soft px-3 py-2 text-warning">
                    <input type="checkbox" className="mt-1 size-4 accent-primary" checked={form.ack} onChange={(e) => set("ack", e.target.checked)} aria-describedby={touched && errors.ack ? "ack-error" : undefined} />
                    <span>I understand this is a final evaluation and I shouldn't keep tuning against the test split.</span>
                  </label>
                )}
                {touched && errors.ack && <p id="ack-error" role="alert" className="ml-6 text-xs font-medium text-danger">{errors.ack}</p>}
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="lg" loading={run.isPending} disabled={!active}><Play /> {run.isPending ? "Running comparison…" : "Run comparison"}</Button>
              {!active && <p className="text-xs text-muted-foreground">Waiting for the active policy thresholds from the backend.</p>}
              {active && <p className="text-xs text-muted-foreground">Baseline: the active policy (review ≥ {formatThreshold(active.review)}, hold ≥ {formatThreshold(active.hold)}) with no capacity limit.</p>}
            </div>
          </form>
        </CardContent>
      </Card>

      {run.isPending && <div className="grid grid-cols-1 gap-6 lg:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>}
      {run.isError && <Card><ErrorState error={run.error} onRetry={() => onSubmit({ preventDefault() {} } as FormEvent)} /></Card>}
      {!out && !run.isPending && !run.isError && (
        <Card><EmptyState icon={<AlertTriangle className="size-5" aria-hidden />} title="No comparison yet">Set thresholds and a review capacity, then press "Run comparison" to see the trade-off.</EmptyState></Card>
      )}
      {out && !run.isPending && <Results out={out} capacity={form.capacity.trim() === "" ? null : Number(form.capacity)} />}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */

function Delta({ now, base, good }: { now: number; base: number; good: "up" | "down" | "neutral" }) {
  const d = now - base;
  if (d === 0) return <span className="text-xs text-muted-foreground">same as baseline</span>;
  const better = good === "neutral" ? null : (good === "up") === (d > 0);
  return <span className={cn("tabular text-xs", better === null ? "text-muted-foreground" : better ? "text-success" : "text-danger")}>{d > 0 ? "+" : ""}{formatInt(d)} vs baseline</span>;
}

function Results({ out, capacity }: { out: Outcome; capacity: number | null }) {
  const { response, baseline, proposed, sweep } = out;
  const isFinal = response.split === "test";
  return (
    <div className="space-y-6">
      <div className={cn("flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm", isFinal ? "border-warning/40 bg-warning-soft text-warning" : "bg-card")}>
        <ScopeBadge scope="rehearsal">Historical simulation</ScopeBadge>
        <Badge tone={isFinal ? "red" : "teal"}>{isFinal ? "Final evaluation: test split" : "Tuning: validation split"}</Badge>
        <span className={isFinal ? "" : "text-muted-foreground"}>{response.evaluation_split_note}</span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PolicyPanel title="Baseline" subtitle="Active policy, no capacity limit" result={baseline} />
        <PolicyPanel title="Proposed" subtitle={capacity == null ? "Your thresholds, no capacity limit" : `Your thresholds, capacity ${formatInt(capacity)} per batch`} result={proposed} base={baseline} accent />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How overflow is counted</CardTitle>
          <CardDescription>This follows the backend's actual rules.</CardDescription>
        </CardHeader>
        <CardContent className="text-[13px] leading-relaxed text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            <li>Review candidates in each batch are ranked by model score, highest first. The first {capacity == null ? "N (unlimited here)" : formatInt(capacity)} are <span className="font-medium text-foreground">within capacity</span>; the rest are <span className="font-medium text-foreground">overflow</span>.</li>
            <li>Overflow cases are <span className="font-medium text-foreground">never counted as reviewed</span>. Analyst review isn't assumed to succeed either.</li>
            <li>Hold recommendations are automatic simulated recommendations and don't use review capacity.</li>
            <li>"Flagged" means recommended for review or hold. It is not verified prevention or recovery.</li>
          </ul>
        </CardContent>
      </Card>

      <SweepChart sweep={sweep} capacity={capacity} />

      {response.notes.length > 0 && (
        <p className="text-xs text-muted-foreground">Backend notes: {response.notes.join(" ")}</p>
      )}
    </div>
  );
}

function PolicyPanel({ title, subtitle, result, base, accent }: { title: string; subtitle: string; result: PolicyResult; base?: PolicyResult; accent?: boolean }) {
  const m = result.metrics;
  const b = base?.metrics;
  const rows: { label: string; value: string; sub?: React.ReactNode; tone?: string; def: string }[] = [
    { label: "Fraud flagged", value: formatInt(m.known_fraud.flagged_total), sub: <>of {formatInt(m.population.known_fraud)} known fraud ({formatPercent(m.known_fraud.flagged_share_of_fraud, 1)}){b && <><br /><Delta now={m.known_fraud.flagged_total} base={b.known_fraud.flagged_total} good="up" /></>}</>, tone: "text-primary-ink", def: "Known fraud that the policy recommended for review or hold. Flagged is not the same as prevented or recovered." },
    { label: "Fraud allowed", value: formatInt(m.known_fraud.allowed), sub: b ? <Delta now={m.known_fraud.allowed} base={b.known_fraud.allowed} good="down" /> : "Score below the review threshold", tone: "text-danger", def: "Known fraud whose score was below the review threshold, so the policy would allow it." },
    { label: "Legitimate flagged", value: formatInt(m.known_legitimate.flagged_total), sub: b ? <Delta now={m.known_legitimate.flagged_total} base={b.known_legitimate.flagged_total} good="down" /> : "Recommended for review or hold", def: "Known legitimate transactions the policy recommended for review or hold (false alarms)." },
    { label: "Review demand", value: formatInt(m.alerts.review_demand), sub: `plus ${formatInt(m.alerts.hold_recommended)} hold recommendations`, def: "Transactions recommended for review (score between the two thresholds), before any capacity limit." },
    { label: "Within capacity", value: formatInt(m.alerts.cases_within_capacity), sub: m.alerts.review_capacity_per_batch == null ? "no limit set" : `capacity ${formatInt(m.alerts.review_capacity_per_batch)} × ${formatInt(m.alerts.batches)} batch${m.alerts.batches === 1 ? "" : "es"}`, def: "Review cases analysts could handle: the top-scoring candidates in each batch up to capacity." },
    { label: "Overflow", value: formatInt(m.alerts.overflow), sub: `${formatInt(m.known_fraud.review_overflow)} of them known fraud`, tone: m.alerts.overflow > 0 ? "text-warning" : undefined, def: "Review candidates beyond capacity. They are not counted as reviewed." },
    { label: "Fraud value allowed", value: formatAmount(m.fraud_value.allowed), sub: <>{formatAmount(m.fraud_value.allowed_or_unreviewed)} if overflow also goes unreviewed</>, tone: "text-danger", def: "Total Amount of known fraud the policy would allow. Amounts are plain numbers; the dataset has no currency." },
  ];
  return (
    <Card className={cn(accent && "border-primary/40 ring-1 ring-primary/15")}>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div><CardTitle>{title}</CardTitle><CardDescription>{subtitle}</CardDescription></div>
        <p className="tabular text-right text-xs text-muted-foreground">review ≥ {formatThreshold(result.review_threshold)}<br />hold ≥ {formatThreshold(result.hold_threshold)}</p>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3">
          {rows.map((r) => (
            <div key={r.label} className="rounded-md border bg-background p-3">
              <dt className="flex items-center gap-1 text-xs text-muted-foreground">{r.label}<InfoTip label={`Definition of ${r.label}`}>{r.def}</InfoTip></dt>
              <dd className={cn("tabular mt-0.5 text-xl font-semibold", r.tone)}>{r.value}</dd>
              <dd className="mt-0.5 text-xs leading-snug text-muted-foreground">{r.sub}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">Of everything flagged, <span className="tabular font-medium text-foreground">{formatPercent(m.flag_precision, 1)}</span> is known fraud. Population: {formatInt(m.population.rows)} transactions, {formatInt(m.population.known_fraud)} known fraud.</p>
      </CardContent>
    </Card>
  );
}

function SweepChart({ sweep, capacity }: { sweep: PolicyResult[]; capacity: number | null }) {
  const data = useMemo(
    () => sweep.map((r) => {
      const m: PolicyMetrics = r.metrics;
      return {
        cap: m.alerts.review_capacity_per_batch ?? 0,
        label: formatInt(m.alerts.review_capacity_per_batch ?? 0),
        reviewed: m.known_fraud.recommended_hold + m.known_fraud.review_within_capacity,
        overflow: m.known_fraud.review_overflow,
        allowed: m.known_fraud.allowed,
        within: m.alerts.cases_within_capacity,
        legitReviewed: m.known_legitimate.review_within_capacity,
        value: m.fraud_value.allowed_or_unreviewed,
      };
    }),
    [sweep],
  );
  const summary = data.length
    ? `As capacity rises from ${data[0].label} to ${data[data.length - 1].label} cases per batch, known fraud that is held or reviewed within capacity goes from ${formatInt(data[0].reviewed)} to ${formatInt(data[data.length - 1].reviewed)}, while cases analysts must handle rise from ${formatInt(data[0].within)} to ${formatInt(data[data.length - 1].within)}.`
    : undefined;
  return (
    <ChartCard
      title="Capacity trade-off"
      scope={<ScopeBadge scope="rehearsal">Proposed thresholds</ScopeBadge>}
      description="Same thresholds, different review capacities. More capacity puts more known fraud in front of an analyst, at the cost of more cases to review."
      summary={summary}
    >
      <div className="space-y-5">
        <div role="img" aria-label={summary}>
          <div className="mb-2"><Legend items={[{ label: "Known fraud held or reviewed within capacity", color: CHART.teal }, { label: "Known fraud in overflow (not reviewed)", color: CHART.amber }, { label: "Known fraud allowed", color: CHART.red }]} /></div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 18 }}>
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="label" {...axisProps} label={{ value: "Review capacity per batch (cases)", position: "insideBottom", offset: -10, fontSize: 11, fill: CHART.axis }} />
              <YAxis {...axisProps} width={38} allowDecimals={false} />
              <RTooltip cursor={{ fill: "#eef3f8" }} content={(p) => (
                <ChartTip {...p} title={(x) => `Capacity ${x.label} per batch`} rows={(x) => [
                  { label: "Fraud held/reviewed", value: formatInt(x.reviewed), color: CHART.teal },
                  { label: "Fraud in overflow", value: formatInt(x.overflow), color: CHART.amber },
                  { label: "Fraud allowed", value: formatInt(x.allowed), color: CHART.red },
                  { label: "Review cases handled", value: formatInt(x.within) },
                  { label: "…of which legitimate", value: formatInt(x.legitReviewed) },
                ]} />
              )} />
              <Bar dataKey="reviewed" stackId="f" fill={CHART.teal} isAnimationActive={false} />
              <Bar dataKey="overflow" stackId="f" fill={CHART.amber} isAnimationActive={false} />
              <Bar dataKey="allowed" stackId="f" fill={CHART.red} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Table>
          <caption className="sr-only">Capacity sweep results</caption>
          <THead><tr><TH className="text-right">Capacity</TH><TH className="text-right">Review cases handled</TH><TH className="text-right">Of which legitimate</TH><TH className="text-right">Fraud reviewed or held</TH><TH className="text-right">Fraud in overflow</TH><TH className="text-right">Fraud value allowed or unreviewed</TH></tr></THead>
          <TBody>
            {data.map((d) => (
              <TR key={d.cap} className={cn(capacity != null && d.cap === capacity && "bg-primary-soft/60")}>
                <TD className="text-right font-medium">{d.label}</TD><TD className="text-right">{formatInt(d.within)}</TD><TD className="text-right">{formatInt(d.legitReviewed)}</TD>
                <TD className="text-right">{formatInt(d.reviewed)}</TD><TD className="text-right">{formatInt(d.overflow)}</TD><TD className="text-right">{formatAmount(d.value)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </ChartCard>
  );
}
