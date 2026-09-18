import { get, patch, post } from "./client";
import type {
  ActivityQuery, ActivityResponse, AnalyzeRequest, AnalyzeResponse, AuthSession, CasePatch, CaseResponse, DatasetInfo,
  ExplanationResponse, Health, MetricsResponse, ModelEvaluation, PatternsResponse, PolicyCompareRequest,
  PolicyCompareResponse, SimAction, SimilarResponse, SimulationEvents, SimulationState, TransactionDetail,
  TransactionList, TransactionQuery,
} from "./types";

const noAuthRedirect = { skipUnauthorizedHandler: true } as const;

export const api = {
  // auth
  signup: (email: string, password: string) => post<AuthSession>("/auth/signup", { email, password }, noAuthRedirect),
  login: (email: string, password: string) => post<AuthSession>("/auth/login", { email, password }, noAuthRedirect),
  logout: () => post<{ ok: boolean }>("/auth/logout", undefined, noAuthRedirect),
  me: (signal?: AbortSignal) => get<AuthSession>("/auth/me", undefined, signal),

  // system
  health: (signal?: AbortSignal) => get<Health>("/health", undefined, signal),
  dataset: () => get<DatasetInfo>("/dataset"),
  metrics: () => get<MetricsResponse>("/metrics"),
  evaluation: () => get<ModelEvaluation>("/model/evaluation"),
  activity: (q: ActivityQuery) => get<ActivityResponse>("/overview/activity", { ...q }),
  patterns: (feature?: string) => get<PatternsResponse>("/patterns", { feature }),

  // transactions
  transactions: (q: TransactionQuery, signal?: AbortSignal) => get<TransactionList>("/transactions", { ...q }, signal),
  transaction: (id: string, reveal_outcome = false) => get<TransactionDetail>(`/transactions/${encodeURIComponent(id)}`, { reveal_outcome }),
  explanation: (id: string, top_features = 12) => get<ExplanationResponse>(`/transactions/${encodeURIComponent(id)}/explanation`, { top_features }),
  similar: (id: string, k = 6) => get<SimilarResponse>(`/transactions/${encodeURIComponent(id)}/similar`, { k }),
  getCase: (id: string) => get<CaseResponse>(`/transactions/${encodeURIComponent(id)}/case`),
  patchCase: (id: string, body: CasePatch) => patch<CaseResponse>(`/transactions/${encodeURIComponent(id)}/case`, body),
  analyze: (body: AnalyzeRequest) => post<AnalyzeResponse>("/analyze", body),

  // simulation
  simulation: (reveal_outcome = false) => get<SimulationState>("/simulation", { reveal_outcome }),
  simControl: (action: SimAction, speed?: number) => post<SimulationState>("/simulation/control", speed === undefined ? { action } : { action, speed }),
  simEvents: (q: { cursor: number; limit?: number; run_id?: string }, signal?: AbortSignal) =>
    get<SimulationEvents>("/simulation/events", { ...q }, signal),

  // policies
  comparePolicies: (body: PolicyCompareRequest) => post<PolicyCompareResponse>("/policies/compare", body),
};
