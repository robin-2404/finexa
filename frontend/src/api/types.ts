/** Types mirror docs/openapi.json (the implemented backend contract). */

export type RiskBand = "low" | "medium" | "high";
export type Action = "allow" | "review" | "hold";
export type Split = "train" | "validation" | "test";
export type Outcome = "legitimate" | "fraud";
export type ReviewStatus = "unreviewed" | "in_review" | "closed";
export type Assessment = "suspected_fraud" | "likely_legitimate" | "inconclusive";
export type SimStatus = "idle" | "running" | "paused" | "completed";
export type SimAction = "start" | "pause" | "resume" | "reset" | "set_speed";

export const FEATURE_NAMES = ["Time", ...Array.from({ length: 28 }, (_, i) => `V${i + 1}`), "Amount"] as const;
export const V_NAMES = FEATURE_NAMES.filter((n) => n.startsWith("V"));

export interface ApiErrorBody {
  error: { code: string; message: string; details: { location?: string | null; message: string; type?: string | null }[] };
}

export interface AuthUser { id: number; email: string; created_at: string }
export interface AuthSession { user: AuthUser; csrf_token: string; expires_at: string }

export interface Health {
  status: "ok" | "degraded";
  ready: boolean;
  api_version: string;
  model_loaded: boolean;
  data_loaded: boolean;
  database_ok: boolean;
  model_version: string | null;
  policy_version: string | null;
  reasons: string[];
  checked_at: string;
}

export interface ClassBalance {
  legitimate: number;
  fraud: number;
  fraud_prevalence: number;
  imbalance_ratio_legit_per_fraud: number | null;
}
export interface SplitCount {
  rows: number;
  fraud: number;
  legitimate: number;
  fraud_prevalence: number | null;
  distinct_feature_groups: number;
}
export interface DatasetInfo {
  scope: string;
  source_file: string;
  fingerprint_sha256: string;
  rows: number;
  features: string[];
  target: string;
  class_counts: ClassBalance;
  splits: { counts: Record<Split, SplitCount>; [k: string]: unknown };
  time: { min: number; max: number; semantics: string; sorted_by_time_in_file: boolean };
  amount: { min: number; median: number; mean: number; max: number; zero_amount_rows: number };
  declared_vs_actual: {
    declared: { rows: number; legitimate: number; fraud: number };
    actual: { rows: number; legitimate: number; fraud: number };
    matches: boolean;
    note: string;
  };
  data_quality: Record<string, unknown>;
}

export interface Confusion { tn: number; fp: number; fn: number; tp: number }
export interface OperatingPoint {
  threshold: number;
  flagged: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  confusion_matrix: Confusion;
}
export interface SplitEvaluation {
  split: string;
  rows: number;
  fraud: number;
  legitimate: number;
  evaluation_prevalence: number;
  average_precision: number;
  roc_auc: number;
  operating_points: { hold: OperatingPoint; review: OperatingPoint };
  always_legitimate_baseline: {
    description: string;
    confusion_matrix: Confusion;
    precision: number | null;
    recall: number;
    f1: number;
    average_precision: number;
    roc_auc: number;
    accuracy_context_only: number;
  };
}
export interface ModelEvaluation {
  scope: string;
  model_version: string;
  trained_at: string;
  selected_model: { name: string; family: string; params: Record<string, unknown> };
  candidates: { name: string; family: string; selected: boolean; validation: { average_precision: number; roc_auc: number } }[];
  selection_rule: string;
  thresholds: { review: number; hold: number; selection_rule: Record<string, unknown> };
  average_precision_definition: string;
  score_note: string;
  validation: SplitEvaluation;
  test: SplitEvaluation;
  caveat: string;
}

export interface MetricsResponse {
  historical_dataset: { scope: string; rows: number; class_counts: ClassBalance; split_counts: Record<Split, SplitCount>; note: string };
  replay: {
    scope: string;
    status: SimStatus;
    run_id: string;
    processed: number;
    total: number;
    replay_split: string;
    by_action: Record<Action, number>;
    by_risk_band: Record<RiskBand, number>;
  };
  evaluation: Record<string, unknown>;
}

