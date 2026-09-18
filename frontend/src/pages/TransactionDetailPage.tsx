import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardCopy, Eye, FileCheck2, History, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/endpoints";
import { ApiError } from "@/api/client";
import type { Assessment, CasePatch, CaseResponse, ReviewStatus } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Textarea } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/overlay";
import { Skeleton, Table, TBody, TD, TH, THead, TR } from "@/components/ui/misc";
import { ActionBadge, AssessmentBadge, ASSESSMENT_LABEL, OutcomeBadge, RiskBadge, STATUS_LABEL, StatusBadge } from "@/components/shared/badges";
import { ExplanationPanel } from "@/components/shared/explanation";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TableSkeleton } from "@/components/shared/blocks";
import { useActivePolicy, useCase, useExplanation, useSimilar, useTransaction } from "@/hooks/queries";
import { formatAmount, formatDateTime, formatElapsed, formatFeatureValue, formatScore, formatThreshold, NA } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NotFoundPage } from "./NotFoundPage";

const NONE = "none";
const REF_RE = /^TXN-\d{6,}$/;

export function TransactionDetailPage() {
  const { transactionId } = useParams();
  if (!transactionId || !REF_RE.test(transactionId)) return <NotFoundPage />;
  return <Detail id={transactionId} />;
}

function Detail({ id }: { id: string }) {
  const [reveal, setReveal] = useState(false);
  const tx = useTransaction(id, reveal);
  const thresholds = useActivePolicy();

  if (tx.isError) {
    const missing = tx.error instanceof ApiError && tx.error.code === "TRANSACTION_NOT_FOUND";
    return (
      <div className="space-y-4">
        <BackLink />
        {missing ? (
          <Card><EmptyState title={`No transaction ${id}`}>This reference doesn't exist in the dataset. Check it, or search from the investigation queue.</EmptyState></Card>
        ) : (
          <Card><ErrorState error={tx.error} onRetry={() => tx.refetch()} /></Card>
        )}
      </div>
    );
  }

  const t = tx.data;
  return (
    <div className="space-y-6">
      <BackLink />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Case investigation</p>
          <h1 className="text-2xl font-semibold tracking-tight">{id}</h1>
        </div>
        {t && <div className="flex flex-wrap items-center gap-2"><RiskBadge band={t.risk_band} /><ActionBadge action={t.recommended_action} /><StatusBadge status={t.review_status} /></div>}
      </header>

      <SummaryStrip t={t} thresholds={thresholds} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <ExplanationCard id={id} />
          <SimilarCard id={id} />
          <FeatureValuesCard features={t?.features} time={t?.source_time_seconds} amount={t?.amount} loading={tx.isPending} />
        </div>
        <div className="space-y-6">
          <LensesCard t={t} reveal={reveal} onReveal={() => setReveal(true)} />
          <CaseCard id={id} />
        </div>
      </div>
    </div>
  );
}

const BackLink = () => (
  <Link to="/investigation" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Investigation queue</Link>
);

/* ------------------------------------------------------------------------------------------- */

function ScoreScale({ score, review, hold }: { score: number; review?: number; hold?: number }) {
  return (
    <div className="mt-2">
      <div className="relative h-2.5 rounded-full" style={{ background: review != null && hold != null ? `linear-gradient(to right, #cfe8da 0 ${review * 100}%, #f6dfb0 ${review * 100}% ${hold * 100}%, #f3c5cb ${hold * 100}% 100%)` : "#e4eaf1" }} role="img" aria-label={`Score ${formatScore(score)} on a scale from 0 to 1${review != null && hold != null ? `; review starts at ${formatThreshold(review)} and hold at ${formatThreshold(hold)}` : ""}`}>
        {review != null && <span className="absolute -top-1 h-4.5 w-px bg-navy-700/50" style={{ left: `${review * 100}%` }} />}
        {hold != null && <span className="absolute -top-1 h-4.5 w-px bg-navy-700/50" style={{ left: `${hold * 100}%` }} />}
        <span className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-navy-900 shadow" style={{ left: `${Math.min(Math.max(score, 0), 1) * 100}%` }} />
      </div>
      <div className="tabular mt-1.5 flex justify-between text-[11px] text-muted-foreground"><span>0</span>{review != null && <span>review {formatThreshold(review)}</span>}{hold != null && <span>hold {formatThreshold(hold)}</span>}<span>1</span></div>
    </div>
  );
}

