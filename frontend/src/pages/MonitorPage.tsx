import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Pause, Play, RotateCcw, Search, Snowflake, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/endpoints";
import { ApiError } from "@/api/client";
import type { RiskBand, SimAction, SimulationEvent, SimulationState } from "@/api/types";
import { AnalyzeDrawer } from "@/features/AnalyzeDrawer";
import { ConstellationGrid } from "@/components/ui/constellation-grid";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/overlay";
import { Badge, Skeleton, Switch, Table, TBody, TD, TH, THead, TR } from "@/components/ui/misc";
import { ActionBadge, RiskBadge, ScoreCell, SimStatusBadge } from "@/components/shared/badges";
import { MetricCard, PageHeader, ScopeBadge } from "@/components/shared/blocks";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { useActivePolicy, useSimulation } from "@/hooks/queries";
import { useSimulationStream } from "@/hooks/useSimulationStream";
import { formatAmount, formatClock, formatElapsed, formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";

const SPEEDS = [0.5, 1, 2, 5, 10, 25, 50, 100];
const BAND_FILTERS: { value: RiskBand | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

function reasonFor(action: SimAction, s: SimulationState | undefined): string | null {
  if (!s) return "Waiting for the simulation state.";
  switch (action) {
    case "start": return s.status === "idle" ? null : s.status === "completed" ? "The replay is complete. Reset it to run again." : "The replay has already started. Use Resume or Reset.";
    case "pause": return s.status === "running" ? null : "Pause is available while the replay is running.";
    case "resume": return s.status === "paused" ? null : "Resume is available while the replay is paused.";
    case "reset": return s.status === "idle" && s.processed === 0 ? "Nothing to reset yet." : null;
    default: return null;
  }
}

export function MonitorPage() {
  const qc = useQueryClient();
  const sim = useSimulation(true);
  const thresholds = useActivePolicy();
  const stream = useSimulationStream();
  const [speed, setSpeed] = useState<number | null>(null);
  const [band, setBand] = useState<RiskBand | "all">("all");
  const [freeze, setFreeze] = useState(false);
  const [frozen, setFrozen] = useState<SimulationEvent[]>([]);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const analyzeBtn = useRef<HTMLButtonElement>(null);

  const s = sim.data;
  const effectiveSpeed = speed ?? s?.speed ?? 1;

  const control = useMutation({
    mutationFn: ({ action, speed: sp }: { action: SimAction; speed?: number }) => api.simControl(action, sp),
    onSuccess: (data, vars) => {
      qc.setQueryData(["simulation"], data);
      void qc.invalidateQueries({ queryKey: ["metrics"] });
      if (vars.action === "reset") {
        stream.notifyReset();
        setSpeed(null);
      }
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "The simulation request failed."),
  });
  const busy = control.isPending;
  const run = (action: SimAction, sp?: number) => control.mutate({ action, speed: sp });

  const shown = freeze ? frozen : stream.events;
  const visible = useMemo(() => (band === "all" ? shown : shown.filter((e) => e.risk_band === band)), [shown, band]);

  function toggleFreeze(v: boolean) {
    setFreeze(v);
    if (v) setFrozen(stream.events);
  }
  function changeSpeed(v: string) {
    const n = Number(v);
    setSpeed(n);
    if (s && (s.status === "running" || s.status === "paused")) run("set_speed", n);
  }

  const rate = (s?.base_events_per_second ?? 5) * effectiveSpeed;
  const connectionBadge =
    stream.connection === "live" ? <Badge tone="green">Stream connected</Badge>
    : stream.connection === "reconnecting" ? <Badge tone="amber"><WifiOff aria-hidden /> Reconnecting…</Badge>
    : <Badge tone="neutral">Connecting…</Badge>;

  const controls: { action: SimAction; label: string; icon: React.ReactNode; primary?: boolean }[] = [
    { action: "start", label: "Start", icon: <Play />, primary: true },
    { action: "pause", label: "Pause", icon: <Pause /> },
    { action: "resume", label: "Resume", icon: <Play /> },
    { action: "reset", label: "Reset", icon: <RotateCcw /> },
  ];
  const unavailable = controls.map((c) => ({ c, why: reasonFor(c.action, s) })).filter((x) => x.why);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Monitor"
        description={<>A <strong className="font-semibold">historical simulation</strong>: held-out transactions replayed in dataset-time order through the real scoring pipeline. Not live traffic, and verified labels are never shown here.</>}
        actions={<Button ref={analyzeBtn} onClick={() => setAnalyzeOpen(true)}><FlaskConical /> Analyze transaction</Button>}
      />

      {sim.isError ? (
        <Card><ErrorState error={sim.error} onRetry={() => sim.refetch()} /></Card>
      ) : (
        <>
          <Card>
            <CardContent className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ScopeBadge scope="replay">Replay of held-out {s?.replay_split ?? "test"} split</ScopeBadge>
                  {s ? <SimStatusBadge status={s.status} /> : <Skeleton className="h-5 w-24" />}
                  {connectionBadge}
                </div>
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Simulation controls">
                  {controls.map(({ action, label, icon, primary }) => {
                    const why = reasonFor(action, s);
                    return (
                      <Button
                        key={action} variant={primary ? "default" : "secondary"} onClick={() => run(action, action === "start" || action === "resume" ? effectiveSpeed : undefined)}
                        disabled={!!why || busy} title={why ?? undefined} aria-describedby={why ? "sim-why" : undefined}
                      >
                        {icon}{label}
                      </Button>
                    );
                  })}
                </div>
                {unavailable.length > 0 && (
                  <p id="sim-why" className="text-xs text-muted-foreground">
                    {unavailable.map(({ c, why }) => <span key={c.action} className="mr-3 inline-block"><span className="font-medium">{c.label}:</span> {why}</span>)}
                  </p>
                )}
              </div>
              <div className="w-full lg:w-64">
                <Label htmlFor="speed" className="mb-1.5 block text-xs text-muted-foreground">Playback speed</Label>
                <Select value={String(effectiveSpeed)} onValueChange={changeSpeed} disabled={!s || busy}>
                  <SelectTrigger id="speed"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[...new Set([...SPEEDS, effectiveSpeed])].sort((a, b) => a - b).map((v) => <SelectItem key={v} value={String(v)}>{v}× · about {formatInt(Math.round((s?.base_events_per_second ?? 5) * v))} events/s</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="mt-1.5 text-xs text-muted-foreground">Now about <span className="tabular">{formatInt(Math.round(rate))}</span> events per second. Speed changes apply immediately while running or paused.</p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Processed" loading={!s} value={s ? formatInt(s.processed) : ""} sub={s && `of ${formatInt(s.total)} (${formatInt(s.remaining)} remaining)`} definition="Transactions replayed through the scoring pipeline so far in this run." className="xl:col-span-2" />
            <MetricCard label="Allow" loading={!s} value={s ? formatInt(s.by_action.allow) : ""} sub="Model score below the review threshold" />
            <MetricCard label="Review" loading={!s} tone="amber" value={s ? formatInt(s.by_action.review) : ""} sub="Recommended for analyst review" />
            <MetricCard label="Hold (simulated)" loading={!s} tone="red" value={s ? formatInt(s.by_action.hold) : ""} sub="Simulated recommendation only" />
          </div>
          {s && (
            <div className="-mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Replay progress" aria-valuemin={0} aria-valuemax={s.total} aria-valuenow={s.processed}>
              <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${s.total ? (s.processed / s.total) * 100 : 0}%` }} />
            </div>
          )}

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Transaction events</CardTitle>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Newest first. Showing the latest {formatInt(stream.events.length)} received events{stream.skipped > 0 ? ` (${formatInt(stream.skipped)} earlier events were skipped when you opened this page)` : ""}. Risk filters apply to these buffered events.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <div role="group" aria-label="Filter by risk band" className="inline-flex rounded-md border bg-muted p-0.5">
                  {BAND_FILTERS.map((b) => (
                    <button key={b.value} type="button" aria-pressed={band === b.value} onClick={() => setBand(b.value)}
                      className={cn("h-8 rounded px-3 text-[13px]", band === b.value ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground")}>{b.label}</button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="freeze" checked={freeze} onCheckedChange={toggleFreeze} />
                  <Label htmlFor="freeze" className="flex cursor-pointer items-center gap-1.5 text-[13px]"><Snowflake className="size-3.5" aria-hidden />Freeze view</Label>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {stream.connection === "reconnecting" && (
                <p role="status" className="mx-5 mb-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] text-warning">Connection to the backend was lost. Retrying automatically; events resume from where they left off without duplicates.</p>
              )}
              {visible.length === 0 ? (
                <EmptyState
                  className="min-h-64"
                  visual={<ConstellationGrid theme="light" spacing={64} intensity={0.9} showLabels={false} interactive={false} />}
                  icon={<Search className="size-5" aria-hidden />}
                  title={stream.events.length === 0 ? (s?.status === "idle" ? "The replay hasn't started" : "Waiting for events…") : "No events match this risk filter"}
                >
                  {stream.events.length === 0
                    ? s?.status === "idle" ? "Press Start to replay held-out transactions through the model." : "Events appear here as the replay processes transactions."
                    : "Choose \"All\" to see every buffered event."}
                </EmptyState>
              ) : (
                <Table wrapperClassName="max-h-[560px] border-t" >
                  <caption className="sr-only">Replayed transactions with model risk scores, newest first</caption>
                  <THead>
                    <tr>
                      <TH>Reference</TH>
                      <TH>Elapsed dataset time</TH>
                      <TH className="text-right">Amount</TH>
                      <TH className="text-right">Model risk score</TH>
                      <TH>Risk band</TH>
                      <TH>Recommended</TH>
                      <TH className="hidden lg:table-cell" title="Actual time the backend processed the event (not dataset time)">Processed (clock)</TH>
                      <TH><span className="sr-only">Investigate</span></TH>
                    </tr>
                  </THead>
                  <TBody>
                    {visible.map((e) => (
                      <TR key={e.event_id} className="motion-safe:animate-row-in">
                        <TD className="font-medium">{e.transaction_ref}</TD>
                        <TD className="whitespace-nowrap text-muted-foreground">{formatElapsed(e.source_time_seconds)}</TD>
                        <TD className="text-right">{formatAmount(e.amount)}</TD>
                        <TD><ScoreCell score={e.score} review={thresholds?.review} hold={thresholds?.hold} /></TD>
                        <TD><RiskBadge band={e.risk_band} /></TD>
                        <TD><ActionBadge action={e.recommended_action} /></TD>
                        <TD className="hidden whitespace-nowrap text-xs text-muted-foreground lg:table-cell">{formatClock(e.processed_at)}</TD>
                        <TD className="text-right">
                          <Button asChild variant="ghost" size="sm"><Link to={`/investigation/${e.transaction_ref}`} aria-label={`Investigate ${e.transaction_ref}`}>Investigate</Link></Button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
      <AnalyzeDrawer open={analyzeOpen} onOpenChange={setAnalyzeOpen} returnFocusTo={analyzeBtn} />
    </div>
  );
}
