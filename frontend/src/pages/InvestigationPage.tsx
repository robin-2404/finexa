import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import type { ReviewStatus, Split, TransactionQuery } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form";
import { Switch } from "@/components/ui/misc";
import { ActionBadge, RiskBadge } from "@/components/shared/badges";
import { PageHeader } from "@/components/shared/blocks";
import { ALL, BAND_OPTIONS, FilterSelect, SPLIT_HELP, SPLIT_OPTIONS } from "@/components/shared/filters";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TransactionTable } from "@/components/shared/TransactionTable";
import { TableSkeleton } from "@/components/shared/blocks";
import { useActivePolicy, useTransaction, useTransactions } from "@/hooks/queries";
import { useDebounced } from "@/hooks/useDebounced";
import { ApiError } from "@/api/client";
import { formatAmount, formatElapsed, formatInt, formatScore, normalizeRef } from "@/lib/format";

const PAGE_SIZE = 25;
const STATUS_OPTIONS = [
  { value: ALL, label: "Any case status" },
  { value: "unreviewed", label: "Unreviewed" },
  { value: "in_review", label: "In review" },
  { value: "closed", label: "Closed" },
] as const;

const SORTS = [
  { value: "score:desc", label: "Highest model score" },
  { value: "score:asc", label: "Lowest model score" },
  { value: "time:asc", label: "Earliest elapsed time" },
  { value: "time:desc", label: "Latest elapsed time" },
  { value: "amount:desc", label: "Largest amount" },
  { value: "amount:asc", label: "Smallest amount" },
] as const;

const positive = (v: string) => (v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined);

