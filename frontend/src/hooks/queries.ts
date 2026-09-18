import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/api/endpoints";
import type { ActivityQuery, TransactionQuery } from "@/api/types";
import { parsePolicyThresholds } from "@/lib/policy";

const MIN = 60_000;

export const useHealth = () =>
  useQuery({ queryKey: ["health"], queryFn: ({ signal }) => api.health(signal), refetchInterval: 10_000, retry: false, staleTime: 5_000 });

export const useDataset = () => useQuery({ queryKey: ["dataset"], queryFn: api.dataset, staleTime: 10 * MIN, retry: false });
export const useMetrics = (refetchMs?: number | false) =>
  useQuery({ queryKey: ["metrics"], queryFn: api.metrics, staleTime: 5_000, refetchInterval: refetchMs ?? false, retry: false });
export const useEvaluation = () => useQuery({ queryKey: ["evaluation"], queryFn: api.evaluation, staleTime: 10 * MIN, retry: false });

export const useActivity = (q: ActivityQuery) =>
  useQuery({ queryKey: ["activity", q], queryFn: () => api.activity(q), staleTime: MIN, retry: false, placeholderData: keepPreviousData });

export const usePatterns = (feature?: string) =>
  useQuery({ queryKey: ["patterns", feature ?? null], queryFn: () => api.patterns(feature), staleTime: 10 * MIN, retry: false, placeholderData: keepPreviousData });

export const useSimulation = (fastPoll = false) =>
  useQuery({
    queryKey: ["simulation"],
    queryFn: () => api.simulation(),
    retry: false,
    staleTime: 0,
    refetchInterval: (q) => (fastPoll || q.state.data?.status === "running" ? 1_000 : 4_000),
  });

export const useTransactions = (q: TransactionQuery, enabled = true) =>
  useQuery({
    queryKey: ["transactions", q],
    queryFn: ({ signal }) => api.transactions(q, signal),
    staleTime: 15_000,
    retry: false,
    enabled,
    placeholderData: keepPreviousData,
  });

export const useTransaction = (id: string | undefined, reveal = false) =>
  useQuery({ queryKey: ["transaction", id, reveal], queryFn: () => api.transaction(id!, reveal), enabled: !!id, staleTime: 30_000, retry: false });

export const useExplanation = (id: string | undefined) =>
  useQuery({ queryKey: ["explanation", id], queryFn: () => api.explanation(id!), enabled: !!id, staleTime: 5 * MIN, retry: false });

export const useSimilar = (id: string | undefined) =>
  useQuery({ queryKey: ["similar", id], queryFn: () => api.similar(id!), enabled: !!id, staleTime: 5 * MIN, retry: false });

export const useCase = (id: string | undefined) =>
  useQuery({ queryKey: ["case", id], queryFn: () => api.getCase(id!), enabled: !!id, staleTime: 0, retry: false });

/**
 * Active policy thresholds. policy_version carries them rounded to 6 decimals; when the saved model thresholds
 * (full precision) agree with that rounding they are used, so comparisons match the backend exactly.
 * If the operator overrode thresholds via environment variables, the parsed values are used as they are.
 */
export function useActivePolicy(): { review: number; hold: number } | null {
  const health = useHealth();
  const evaluation = useEvaluation();
  const parsed = parsePolicyThresholds(health.data?.policy_version);
  if (evaluation.isPending) return null; // wait for the full-precision thresholds rather than briefly using rounded ones
  const saved = evaluation.data ? { review: evaluation.data.thresholds.review, hold: evaluation.data.thresholds.hold } : null;
  if (parsed && saved && Math.abs(parsed.review - saved.review) < 1e-6 && Math.abs(parsed.hold - saved.hold) < 1e-6) return saved;
  return parsed ?? null;
}