function SummaryStrip({ t, thresholds }: { t: ReturnType<typeof useTransaction>["data"]; thresholds: { review: number; hold: number } | null }) {
  if (!t) return <Card><CardContent className="grid grid-cols-1 gap-4 p-5 md:grid-cols-4"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></CardContent></Card>;
  const stat = (label: string, value: React.ReactNode, sub?: React.ReactNode) => (
    <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="tabular mt-0.5 text-lg font-semibold">{value}</dd>{sub && <dd className="text-xs text-muted-foreground">{sub}</dd>}</div>
  );
  return (
    <Card>
      <CardContent className="grid grid-cols-1 gap-x-8 gap-y-5 p-5 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <div>
          <p className="text-xs text-muted-foreground">Model risk score</p>
          <p className="tabular text-3xl font-semibold tracking-tight">{formatScore(t.score)}</p>
          <ScoreScale score={t.score} review={thresholds?.review} hold={thresholds?.hold} />
          <p className="mt-2 text-xs text-muted-foreground">Scale 0 to 1. A ranking score from the model, not a probability of fraud.</p>
        </div>
        <dl className="contents">
          {stat("Amount", formatAmount(t.amount), "plain number, no currency")}
          {stat("Elapsed dataset time", formatElapsed(t.source_time_seconds), "not a clock time")}
          {stat("Data split", t.split === "train" ? "Training" : t.split === "validation" ? "Validation" : "Held-out test", t.cluster_id != null ? `Similarity group ${t.cluster_id}` : undefined)}
        </dl>
      </CardContent>
    </Card>
  );
}

function ExplanationCard({ id }: { id: string }) {
  const q = useExplanation(id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Why the model scored it this way</CardTitle>
        <CardDescription>Transaction-specific feature contributions, not a global ranking of features.</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isPending ? <div className="space-y-2"><Skeleton className="h-6" /><Skeleton className="h-6" /><Skeleton className="h-6" /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} compact /> : <ExplanationPanel explanation={q.data} />}
      </CardContent>
    </Card>
  );
}

