import { useState } from "react";
import { FlaskConical, Layers } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { FEATURE_NAMES } from "@/api/types";
import { Badge, Skeleton, Table, TBody, TD, TH, THead, Tabs, TabsContent, TabsList, TabsTrigger, TR } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/overlay";
import { ChartCard, InfoTip, PageHeader, ScopeBadge } from "@/components/shared/blocks";
import { axisProps, CHART, ChartTip, Legend } from "@/components/shared/charts";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { usePatterns } from "@/hooks/queries";
import { formatAmount, formatFeatureValue, formatInt, formatPercent } from "@/lib/format";
import { PolicyRehearsal } from "@/features/PolicyRehearsal";

export function PatternsPage() {
  const [tab, setTab] = useState("patterns");
  return (
    <div>
      <PageHeader title="Pattern Lab" description="Explore how the historical data is structured, then rehearse fraud decision policies against review capacity." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="patterns"><Layers className="size-4" aria-hidden /> Historical Patterns</TabsTrigger>
          <TabsTrigger value="policy"><FlaskConical className="size-4" aria-hidden /> Policy Rehearsal</TabsTrigger>
        </TabsList>
        <TabsContent value="patterns"><HistoricalPatterns /></TabsContent>
        <TabsContent value="policy"><PolicyRehearsal /></TabsContent>
      </Tabs>
    </div>
  );
}

