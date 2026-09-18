"""Typed request/response schemas for /api/v1."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .services import auth as authlib


class Base(BaseModel):
    model_config = ConfigDict(protected_namespaces=())


class Strict(Base):
    model_config = ConfigDict(protected_namespaces=(), extra="forbid")


# ---- enums -----------------------------------------------------------------------------------
class RiskBand(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class Action(str, Enum):
    allow = "allow"
    review = "review"
    hold = "hold"


class Split(str, Enum):
    train = "train"
    validation = "validation"
    test = "test"


class Outcome(str, Enum):
    legitimate = "legitimate"
    fraud = "fraud"


class ReviewStatus(str, Enum):
    unreviewed = "unreviewed"
    in_review = "in_review"
    closed = "closed"


class Assessment(str, Enum):
    suspected_fraud = "suspected_fraud"
    likely_legitimate = "likely_legitimate"
    inconclusive = "inconclusive"


class SimStatus(str, Enum):
    idle = "idle"
    running = "running"
    paused = "paused"
    completed = "completed"


class SimAction(str, Enum):
    start = "start"
    pause = "pause"
    resume = "resume"
    reset = "reset"
    set_speed = "set_speed"


class SortField(str, Enum):
    time = "time"
    amount = "amount"
    score = "score"


class SortOrder(str, Enum):
    asc = "asc"
    desc = "desc"


# ---- errors ----------------------------------------------------------------------------------
class ErrorDetail(Base):
    location: str | None = None
    message: str
    type: str | None = None


class ErrorBody(Base):
    code: str
    message: str
    details: list[ErrorDetail] = []


class ErrorResponse(Base):
    error: ErrorBody


# ---- health ----------------------------------------------------------------------------------
class HealthResponse(Base):
    status: str = Field(description="'ok' when ready, otherwise 'degraded'.")
    ready: bool
    api_version: str
    model_loaded: bool
    data_loaded: bool
    database_ok: bool
    model_version: str | None
    policy_version: str | None
    reasons: list[str] = Field(description="Why the service is not ready (empty when ready).")
    checked_at: datetime


# ---- explanation / scoring -------------------------------------------------------------------
class Contribution(Base):
    feature: str = Field(description="Anonymous dataset feature name (Time, V1..V28, Amount).")
    value: float = Field(description="Raw input value of the feature for this transaction.")
    contribution: float = Field(description="Signed contribution to the model log-odds (see method).")
    direction: str = Field(description="increases_score | decreases_score | neutral")


class Explanation(Base):
    status: str = Field(description="'available' or 'unavailable'. When unavailable, no reasons are invented.")
    method: str | None
    method_description: str | None
    contribution_scale: str | None = Field(description="'log_odds' when available.")
    additive: bool | None = Field(description="True if baseline_logit + sum(contributions) equals the model log-odds.")
    baseline_logit: float | None
    logit: float | None = Field(description="Model log-odds for this transaction.")
    contributions: list[Contribution]
    unavailable_reason: str | None


class ExplanationResponse(Explanation):
    transaction_ref: str
    model_version: str
    note: str = "Local explanation for this transaction. Features are anonymous; no business meaning is implied."


class Decision(Base):
    transaction_ref: str
    score: float = Field(ge=0, le=1, description="Uncalibrated model ranking score in [0,1]; NOT a probability.")
    risk_band: RiskBand
    recommended_action: Action = Field(description="Simulated recommendation only; nothing is blocked.")
    model_version: str
    policy_version: str
    review_threshold: float
    hold_threshold: float
    explanation: Explanation | None = Field(description="Null only when include_explanation=false.")


class TransactionInput(Strict):
    """The 30 model inputs. The target 'Class' is rejected (extra fields are forbidden)."""

    Time: float = Field(ge=0, allow_inf_nan=False, description="Dataset-relative seconds.")
    V1: float = Field(allow_inf_nan=False)
    V2: float = Field(allow_inf_nan=False)
    V3: float = Field(allow_inf_nan=False)
    V4: float = Field(allow_inf_nan=False)
    V5: float = Field(allow_inf_nan=False)
    V6: float = Field(allow_inf_nan=False)
    V7: float = Field(allow_inf_nan=False)
    V8: float = Field(allow_inf_nan=False)
    V9: float = Field(allow_inf_nan=False)
    V10: float = Field(allow_inf_nan=False)
    V11: float = Field(allow_inf_nan=False)
    V12: float = Field(allow_inf_nan=False)
    V13: float = Field(allow_inf_nan=False)
    V14: float = Field(allow_inf_nan=False)
    V15: float = Field(allow_inf_nan=False)
    V16: float = Field(allow_inf_nan=False)
    V17: float = Field(allow_inf_nan=False)
    V18: float = Field(allow_inf_nan=False)
    V19: float = Field(allow_inf_nan=False)
    V20: float = Field(allow_inf_nan=False)
    V21: float = Field(allow_inf_nan=False)
    V22: float = Field(allow_inf_nan=False)
    V23: float = Field(allow_inf_nan=False)
    V24: float = Field(allow_inf_nan=False)
    V25: float = Field(allow_inf_nan=False)
    V26: float = Field(allow_inf_nan=False)
    V27: float = Field(allow_inf_nan=False)
    V28: float = Field(allow_inf_nan=False)
    Amount: float = Field(ge=0, allow_inf_nan=False)


class AnalyzeRequest(Strict):
    """Provide EITHER `transaction_ref` (a dataset transaction) OR `transaction` (ad-hoc features)."""

    transaction_ref: str | None = Field(default=None, examples=["TXN-000123"])
    transaction: TransactionInput | None = None
    include_explanation: bool = True
    top_features: int = Field(default=10, ge=1, le=30)
    review_threshold: float | None = Field(default=None, ge=0, le=1, description="Optional per-request override.")
    hold_threshold: float | None = Field(default=None, ge=0, le=1, description="Optional per-request override.")

    @model_validator(mode="after")
    def _one_source(self):
        if (self.transaction_ref is None) == (self.transaction is None):
            raise ValueError("Provide exactly one of 'transaction_ref' or 'transaction'")
        return self


class AnalyzeResponse(Decision):
    source: str = Field(description="'dataset_reference' or 'ad_hoc'.")
    source_time_seconds: float = Field(description="Dataset-relative seconds; not a clock time.")
    processed_at: datetime = Field(description="Actual processing time (UTC ISO 8601).")


# ---- transactions ----------------------------------------------------------------------------
class TransactionSummary(Base):
    transaction_ref: str
    split: Split
    source_time_seconds: float = Field(description="Dataset-relative seconds; not a calendar time.")
    source_time_label: str = Field(description="Display form 'T+HH:MM:SS', relative to dataset start.")
    amount: float
    score: float
    risk_band: RiskBand
    recommended_action: Action
    known_outcome: Outcome | None = Field(
        description="Verified dataset label. Null for validation/test rows unless reveal_outcome=true; always shown for train reference rows."
    )
    review_status: ReviewStatus
    analyst_assessment: Assessment | None


class Page(Base):
    page: int
    page_size: int
    total: int
    total_pages: int


class TransactionList(Page):
    items: list[TransactionSummary]
    model_version: str
    policy_version: str


class TransactionDetail(TransactionSummary):
    features: dict[str, float] = Field(description="Raw V1..V28 values.")
    model_version: str
    policy_version: str
    cluster_id: int | None = Field(description="Similarity group id (see /patterns); not a network of actors.")


class SimilarCase(Base):
    transaction_ref: str
    distance: float = Field(description="Euclidean distance in standardized feature space (smaller = more similar).")
    amount: float
    source_time_seconds: float
    known_outcome: Outcome = Field(description="Verified label of this historical training reference case.")
    cluster_id: int | None


class SimilarResponse(Base):
    transaction_ref: str
    reference_set: str
    space: str
    k: int
    neighbors: list[SimilarCase]
    known_fraud_among_neighbors: int
    note: str


class CaseNote(Base):
    id: int
    note: str
    author: str | None
    created_at: datetime
    model_version: str
    policy_version: str


class CaseHistoryItem(Base):
    field: str
    old_value: str | None
    new_value: str | None
    changed_at: datetime
    model_version: str
    policy_version: str


class CurrentContext(Base):
    score: float
    risk_band: RiskBand
    recommended_action: Action
    model_version: str
    policy_version: str


class CaseResponse(Base):
    transaction_ref: str
    persisted: bool = Field(description="False if no analyst activity has been saved yet.")
    review_status: ReviewStatus
    analyst_assessment: Assessment | None = Field(
        description="Analyst opinion. Independent of the verified dataset label and never used for retraining."
    )
    assessed_at: datetime | None
    closed_at: datetime | None
    created_at: datetime | None
    updated_at: datetime | None
    model_version_at_last_update: str | None
    policy_version_at_last_update: str | None
    score_at_last_update: float | None
    action_at_last_update: Action | None
    notes: list[CaseNote]
    history: list[CaseHistoryItem]
    current: CurrentContext


class CasePatch(Strict):
    review_status: ReviewStatus | None = None
    analyst_assessment: Assessment | None = Field(default=None, description="Send null explicitly to clear.")
    note: str | None = Field(default=None, min_length=1, max_length=2000)
    author: str | None = Field(default=None, min_length=1, max_length=80)

    @model_validator(mode="after")
    def _something(self):
        if not ({"review_status", "analyst_assessment", "note"} & self.model_fields_set):
            raise ValueError("Provide at least one of review_status, analyst_assessment, note")
        if "review_status" in self.model_fields_set and self.review_status is None:
            raise ValueError("review_status cannot be null")
        return self


# ---- simulation ------------------------------------------------------------------------------
class SimulationState(Base):
    label: str = "Historical simulation: held-out dataset transactions replayed in dataset-time order. Not live traffic."
    replay_split: str
    status: SimStatus
    run_id: str
    speed: float
    base_events_per_second: float
    effective_events_per_second: float
    total: int
    processed: int
    remaining: int
    cursor: int = Field(description="Sequence number of the last processed event; pass to /simulation/events.")
    started_at: datetime | None
    updated_at: datetime
    last_source_time_seconds: float | None
    by_action: dict[str, int]
    by_risk_band: dict[str, int]
    retrospective: dict[str, Any] | None = Field(description="Only with reveal_outcome=true (reveals held-out labels).")


class SimulationControl(Strict):
    action: SimAction
    speed: float | None = Field(default=None, gt=0, description="Playback multiplier (0.1-1000) of the base event rate.")

    @model_validator(mode="after")
    def _speed_needed(self):
        if self.action == SimAction.set_speed and self.speed is None:
            raise ValueError("speed is required for action 'set_speed'")
        return self


class SimulationEvent(Base):
    event_id: str
    sequence: int
    run_id: str
    transaction_ref: str
    source_time_seconds: float = Field(description="Dataset-relative time of the replayed transaction.")
    source_time_label: str
    processed_at: datetime = Field(description="Wall-clock time this event was processed (UTC).")
    amount: float
    score: float
    risk_band: RiskBand
    recommended_action: Action
    model_version: str
    policy_version: str
    known_outcome: Outcome | None = Field(description="Null unless reveal_outcome=true.")


class SimulationEvents(Base):
    label: str = "Historical simulation"
    run_id: str
    status: SimStatus
    events: list[SimulationEvent]
    next_cursor: int = Field(description="Pass as `cursor` on the next poll.")
    has_more: bool


# ---- dataset / metrics / evaluation ----------------------------------------------------------
class DatasetResponse(Base):
    scope: str = "historical_dataset"
    source_file: str
    fingerprint_sha256: str
    rows: int
    features: list[str]
    target: str
    class_counts: dict[str, Any]
    splits: dict[str, Any]
    time: dict[str, Any]
    amount: dict[str, Any]
    declared_vs_actual: dict[str, Any]
    data_quality: dict[str, Any]


class MetricsResponse(Base):
    historical_dataset: dict[str, Any]
    replay: dict[str, Any]
    evaluation: dict[str, Any]


class ModelEvaluationResponse(Base):
    scope: str = "evaluation"
    model_version: str
    trained_at: str
    selected_model: dict[str, Any]
    candidates: list[dict[str, Any]]
    selection_rule: str
    thresholds: dict[str, Any]
    average_precision_definition: str
    score_note: str
    validation: dict[str, Any]
    test: dict[str, Any]
    caveat: str
    feature_schema: dict[str, Any]
    splits: dict[str, Any]
    explanation_method: dict[str, Any]
    library_versions: dict[str, str]


# ---- patterns --------------------------------------------------------------------------------
class PatternsResponse(Base):
    scope: str = "training_reference"
    note: str
    amount_distribution: list[dict[str, Any]]
    feature_summary: list[dict[str, Any]]
    feature_distribution: dict[str, Any] | None
    global_importance: dict[str, Any]
    clusters: dict[str, Any]


# ---- policy comparison -----------------------------------------------------------------------
class PolicySpec(Strict):
    name: str = Field(min_length=1, max_length=60)
    review_threshold: float = Field(ge=0, le=1)
    hold_threshold: float = Field(ge=0, le=1)
    review_capacity: int | None = Field(default=None, ge=0, description="Max review cases per batch; null = unlimited.")

    @model_validator(mode="after")
    def _ordered(self):
        if not (0 <= self.review_threshold < self.hold_threshold <= 1):
            raise ValueError("Thresholds must satisfy 0 <= review_threshold < hold_threshold <= 1")
        return self


class PolicyCompareRequest(Strict):
    policies: list[PolicySpec] = Field(min_length=1, max_length=10)
    split: Split = Field(default=Split.validation, description="'validation' for tuning; 'test' is final evaluation only.")
    batch_size: int | None = Field(default=None, ge=1, description="Rows per batch in dataset-time order; null = whole split is one batch.")
    acknowledge_final_evaluation: bool = Field(
        default=False, description="Required (true) when split='test' to confirm this is a final evaluation."
    )


class PolicyResult(Base):
    name: str
    review_threshold: float
    hold_threshold: float
    policy_version: str
    metrics: dict[str, Any]


class PolicyCompareResponse(Base):
    scope: str = "policy_rehearsal"
    split: Split
    evaluation_split_note: str
    model_version: str
    results: list[PolicyResult]
    notes: list[str]



# ---- auth ------------------------------------------------------------------------------------
class SignupRequest(Strict):
    email: str = Field(description="Normalised to lower case.")
    password: str = Field(description=authlib.PASSWORD_RULES)

    @field_validator("email")
    @classmethod
    def _email(cls, v):
        return authlib.validate_email(v)

    @field_validator("password")
    @classmethod
    def _password(cls, v, info):
        return authlib.validate_password(v, info.data.get("email"))


class LoginRequest(Strict):
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=authlib.PASSWORD_MAX)


class AuthUser(Base):
    id: int
    email: str
    created_at: datetime


class AuthSession(Base):
    user: AuthUser
    csrf_token: str = Field(description="Send as the X-CSRF-Token header on every POST/PATCH. Keep in memory only.")
    expires_at: datetime = Field(description="Absolute session expiry (UTC).")


class OkResponse(Base):
    ok: bool = True


# ---- overview activity -----------------------------------------------------------------------
class RiskCounts(Base):
    low: int
    medium: int
    high: int


class ActivityBucket(Base):
    start_seconds: float = Field(description="Dataset-relative bucket start (inclusive).")
    end_seconds: float = Field(description="Dataset-relative bucket end (exclusive).")
    label: str = Field(description="Display label of the bucket start, e.g. 'T+04:00:00'.")
    transactions: int
    by_risk_band: RiskCounts
    model_flagged: int = Field(description="Recommended review or hold by the active policy.")
    known_fraud: int | None = Field(description="Verified dataset label count; null unless labels are revealed for this view.")


class ActivityTotals(Base):
    transactions: int
    by_risk_band: RiskCounts
    by_action: dict[str, int]
    model_flagged: int
    known_fraud: int | None


class ActivityResponse(Base):
    scope: str = "historical_dataset"
    split: Split | None
    bucket_seconds: int
    labels_revealed: bool
    buckets: list[ActivityBucket]
    totals: ActivityTotals
    model_version: str
    policy_version: str
    note: str
