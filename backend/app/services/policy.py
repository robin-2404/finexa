"""Decision policy: turns model scores into risk bands and *simulated* recommendations.

This module knows nothing about the model. A "hold" is a recommendation only;
no payment is ever blocked by this system.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..constants import POLICY_FAMILY

LOW, MEDIUM, HIGH = "low", "medium", "high"
ALLOW, REVIEW, HOLD = "allow", "review", "hold"


class PolicyError(ValueError):
    pass


@dataclass(frozen=True)
class Policy:
    review_threshold: float
    hold_threshold: float

    def __post_init__(self):
        validate_thresholds(self.review_threshold, self.hold_threshold)

    @property
    def version(self) -> str:
        return f"{POLICY_FAMILY}:r{self.review_threshold:.6f}:h{self.hold_threshold:.6f}"

    def decide_one(self, score: float) -> tuple[str, str]:
        if score >= self.hold_threshold:
            return HIGH, HOLD
        if score >= self.review_threshold:
            return MEDIUM, REVIEW
        return LOW, ALLOW

    def actions(self, scores: np.ndarray) -> np.ndarray:
        s = np.asarray(scores)
        out = np.full(s.shape, ALLOW, dtype=object)
        out[s >= self.review_threshold] = REVIEW
        out[s >= self.hold_threshold] = HOLD
        return out

    def bands(self, scores: np.ndarray) -> np.ndarray:
        a = self.actions(scores)
        return np.where(a == HOLD, HIGH, np.where(a == REVIEW, MEDIUM, LOW)).astype(object)


def validate_thresholds(review: float, hold: float) -> None:
    for name, v in (("review_threshold", review), ("hold_threshold", hold)):
        if v is None or not np.isfinite(v):
            raise PolicyError(f"{name} must be a finite number")
    if not (0 <= review < hold <= 1):
        raise PolicyError("Thresholds must satisfy 0 <= review_threshold < hold_threshold <= 1")


def rehearse(
    scores: np.ndarray,
    labels: np.ndarray,
    amounts: np.ndarray,
    policy: Policy,
    review_capacity: int | None,
    batch_size: int | None,
) -> dict:
    """Evaluate a policy on rows given in dataset-time order.

    Rows are split into consecutive batches of `batch_size` (whole input = one batch when None).
    Within each batch, review candidates are ranked by descending score (ties keep time order) and the
    first `review_capacity` are "reviewed"; the rest are overflow and are NOT counted as reviewed.
    Holds are automatic recommendations and do not consume review capacity.
    """
    n = len(scores)
    scores, labels, amounts = np.asarray(scores), np.asarray(labels), np.asarray(amounts, dtype=float)
    actions = policy.actions(scores)
    is_hold, is_review, is_allow = actions == HOLD, actions == REVIEW, actions == ALLOW
    fraud = labels == 1

    reviewed = np.zeros(n, dtype=bool)
    size = batch_size or max(n, 1)
    n_batches = 0
    for start in range(0, n, size):
        n_batches += 1
        idx = np.flatnonzero(is_review[start : start + size]) + start
        if review_capacity is None:
            reviewed[idx] = True
        elif review_capacity > 0 and len(idx):
            order = np.argsort(-scores[idx], kind="stable")
            reviewed[idx[order[:review_capacity]]] = True
    overflow = is_review & ~reviewed

    def cnt(m):
        return int(m.sum())

    def val(m):
        return float(amounts[m].sum())

    flagged = is_hold | is_review
    return {
        "population": {
            "rows": n,
            "known_fraud": cnt(fraud),
            "known_legitimate": cnt(~fraud),
            "fraud_prevalence": cnt(fraud) / n if n else None,
            "fraud_value_total": val(fraud),
        },
        "alerts": {
            "hold_recommended": cnt(is_hold),
            "review_demand": cnt(is_review),
            "cases_within_capacity": cnt(reviewed),
            "overflow": cnt(overflow),
            "allowed": cnt(is_allow),
            "batches": n_batches,
            "review_capacity_per_batch": review_capacity,
            "batch_size": batch_size,
        },
        "known_fraud": {
            "recommended_hold": cnt(fraud & is_hold),
            "recommended_review": cnt(fraud & is_review),
            "review_within_capacity": cnt(fraud & reviewed),
            "review_overflow": cnt(fraud & overflow),
            "allowed": cnt(fraud & is_allow),
            "flagged_total": cnt(fraud & flagged),
            "flagged_share_of_fraud": (cnt(fraud & flagged) / cnt(fraud)) if cnt(fraud) else None,
        },
        "known_legitimate": {
            "recommended_hold": cnt(~fraud & is_hold),
            "recommended_review": cnt(~fraud & is_review),
            "review_within_capacity": cnt(~fraud & reviewed),
            "review_overflow": cnt(~fraud & overflow),
            "allowed": cnt(~fraud & is_allow),
            "flagged_total": cnt(~fraud & flagged),
        },
        "fraud_value": {
            "recommended_hold": val(fraud & is_hold),
            "review_within_capacity": val(fraud & reviewed),
            "review_overflow": val(fraud & overflow),
            "allowed": val(fraud & is_allow),
            "allowed_or_unreviewed": val(fraud & (is_allow | overflow)),
        },
        "flag_precision": (cnt(fraud & flagged) / cnt(flagged)) if cnt(flagged) else None,
    }
