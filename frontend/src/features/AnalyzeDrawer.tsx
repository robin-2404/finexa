import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/endpoints";
import { ApiError } from "@/api/client";
import { FEATURE_NAMES, type AnalyzeResponse, type TransactionSummary } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/overlay";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { ActionBadge, RiskBadge } from "@/components/shared/badges";
import { ExplanationPanel } from "@/components/shared/explanation";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/blocks";
import { useTransactions } from "@/hooks/queries";
import { formatAmount, formatDateTime, formatElapsed, formatScore, formatThreshold } from "@/lib/format";
import { cn } from "@/lib/utils";

type Sample = "random" | "top";

export function AnalyzeDrawer({ open, onOpenChange, returnFocusTo }: { open: boolean; onOpenChange: (o: boolean) => void; returnFocusTo?: React.RefObject<HTMLElement | null> }) {
  const [tab, setTab] = useState("sample");
  const [kind, setKind] = useState<Sample>("random");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<TransactionSummary | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [filling, setFilling] = useState(false);
  const qc = useQueryClient();

  const samples = useTransactions(
    { split: "test", page, page_size: 8, sort: kind === "top" ? "score" : "time", order: kind === "top" ? "desc" : "asc" },
    open,
  );

  const analyze = useMutation({
    mutationFn: api.analyze,
    onSuccess: (r) => { setResult(r); setError(null); },
    onError: (e) => { setResult(null); setError(e); },
  });

  const totalPages = samples.data?.total_pages ?? 1;
  const loadAnother = () => setPage(Math.floor(Math.random() * Math.max(totalPages, 1)) + 1);

  function runSample() {
    if (!selected) return;
    setResult(null);
    analyze.mutate({ transaction_ref: selected.transaction_ref, top_features: 10 });
  }

  async function fillFromSample() {
    if (!selected) return;
    setFilling(true);
    try {
      const d = await qc.fetchQuery({ queryKey: ["transaction", selected.transaction_ref, false], queryFn: () => api.transaction(selected.transaction_ref), staleTime: 30_000 });
      const next: Record<string, string> = { Time: String(d.source_time_seconds), Amount: String(d.amount) };
      for (const [k, v] of Object.entries(d.features)) next[k] = String(v);
      setFields(next);
      setFieldErrors({});
      toast.success(`Filled ${selected.transaction_ref}'s 30 input values. Edit any of them, then analyze.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not load the sample values.");
    } finally {
      setFilling(false);
    }
  }

  function validate(name: string, raw: string | undefined): string | null {
    if (raw == null || raw.trim() === "") return "Required";
    const n = Number(raw);
    if (!Number.isFinite(n)) return "Enter a finite number";
    if ((name === "Time" || name === "Amount") && n < 0) return "Must be 0 or more";
    return null;
  }

  function onAdvanced(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    for (const f of FEATURE_NAMES) {
      const m = validate(f, fields[f]);
      if (m) errs[f] = m;
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      toast.error(`${Object.keys(errs).length} field(s) need attention.`);
      return;
    }
    setResult(null);
    analyze.mutate({ transaction: Object.fromEntries(FEATURE_NAMES.map((f) => [f, Number(fields[f])])), top_features: 10 });
  }

  const errCount = Object.keys(fieldErrors).length;
  const pending = analyze.isPending;
  const serverFieldErrors = useMemo(() => (error instanceof ApiError && error.code === "VALIDATION_ERROR" ? error.details : []), [error]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        side="right" aria-describedby="analyze-desc" className="sm:max-w-[600px]"
        onCloseAutoFocus={(e) => {
          if (returnFocusTo?.current) {
            e.preventDefault();
            returnFocusTo.current.focus(); // the drawer is opened from a plain button, so restore focus explicitly
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Analyze a transaction</DialogTitle>
          <DialogDescription id="analyze-desc">
            Sends one transaction through the real scoring pipeline. Inputs are the dataset's 30 columns only: elapsed Time, Amount and V1 to V28. The verified label is never part of the request.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full">
              <TabsTrigger value="sample" className="flex-1">Held-out sample</TabsTrigger>
              <TabsTrigger value="advanced" className="flex-1">Advanced input</TabsTrigger>
            </TabsList>

            <TabsContent value="sample" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div role="group" aria-label="Sample type" className="inline-flex rounded-md border bg-muted p-0.5">
                  {([["random", "Random sample"], ["top", "Highest model scores"]] as const).map(([k, l]) => (
                    <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setPage(1); setSelected(null); }}
                      className={cn("h-8 rounded px-3 text-[13px]", kind === k ? "bg-card font-medium shadow-card" : "text-muted-foreground hover:text-foreground")}>{l}</button>
                  ))}
                </div>
                <Button variant="secondary" size="sm" onClick={loadAnother} disabled={samples.isFetching || totalPages <= 1}><Shuffle /> Load another sample</Button>
              </div>

              <div className="rounded-lg border">
                {samples.isPending ? <TableSkeleton rows={5} cols={3} /> : samples.isError ? <ErrorState error={samples.error} onRetry={() => samples.refetch()} compact /> : samples.data.items.length === 0 ? (
                  <EmptyState title="No held-out transactions available" />
                ) : (
                  <fieldset>
                    <legend className="sr-only">Choose a held-out transaction</legend>
                    <ul className="divide-y">
                      {samples.data.items.map((t) => {
                        const id = `s-${t.transaction_ref}`;
                        return (
                          <li key={t.transaction_ref}>
                            <label htmlFor={id} className={cn("flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50", selected?.transaction_ref === t.transaction_ref && "bg-primary-soft")}>
                              <input id={id} type="radio" name="sample" className="size-4 accent-primary" checked={selected?.transaction_ref === t.transaction_ref} onChange={() => { setSelected(t); setResult(null); setError(null); }} />
                              <span className="font-medium">{t.transaction_ref}</span>
                              <span className="tabular ml-auto text-xs text-muted-foreground">{formatElapsed(t.source_time_seconds)} · amount {formatAmount(t.amount)}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={runSample} loading={pending && tab === "sample"} disabled={!selected}>Analyze selected transaction</Button>
                {!selected && <p className="self-center text-xs text-muted-foreground">Select a transaction to enable analysis.</p>}
              </div>
            </TabsContent>

            <TabsContent value="advanced">
              <form onSubmit={onAdvanced} noValidate className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] text-muted-foreground">Enter all 30 values. Time and Amount must be 0 or more; every value must be a finite number.</p>
                  <Button type="button" variant="secondary" size="sm" onClick={fillFromSample} disabled={!selected || filling} loading={filling} title={selected ? undefined : "Choose a held-out sample on the other tab first"}>
                    Fill from selected sample
                  </Button>
                </div>
                {!selected && <p className="text-xs text-muted-foreground">Tip: pick a held-out sample on the first tab to enable auto-fill.</p>}
                {errCount > 0 && <p role="alert" className="text-sm font-medium text-danger">{errCount} field{errCount > 1 ? "s" : ""} need attention.</p>}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {FEATURE_NAMES.map((f) => (
                    <Field key={f} id={`adv-${f}`} label={f === "Time" ? "Time (elapsed s)" : f} error={fieldErrors[f]}>
                      <Input
                        id={`adv-${f}`} inputMode="decimal" autoComplete="off" value={fields[f] ?? ""}
                        onChange={(e) => { setFields((s) => ({ ...s, [f]: e.target.value })); if (fieldErrors[f]) setFieldErrors((s) => { const n = { ...s }; delete n[f]; return n; }); }}
                        aria-invalid={!!fieldErrors[f]} aria-describedby={fieldErrors[f] ? `adv-${f}-error` : undefined}
                        className="tabular"
                      />
                    </Field>
                  ))}
                </div>
                <Button type="submit" loading={pending && tab === "advanced"}>Analyze these values</Button>
              </form>
            </TabsContent>
          </Tabs>

          {/* Result */}
          <div className="mt-6" aria-live="polite">
            {pending && <p className="text-sm text-muted-foreground">Scoring…</p>}
            {!!error && (
              <div className="rounded-lg border">
                <ErrorState error={error} compact />
                {serverFieldErrors.length > 0 && (
                  <ul className="border-t px-5 py-3 text-xs text-danger">{serverFieldErrors.slice(0, 6).map((d, i) => <li key={i}>{d.location}: {d.message}</li>)}</ul>
                )}
              </div>
            )}
            {result && <AnalysisResult result={result} onClose={() => onOpenChange(false)} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AnalysisResult({ result: r, onClose }: { result: AnalyzeResponse; onClose: () => void }) {
  return (
    <section className="space-y-4 rounded-lg border bg-background p-4" aria-label="Analysis result">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Model risk score</p>
          <p className="tabular text-3xl font-semibold tracking-tight">{formatScore(r.score)}</p>
          <p className="text-xs text-muted-foreground">Scale 0 to 1. A ranking score, not a probability.</p>
        </div>
        <div className="flex flex-col items-end gap-1.5"><RiskBadge band={r.risk_band} /><ActionBadge action={r.recommended_action} /></div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
        <div><dt className="text-xs text-muted-foreground">Reference</dt><dd className="font-medium">{r.transaction_ref}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Source</dt><dd>{r.source === "ad_hoc" ? "Ad-hoc input" : "Dataset transaction"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Elapsed dataset time</dt><dd className="tabular">{formatElapsed(r.source_time_seconds)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Processed at (actual time)</dt><dd className="tabular">{formatDateTime(r.processed_at)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Thresholds</dt><dd className="tabular">review ≥ {formatThreshold(r.review_threshold)}, hold ≥ {formatThreshold(r.hold_threshold)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Model / policy</dt><dd className="break-all text-xs">{r.model_version} · {r.policy_version}</dd></div>
      </dl>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Why the model scored it this way</h3>
        <ExplanationPanel explanation={r.explanation} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-xs text-muted-foreground">Hold is a simulated recommendation. Nothing is blocked.</p>
        {r.source === "dataset_reference" ? (
          <Button asChild size="sm" variant="secondary"><Link to={`/investigation/${r.transaction_ref}`} onClick={onClose}>Open investigation <ExternalLink /></Link></Button>
        ) : (
          <span className="text-xs text-muted-foreground">Ad-hoc inputs have no dataset case to investigate.</span>
        )}
      </div>
    </section>
  );
}