function HistoricalPatterns() {
  const [feature, setFeature] = useState<string>("Amount");
  const q = usePatterns(feature);

  if (q.isError && !q.data) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const d = q.data;
  const dist = d?.feature_distribution;
  const bins = dist?.bins ?? [];
  const legitTotal = bins.reduce((s, b) => s + b.legitimate_count, 0);
  const fraudTotal = bins.reduce((s, b) => s + b.fraud_count, 0);
  const distData = bins.map((b) => ({
    ...b,
    label: formatFeatureValue((b.lower + b.upper) / 2),
    legit_share: legitTotal ? b.legitimate_count / legitTotal : 0,
    fraud_share: fraudTotal ? b.fraud_count / fraudTotal : 0,
  }));
  const summaryRow = d?.feature_summary.find((f) => f.feature === feature);
  const imp = d?.global_importance;
  const impItems = (imp?.items ?? []).slice(0, 12);
  const maxImp = Math.max(...impItems.map((i) => i.importance), 1e-9);
  const clusters = d?.clusters;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-[13px]">
          <ScopeBadge scope="training">Training reference</ScopeBadge>
          <p className="text-muted-foreground">{d?.note ?? "Computed from the labelled training split. Known fraud means the dataset's verified label."}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Feature distribution */}
        <ChartCard
          title="Feature distribution"
          scope={<ScopeBadge scope="training">Training reference</ScopeBadge>}
          description="How a feature's values are spread for legitimate and known-fraud transactions. Bars show each class's share of its own total, so the rare fraud class stays visible."
          right={
            <div className="w-40">
              <Label htmlFor="feat" className="sr-only">Feature</Label>
              <Select value={feature} onValueChange={setFeature}>
                <SelectTrigger id="feat" aria-label="Feature to plot"><SelectValue /></SelectTrigger>
                <SelectContent>{FEATURE_NAMES.map((f) => <SelectItem key={f} value={f}>{f}{f.startsWith("V") ? " (anonymous)" : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          }
          summary={dist && summaryRow ? `${feature}: median ${formatFeatureValue(summaryRow.median_legitimate)} for legitimate vs ${formatFeatureValue(summaryRow.median_fraud)} for known fraud (${formatInt(fraudTotal)} fraud, ${formatInt(legitTotal)} legitimate records). ${dist.note} Range shown: ${dist.range_percentiles[0]}th to ${dist.range_percentiles[1]}th percentile.` : undefined}
        >
          {q.isPending || !dist ? <Skeleton className="h-64 w-full" /> : (
            <div role="img" aria-label={`Histogram of ${feature} for legitimate and fraud transactions`}>
              <Legend items={[{ label: "Legitimate (share of legitimate)", color: CHART.tealSoft }, { label: "Known fraud (share of fraud)", color: CHART.red }]} />
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={distData} margin={{ top: 10, right: 4, left: 0, bottom: 0 }} barGap={0} barCategoryGap="12%">
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={14} />
                  <YAxis {...axisProps} width={46} tickFormatter={(v) => formatPercent(v as number, 0)} />
                  <RTooltip cursor={{ fill: "#eef3f8" }} content={(p) => (
                    <ChartTip {...p} title={(x) => `${feature}: ${formatFeatureValue(x.lower)} to ${formatFeatureValue(x.upper)}`} rows={(x) => [
                      { label: "Legitimate", value: `${formatInt(x.legitimate_count)} (${formatPercent(x.legit_share, 1)})`, color: CHART.tealSoft },
                      { label: "Known fraud", value: `${formatInt(x.fraud_count)} (${formatPercent(x.fraud_share, 1)})`, color: CHART.red },
                    ]} />
                  )} />
                  <Bar dataKey="legit_share" fill={CHART.tealSoft} isAnimationActive={false} />
                  <Bar dataKey="fraud_share" fill={CHART.red} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        {/* Global importance */}
        <ChartCard
          title="Model-wide feature importance"
          scope={<ScopeBadge scope="training">{imp?.computed_on ?? "Model"}</ScopeBadge>}
          description="Which features the model relies on overall. This is not an explanation of any single transaction."
          summary={imp ? `Method: ${imp.method}. Features are anonymous; importance does not imply meaning or causation.` : undefined}
        >
          {q.isPending || !imp ? <Skeleton className="h-64 w-full" /> : impItems.length === 0 ? <EmptyState title="Importance is not available for this model" /> : (
            <div role="img" aria-label={`Top features by importance: ${impItems.slice(0, 5).map((i) => i.feature).join(", ")}`}>
              <ResponsiveContainer width="100%" height={Math.max(220, impItems.length * 26 + 20)}>
                <BarChart data={impItems} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke={CHART.grid} />
                  <XAxis type="number" {...axisProps} domain={[0, maxImp]} tickFormatter={(v) => Number(v).toFixed(2)} />
                  <YAxis type="category" dataKey="feature" {...axisProps} width={48} />
                  <RTooltip cursor={{ fill: "#eef3f8" }} content={(p) => (
                    <ChartTip {...p} title={(x) => `${x.feature} (anonymous feature)`} rows={(x) => [
                      { label: "Importance", value: Number(x.importance).toFixed(4), color: CHART.teal },
                      ...(x.importance_std != null ? [{ label: "Variation across repeats", value: `±${Number(x.importance_std).toFixed(4)}` }] : []),
                    ]} />
                  )} />
                  <Bar dataKey="importance" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                    {impItems.map((i) => <Cell key={i.feature} fill={CHART.teal} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Similarity groups */}
      <ChartCard
        title="Similarity groups"
        scope={<ScopeBadge scope="training">Training reference</ScopeBadge>}
        description="Groups of similar records found by clustering. They are not criminal networks, rings, or linked accounts."
        summary={clusters ? `${clusters.note} Groups were fitted on ${clusters.fitted_on} data (${clusters.algorithm}, k = ${clusters.k}); the sample sizes below show how much evidence each prevalence rests on.` : undefined}
      >
        {q.isPending || !clusters ? <Skeleton className="h-64 w-full" /> : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <div role="img" aria-label="Known fraud prevalence by similarity group">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">Known fraud prevalence by group <InfoTip label="About prevalence">Known fraud records divided by the group's size, from the training reference labels. Small samples make this unreliable.</InfoTip></p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={clusters.items} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="cluster_id" {...axisProps} tickFormatter={(v) => `G${v}`} />
                  <YAxis {...axisProps} width={48} tickFormatter={(v) => formatPercent(v as number, 1)} />
                  <RTooltip cursor={{ fill: "#eef3f8" }} content={(p) => (
                    <ChartTip {...p} title={(x) => `Similarity group ${x.cluster_id}`} rows={(x) => [
                      { label: "Records in group", value: formatInt(x.size), color: CHART.teal },
                      { label: "Known fraud", value: formatInt(x.fraud_count), color: CHART.red },
                      { label: "Fraud prevalence", value: formatPercent(x.fraud_prevalence, 2) },
                      ...(x.low_sample ? [{ label: "Note", value: "few fraud cases; unreliable" }] : []),
                    ]} />
                  )} />
                  <Bar dataKey="fraud_prevalence" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {clusters.items.map((c) => <Cell key={c.cluster_id} fill={c.low_sample ? CHART.tealSoft : CHART.red} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-2 text-xs text-muted-foreground">Light bars: groups with fewer than 10 known fraud cases, so their prevalence is unreliable.</p>
            </div>
            <Table>
              <caption className="sr-only">Similarity groups with sample sizes and known fraud prevalence</caption>
              <THead><tr><TH>Group</TH><TH className="text-right">Records</TH><TH className="text-right">Known fraud</TH><TH className="text-right">Prevalence</TH><TH className="text-right">Median amount</TH><TH>Sample</TH></tr></THead>
              <TBody>
                {[...clusters.items].sort((a, b) => (b.fraud_prevalence ?? 0) - (a.fraud_prevalence ?? 0)).map((c) => (
                  <TR key={c.cluster_id}>
                    <TD className="font-medium">G{c.cluster_id}</TD>
                    <TD className="text-right">{formatInt(c.size)}</TD>
                    <TD className="text-right">{formatInt(c.fraud_count)}</TD>
                    <TD className="text-right">{formatPercent(c.fraud_prevalence, 2)}</TD>
                    <TD className="text-right">{formatAmount(c.median_amount)}</TD>
                    <TD>{c.low_sample ? <Badge tone="amber">Small: unreliable</Badge> : <Badge tone="green">Adequate</Badge>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