export function InvestigationPage() {
  const [params, setParams] = useSearchParams();
  const get = (k: string, d: string) => params.get(k) ?? d;
  const split = get("split", "test");
  const scope = get("scope", "flagged"); // flagged | hold | review | allow | all
  const band = get("band", ALL);
  const status = get("status", ALL);
  const sortKey = get("sort", "score:desc");
  const reveal = get("reveal", "0") === "1";
  const page = Math.max(1, Number(get("page", "1")) || 1);

  const set = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v == null || v === "" ? next.delete(k) : next.set(k, v);
    if (!keepPage) next.delete("page");
    setParams(next, { replace: true });
  };

  // amount range + search are typed, so they are debounced before hitting the API
  const [minAmount, setMinAmount] = useState(get("min_amount", ""));
  const [maxAmount, setMaxAmount] = useState(get("max_amount", ""));
  const [search, setSearch] = useState("");
  const dMin = useDebounced(minAmount);
  const dMax = useDebounced(maxAmount);
  const dSearch = useDebounced(search);
  useEffect(() => {
    if (dMin !== get("min_amount", "") || dMax !== get("max_amount", "")) set({ min_amount: dMin || null, max_amount: dMax || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dMin, dMax]);

  const thresholds = useActivePolicy();
  const flaggedUnavailable = !thresholds;

  const [sortField, sortOrder] = sortKey.split(":") as ["score" | "time" | "amount", "asc" | "desc"];
  const query: TransactionQuery = {
    page, page_size: PAGE_SIZE,
    split: split === ALL ? undefined : (split as Split),
    risk_band: band === ALL ? undefined : (band as "low"),
    review_status: status === ALL ? undefined : (status as ReviewStatus),
    min_amount: positive(dMin), max_amount: positive(dMax),
    sort: sortField, order: sortOrder, reveal_outcome: reveal,
    ...(scope === "flagged" ? (thresholds ? { min_score: thresholds.review } : { action: "hold" as const }) : scope === "all" ? {} : { action: scope as "hold" }),
  };
  const list = useTransactions(query);

  const ref = normalizeRef(dSearch);
  const found = useTransaction(ref ?? undefined);
  const notFound = found.error instanceof ApiError && found.error.code === "TRANSACTION_NOT_FOUND";

  const total = list.data?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const totalPages = list.data?.total_pages ?? 1;
  const hasFilters = split !== "test" || scope !== "flagged" || band !== ALL || status !== ALL || !!dMin || !!dMax || sortKey !== "score:desc";

  function reset() {
    setMinAmount("");
    setMaxAmount("");
    setParams(new URLSearchParams(), { replace: true });
  }

  const scopeOptions = [
    { value: "flagged", label: "Flagged (review or hold)" },
    { value: "hold", label: "Hold (simulated)" },
    { value: "review", label: "Review" },
    { value: "allow", label: "Allow" },
    { value: "all", label: "Any recommendation" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Investigation"
        description="Model alerts to investigate. Open a transaction for its explanation, similar historical cases, and your notes and assessment."
      />

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <Label htmlFor="ref-search" className="mb-1.5 block text-xs text-muted-foreground">Find a transaction by reference</Label>
          <div className="relative max-w-lg">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="ref-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="TXN-000123 or 123" className="pl-9 pr-9" autoComplete="off" aria-describedby="ref-search-help" />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
            )}
          </div>
          <p id="ref-search-help" className="mt-1.5 text-xs text-muted-foreground">Search matches a transaction reference exactly. The API has no free-text search; use the filters below to narrow the queue.</p>
          <div aria-live="polite" className="mt-3">
            {dSearch.trim() && !ref && <p className="text-sm text-muted-foreground">"{dSearch.trim()}" isn't a transaction reference. Try TXN-000123 or just 123.</p>}
            {ref && found.isPending && <p className="text-sm text-muted-foreground">Looking up {ref}…</p>}
            {ref && notFound && <p className="text-sm text-danger">No transaction has the reference {ref}.</p>}
            {ref && found.isError && !notFound && <ErrorState error={found.error} onRetry={() => found.refetch()} compact />}
            {found.data && ref && (
              <Link to={`/investigation/${found.data.transaction_ref}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-primary-soft/50 px-4 py-3 text-sm hover:bg-primary-soft">
                <span className="font-semibold text-primary-ink">{found.data.transaction_ref}</span>
                <span className="tabular text-muted-foreground">{formatElapsed(found.data.source_time_seconds)} · amount {formatAmount(found.data.amount)} · score {formatScore(found.data.score)}</span>
                <RiskBadge band={found.data.risk_band} /><ActionBadge action={found.data.recommended_action} />
                <span className="ml-auto font-medium text-primary-ink">Open investigation →</span>
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect id="q-split" label="Data split" value={split as Split} onChange={(v) => set({ split: v === "test" ? null : v })} options={[...SPLIT_OPTIONS]} />
          <FilterSelect id="q-scope" label="Recommendation" value={scope} onChange={(v) => set({ scope: v === "flagged" ? null : v })} options={scopeOptions} disabledOptions={flaggedUnavailable ? { flagged: "thresholds unavailable, showing hold" } : undefined} />
          <FilterSelect id="q-band" label="Risk band" value={band as typeof ALL} onChange={(v) => set({ band: v === ALL ? null : v })} options={[...BAND_OPTIONS]} />
          <FilterSelect id="q-status" label="Case status" value={status as typeof ALL} onChange={(v) => set({ status: v === ALL ? null : v })} options={[...STATUS_OPTIONS]} />
          <div>
            <Label htmlFor="q-min" className="mb-1.5 block text-xs text-muted-foreground">Minimum amount</Label>
            <Input id="q-min" inputMode="decimal" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="0" aria-invalid={minAmount !== "" && positive(minAmount) === undefined} />
          </div>
          <div>
            <Label htmlFor="q-max" className="mb-1.5 block text-xs text-muted-foreground">Maximum amount</Label>
            <Input id="q-max" inputMode="decimal" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="No limit" aria-invalid={maxAmount !== "" && positive(maxAmount) === undefined} />
          </div>
          <FilterSelect id="q-sort" label="Sort by" value={sortKey as typeof ALL} onChange={(v) => set({ sort: (v as string) === "score:desc" ? null : (v as string) })} options={SORTS.map((s) => ({ value: s.value, label: s.label })) as never} />
          <div className="flex items-end justify-between gap-3 pb-1.5">
            <div className="flex items-center gap-2">
              <Switch id="q-reveal" checked={reveal} onCheckedChange={(v) => set({ reveal: v ? "1" : null }, true)} />
              <Label htmlFor="q-reveal" className="cursor-pointer text-[13px]">Show known outcomes</Label>
            </div>
            <Button variant="ghost" size="sm" onClick={reset} disabled={!hasFilters && !reveal}>Reset</Button>
          </div>
          {split !== ALL && <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">{SPLIT_HELP[split]}{reveal ? " Known outcomes are the dataset's verified labels, revealed for this retrospective view." : ""}</p>}
        </CardContent>
      </Card>

      {/* Queue */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
          <h2 className="text-[15px] font-semibold">Investigation queue</h2>
          <p className="tabular text-[13px] text-muted-foreground" aria-live="polite">
            {list.isPending ? "Loading…" : total === 0 ? "No results" : `Showing ${formatInt(from)}-${formatInt(to)} of ${formatInt(total)}`}
          </p>
        </div>
        <div className={list.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
          {list.isPending ? <TableSkeleton rows={8} cols={7} /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.data.items.length === 0 ? (
            <EmptyState title="The investigation queue is empty" action={hasFilters ? <Button variant="secondary" size="sm" onClick={reset}>Reset filters</Button> : undefined}>
              {hasFilters ? "No transactions match the current filters." : "No transactions are flagged in this split."}
            </EmptyState>
          ) : (
            <TransactionTable rows={list.data.items} showStatus showOutcome={reveal} showSplit={split === ALL} thresholds={thresholds ?? undefined} caption="Investigation queue" />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
          <p className="tabular text-[13px] text-muted-foreground">Page {formatInt(page)} of {formatInt(Math.max(totalPages, 1))}</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => set({ page: String(page - 1) }, true)} disabled={page <= 1 || list.isFetching}><ChevronLeft /> Previous</Button>
            <Button variant="secondary" size="sm" onClick={() => set({ page: String(page + 1) }, true)} disabled={page >= totalPages || list.isFetching}>Next <ChevronRight /></Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