// ---- transactions ----
export interface TransactionSummary {
  transaction_ref: string;
  split: Split;
  source_time_seconds: number;
  source_time_label: string;
  amount: number;
  score: number;
  risk_band: RiskBand;
  recommended_action: Action;
  known_outcome: Outcome | null;
  review_status: ReviewStatus;
  analyst_assessment: Assessment | null;
}
export interface TransactionList {
  items: TransactionSummary[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  model_version: string;
  policy_version: string;
}
export interface TransactionDetail extends TransactionSummary {
  features: Record<string, number>;
  model_version: string;
  policy_version: string;
  cluster_id: number | null;
}
export interface TransactionQuery {
  page?: number;
  page_size?: number;
  split?: Split;
  risk_band?: RiskBand;
  action?: Action;
  min_score?: number;
  max_score?: number;
  min_amount?: number;
  max_amount?: number;
  time_from?: number;
  time_to?: number;
  review_status?: ReviewStatus;
  outcome?: Outcome;
  reveal_outcome?: boolean;
  sort?: "time" | "amount" | "score";
  order?: "asc" | "desc";
}

export interface Contribution { feature: string; value: number; contribution: number; direction: "increases_score" | "decreases_score" | "neutral" }
export interface Explanation {
  status: "available" | "unavailable";
  method: string | null;
  method_description: string | null;
  contribution_scale: string | null;
  additive: boolean | null;
  baseline_logit: number | null;
  logit: number | null;
  contributions: Contribution[];
  unavailable_reason: string | null;
}
export interface ExplanationResponse extends Explanation {
  transaction_ref: string;
  model_version: string;
  note: string;
}

export interface TransactionInput { [feature: string]: number }
export type AnalyzeRequest =
  | { transaction_ref: string; include_explanation?: boolean; top_features?: number; review_threshold?: number; hold_threshold?: number }
  | { transaction: TransactionInput; include_explanation?: boolean; top_features?: number; review_threshold?: number; hold_threshold?: number };
export interface AnalyzeResponse {
  transaction_ref: string;
  score: number;
  risk_band: RiskBand;
  recommended_action: Action;
  model_version: string;
  policy_version: string;
  review_threshold: number;
  hold_threshold: number;
  explanation: Explanation | null;
  source: "dataset_reference" | "ad_hoc";
  source_time_seconds: number;
  processed_at: string;
}

export interface SimilarCase {
  transaction_ref: string;
  distance: number;
  amount: number;
  source_time_seconds: number;
  known_outcome: Outcome;
  cluster_id: number | null;
}
export interface SimilarResponse {
  transaction_ref: string;
  reference_set: string;
  space: string;
  k: number;
  neighbors: SimilarCase[];
  known_fraud_among_neighbors: number;
  note: string;
}

export interface CaseNote { id: number; note: string; author: string | null; created_at: string; model_version: string; policy_version: string }
export interface CaseHistoryItem { field: string; old_value: string | null; new_value: string | null; changed_at: string; model_version: string; policy_version: string }
export interface CaseResponse {
  transaction_ref: string;
  persisted: boolean;
  review_status: ReviewStatus;
  analyst_assessment: Assessment | null;
  assessed_at: string | null;
  closed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  model_version_at_last_update: string | null;
  policy_version_at_last_update: string | null;
  score_at_last_update: number | null;
  action_at_last_update: Action | null;
  notes: CaseNote[];
  history: CaseHistoryItem[];
  current: { score: number; risk_band: RiskBand; recommended_action: Action; model_version: string; policy_version: string };
}
export interface CasePatch {
  review_status?: ReviewStatus;
  analyst_assessment?: Assessment | null;
  note?: string;
  author?: string;
}

// ---- simulation ----
export interface SimulationState {
  label: string;
  replay_split: string;
  status: SimStatus;
  run_id: string;
  speed: number;
  base_events_per_second: number;
  effective_events_per_second: number;
  total: number;
  processed: number;
  remaining: number;
  cursor: number;
  started_at: string | null;
  updated_at: string;
  last_source_time_seconds: number | null;
  by_action: Record<Action, number>;
  by_risk_band: Record<RiskBand, number>;
  retrospective: Record<string, unknown> | null;
}
export interface SimulationEvent {
  event_id: string;
  sequence: number;
  run_id: string;
  transaction_ref: string;
  source_time_seconds: number;
  source_time_label: string;
  processed_at: string;
  amount: number;
  score: number;
  risk_band: RiskBand;
  recommended_action: Action;
  model_version: string;
  policy_version: string;
  known_outcome: Outcome | null;
}
export interface SimulationEvents {
  label: string;
  run_id: string;
  status: SimStatus;
  events: SimulationEvent[];
  next_cursor: number;
  has_more: boolean;
}

// ---- overview / patterns ----
export interface RiskCounts { low: number; medium: number; high: number }
export interface ActivityBucket {
  start_seconds: number;
  end_seconds: number;
  label: string;
  transactions: number;
  by_risk_band: RiskCounts;
  model_flagged: number;
  known_fraud: number | null;
}
export interface ActivityResponse {
  scope: string;
  split: Split | null;
  bucket_seconds: number;
  labels_revealed: boolean;
  buckets: ActivityBucket[];
  totals: { transactions: number; by_risk_band: RiskCounts; by_action: Record<Action, number>; model_flagged: number; known_fraud: number | null };
  model_version: string;
  policy_version: string;
  note: string;
}
export interface ActivityQuery { split?: Split; risk_band?: RiskBand; action?: Action; bucket_seconds?: number; reveal_outcome?: boolean }

export interface AmountBin { label: string; lower: number; upper: number | null; count: number; fraud_count: number; fraud_prevalence: number | null }
export interface FeatureBin { lower: number; upper: number; legitimate_count: number; fraud_count: number }
export interface Cluster {
  cluster_id: number;
  size: number;
  share_of_reference: number;
  fraud_count: number;
  fraud_prevalence: number | null;
  median_amount: number | null;
  mean_amount: number | null;
  low_sample: boolean;
}
export interface ImportanceItem { feature: string; importance: number; signed_coefficient: number | null; importance_std: number | null }
export interface PatternsResponse {
  scope: string;
  note: string;
  amount_distribution: AmountBin[];
  feature_summary: { feature: string; mean: number; std: number; min: number; max: number; median_legitimate: number; median_fraud: number | null }[];
  feature_distribution: { feature: string; bins: FeatureBin[]; range_percentiles: number[]; note: string } | null;
  global_importance: { method: string; computed_on: string; is_local_explanation: boolean; note: string; items: ImportanceItem[] };
  clusters: { algorithm: string; k: number; space: string; fitted_on: string; note: string; items: Cluster[] };
}

// ---- policy comparison ----
export interface PolicySpec { name: string; review_threshold: number; hold_threshold: number; review_capacity: number | null }
export interface PolicyCompareRequest {
  policies: PolicySpec[];
  split: Split;
  batch_size?: number | null;
  acknowledge_final_evaluation?: boolean;
}
export interface PolicyMetrics {
  population: { rows: number; known_fraud: number; known_legitimate: number; fraud_prevalence: number | null; fraud_value_total: number };
  alerts: {
    hold_recommended: number;
    review_demand: number;
    cases_within_capacity: number;
    overflow: number;
    allowed: number;
    batches: number;
    review_capacity_per_batch: number | null;
    batch_size: number | null;
  };
  known_fraud: {
    recommended_hold: number;
    recommended_review: number;
    review_within_capacity: number;
    review_overflow: number;
    allowed: number;
    flagged_total: number;
    flagged_share_of_fraud: number | null;
  };
  known_legitimate: {
    recommended_hold: number;
    recommended_review: number;
    review_within_capacity: number;
    review_overflow: number;
    allowed: number;
    flagged_total: number;
  };
  fraud_value: { recommended_hold: number; review_within_capacity: number; review_overflow: number; allowed: number; allowed_or_unreviewed: number };
  flag_precision: number | null;
}
export interface PolicyResult { name: string; review_threshold: number; hold_threshold: number; policy_version: string; metrics: PolicyMetrics }
export interface PolicyCompareResponse {
  scope: string;
  split: Split;
  evaluation_split_note: string;
  model_version: string;
  results: PolicyResult[];
  notes: string[];
}