function SimilarCard({ id }: { id: string }) {
  const q = useSimilar(id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Similar historical cases</CardTitle>
        <CardDescription>Nearest training-set transactions in the model's standardized feature space. Their outcomes are verified historical labels.</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-1">
        {q.isPending ? <TableSkeleton rows={4} cols={4} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} compact /> : q.data.neighbors.length === 0 ? (
          <EmptyState title="No similar cases found" />
        ) : (
          <>
            <p className="px-5 pb-3 text-[13px]"><span className="tabular font-semibold">{q.data.known_fraud_among_neighbors}</span> of {q.data.k} similar historical cases are known fraud.</p>
            <Table>
              <caption className="sr-only">Similar historical cases</caption>
              <THead><tr><TH>Reference</TH><TH className="text-right">Distance</TH><TH>Elapsed time</TH><TH className="text-right">Amount</TH><TH>Known outcome</TH></tr></THead>
              <TBody>
                {q.data.neighbors.map((n) => (
                  <TR key={n.transaction_ref}>
                    <TD className="font-medium"><Link to={`/investigation/${n.transaction_ref}`} className="text-primary-ink hover:underline">{n.transaction_ref}</Link></TD>
                    <TD className="text-right">{n.distance.toFixed(2)}</TD>
                    <TD className="text-muted-foreground">{formatElapsed(n.source_time_seconds)}</TD>
                    <TD className="text-right">{formatAmount(n.amount)}</TD>
                    <TD><OutcomeBadge outcome={n.known_outcome} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="px-5 py-3 text-xs text-muted-foreground">{q.data.note} Smaller distance means more similar.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FeatureValuesCard({ features, time, amount, loading }: { features?: Record<string, number>; time?: number; amount?: number; loading: boolean }) {
  const rows = useMemo(() => {
    if (!features) return [];
    return [["Time (elapsed s)", time], ...Object.entries(features), ["Amount", amount]] as [string, number | undefined][];
  }, [features, time, amount]);
  return (
    <Card>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg p-5 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-[15px] font-semibold">Original feature values</span>
            <span className="text-[13px] text-muted-foreground">The 30 dataset inputs exactly as supplied to the model. V1 to V28 are anonymous.</span>
          </span>
          <span className="text-xs font-medium text-primary-ink group-open:hidden">Show</span>
          <span className="hidden text-xs font-medium text-primary-ink group-open:inline">Hide</span>
        </summary>
        <div className="border-t">
          {loading ? <TableSkeleton rows={4} cols={4} /> : (
            <div className="grid grid-cols-1 gap-x-8 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 border-b py-1.5 text-[13px]"><span className="text-muted-foreground">{k}</span><span className="tabular font-medium">{k === "Amount" ? formatAmount(v) : formatFeatureValue(v)}</span></div>
              ))}
            </div>
          )}
        </div>
      </details>
    </Card>
  );
}

function LensesCard({ t, reveal, onReveal }: { t: ReturnType<typeof useTransaction>["data"]; reveal: boolean; onReveal: () => void }) {
  const caseQ = useCase(t?.transaction_ref);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Three separate views</CardTitle>
        <CardDescription>A model prediction, an analyst's judgment, and the dataset's known outcome are different things and are never merged.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <section className="rounded-md border p-3.5" aria-label="Model prediction">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model prediction</h3>
          {t ? (
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
              <dt className="text-muted-foreground">Score</dt><dd className="tabular font-medium">{formatScore(t.score)}</dd>
              <dt className="text-muted-foreground">Recommended</dt><dd><ActionBadge action={t.recommended_action} /></dd>
              <dt className="text-muted-foreground">Model version</dt><dd className="break-all text-xs">{t.model_version}</dd>
              <dt className="text-muted-foreground">Policy version</dt><dd className="break-all text-xs">{t.policy_version}</dd>
            </dl>
          ) : <Skeleton className="mt-2 h-16" />}
        </section>
        <section className="rounded-md border p-3.5" aria-label="Analyst judgment">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Analyst judgment</h3>
          {caseQ.data ? (
            <div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={caseQ.data.review_status} /><AssessmentBadge value={caseQ.data.analyst_assessment} /></div>
          ) : caseQ.isError ? <p className="mt-2 text-[13px] text-danger">Couldn't load the case.</p> : <Skeleton className="mt-2 h-6 w-40" />}
          <p className="mt-2 text-xs text-muted-foreground">An opinion recorded in FINEXA. It never changes the dataset label and is not used to retrain the model.</p>
        </section>
        <section className="rounded-md border p-3.5" aria-label="Known historical outcome">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Known historical outcome</h3>
          {t?.known_outcome ? (
            <div className="mt-2"><OutcomeBadge outcome={t.known_outcome} />
              <p className="mt-2 text-xs text-muted-foreground">{t.split === "train" ? "Training reference case: its verified label is part of the historical data." : "Dataset label revealed for this retrospective view."}</p></div>
          ) : t ? (
            <div className="mt-2 space-y-2">
              <p className="text-[13px] text-muted-foreground">Hidden. Held-out labels stay out of scoring views so the model's output isn't judged by peeking at the answer.</p>
              <Button variant="secondary" size="sm" onClick={onReveal} disabled={reveal}><Eye /> Reveal dataset label (retrospective)</Button>
            </div>
          ) : <Skeleton className="mt-2 h-10" />}
        </section>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------- */

function CaseCard({ id }: { id: string }) {
  const qc = useQueryClient();
  const caseQ = useCase(id);
  const c = caseQ.data;
  const [status, setStatus] = useState<ReviewStatus>("unreviewed");
  const [assessment, setAssessment] = useState<Assessment | typeof NONE>(NONE);
  const [note, setNote] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (c) {
      setStatus(c.review_status);
      setAssessment(c.analyst_assessment ?? NONE);
    }
  }, [c?.review_status, c?.analyst_assessment, c?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (body: CasePatch) => api.patchCase(id, body),
    onSuccess: (data) => {
      qc.setQueryData(["case", id], data);
      void qc.invalidateQueries({ queryKey: ["transactions"] });
      void qc.invalidateQueries({ queryKey: ["transaction", id] });
      setNote("");
      setFormError(null);
      setSavedAt(data.updated_at);
      toast.success("Case saved");
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : "Saving failed. Try again.";
      setFormError(msg);
      toast.error(msg);
    },
  });

  const patch = useMemo<CasePatch>(() => {
    const p: CasePatch = {};
    if (c && status !== c.review_status) p.review_status = status;
    const currentAssess = c?.analyst_assessment ?? NONE;
    if (assessment !== currentAssess) p.analyst_assessment = assessment === NONE ? null : assessment;
    if (note.trim()) p.note = note.trim();
    return p;
  }, [c, status, assessment, note]);
  const dirty = Object.keys(patch).length > 0;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending || !dirty) return;
    if (status === "closed" && assessment === NONE) {
      setFormError("Choose an analyst assessment before closing the case.");
      return;
    }
    setFormError(null);
    save.mutate(patch);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Analyst case</CardTitle>
          <CardDescription>Your review status, assessment and notes. Saved to FINEXA with the model and policy versions in effect.</CardDescription>
        </CardHeader>
        <CardContent>
          {caseQ.isPending ? <div className="space-y-3"><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-24" /></div> : caseQ.isError ? <ErrorState error={caseQ.error} onRetry={() => caseQ.refetch()} compact /> : (
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="case-status" className="mb-1.5 block">Review status</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as ReviewStatus)} disabled={save.isPending}>
                    <SelectTrigger id="case-status"><SelectValue /></SelectTrigger>
                    <SelectContent>{(Object.keys(STATUS_LABEL) as ReviewStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="case-assessment" className="mb-1.5 block">Analyst assessment</Label>
                  <Select value={assessment} onValueChange={(v) => setAssessment(v as Assessment | typeof NONE)} disabled={save.isPending}>
                    <SelectTrigger id="case-assessment"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No assessment</SelectItem>
                      {(Object.keys(ASSESSMENT_LABEL) as Assessment[]).map((a) => <SelectItem key={a} value={a}>{ASSESSMENT_LABEL[a]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="case-note" className="mb-1.5 block">Add a note</Label>
                <Textarea id="case-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="What did you check, and what did you conclude?" disabled={save.isPending} aria-describedby="note-help" />
                <p id="note-help" className="mt-1 text-xs text-muted-foreground">Notes are appended and never overwritten. {note.length}/2000</p>
              </div>
              {formError && <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{formError}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" loading={save.isPending} disabled={!dirty}>{save.isPending ? "Saving…" : "Save changes"}</Button>
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {save.isSuccess && savedAt && !dirty ? `Saved ${formatDateTime(savedAt)}` : dirty ? "Unsaved changes" : "No changes to save"}
                </p>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <NotesCard c={c} />
      <HistoryCard c={c} />
      <ReceiptCard c={c} id={id} />
    </>
  );
}

function NotesCard({ c }: { c?: CaseResponse }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><StickyNote className="size-4 text-muted-foreground" aria-hidden /> Analyst notes</CardTitle></CardHeader>
      <CardContent>
        {!c ? <Skeleton className="h-16" /> : c.notes.length === 0 ? <p className="text-[13px] text-muted-foreground">No notes yet.</p> : (
          <ol className="space-y-3">
            {[...c.notes].reverse().map((n) => (
              <li key={n.id} className="rounded-md border bg-background p-3">
                <p className="whitespace-pre-wrap break-words text-sm">{n.note}</p>
                <p className="mt-2 text-xs text-muted-foreground">{n.author ?? "Unknown author"} · {formatDateTime(n.created_at)}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

const FIELD_LABEL: Record<string, string> = { review_status: "Review status", analyst_assessment: "Analyst assessment", note_added: "Note added" };
function historyValue(field: string, v: string | null) {
  if (v == null) return "none";
  if (field === "review_status") return STATUS_LABEL[v as ReviewStatus] ?? v;
  if (field === "analyst_assessment") return ASSESSMENT_LABEL[v as Assessment] ?? v;
  return v;
}

function HistoryCard({ c }: { c?: CaseResponse }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><History className="size-4 text-muted-foreground" aria-hidden /> Decision history</CardTitle></CardHeader>
      <CardContent>
        {!c ? <Skeleton className="h-16" /> : c.history.length === 0 ? <p className="text-[13px] text-muted-foreground">No decisions recorded yet.</p> : (
          <ol className="relative space-y-4 border-l pl-5">
            {[...c.history].reverse().map((h, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
                <p className="text-[13px] font-medium">{FIELD_LABEL[h.field] ?? h.field}{h.field !== "note_added" && <span className="font-normal text-muted-foreground">: {historyValue(h.field, h.old_value)} → {historyValue(h.field, h.new_value)}</span>}</p>
                <p className="tabular text-xs text-muted-foreground">{formatDateTime(h.changed_at)}</p>
                <p className="break-all text-[11px] text-muted-foreground">{h.model_version} · {h.policy_version}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function ReceiptCard({ c, id }: { c?: CaseResponse; id: string }) {
  const rows: [string, string][] = c && c.persisted ? [
    ["Transaction", id],
    ["Model risk score at last update", formatScore(c.score_at_last_update)],
    ["Recommended action then", c.action_at_last_update ?? NA],
    ["Policy version", c.policy_version_at_last_update ?? NA],
    ["Model version", c.model_version_at_last_update ?? NA],
    ["Review status", STATUS_LABEL[c.review_status]],
    ["Analyst assessment", c.analyst_assessment ? ASSESSMENT_LABEL[c.analyst_assessment] : "None"],
    ["Assessed at", formatDateTime(c.assessed_at)],
    ["Last analyst action", formatDateTime(c.updated_at)],
  ] : [];

  async function copy() {
    try {
      await navigator.clipboard.writeText(rows.map(([k, v]) => `${k}: ${v}`).join("\n"));
      toast.success("Receipt copied");
    } catch {
      toast.error("Couldn't copy to the clipboard.");
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2"><FileCheck2 className="size-4 text-muted-foreground" aria-hidden /> Decision receipt</CardTitle>
          <CardDescription className="mt-1">What was known when the analyst last acted on this case.</CardDescription>
        </div>
        {rows.length > 0 && <Button variant="ghost" size="sm" onClick={copy}><ClipboardCopy /> Copy</Button>}
      </CardHeader>
      <CardContent>
        {!c ? <Skeleton className="h-24" /> : rows.length === 0 ? <p className="text-[13px] text-muted-foreground">No analyst action has been recorded, so there is no receipt yet. Save a status, assessment or note to create one.</p> : (
          <dl className="divide-y rounded-md border text-[13px]">
            {rows.map(([k, v]) => (
              <div key={k} className={cn("grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 px-3 py-2")}>
                <dt className="text-muted-foreground">{k}</dt><dd className="tabular break-all font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
