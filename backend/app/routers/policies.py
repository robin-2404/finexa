"""Policy rehearsal: compare threshold/capacity settings on labelled held-out data."""
from __future__ import annotations

import numpy as np
from fastapi import APIRouter, Depends

from .. import schemas as S
from ..errors import ApiError
from ..services.policy import Policy, rehearse
from ..services.state import AppState
from .common import require_ready

router = APIRouter()


@router.post(
    "/policies/compare",
    response_model=S.PolicyCompareResponse,
    responses={503: {"model": S.ErrorResponse}, 422: {"model": S.ErrorResponse}},
    tags=["policies"],
    summary="Compare review/hold thresholds and review capacity",
)
def compare_policies(body: S.PolicyCompareRequest, st: AppState = Depends(require_ready)):
    """Defaults to the validation split (for tuning). The test split is reserved for final evaluation and
    requires `acknowledge_final_evaluation=true`. Flagged fraud is NOT verified prevention or recovery."""
    if body.split == S.Split.train:
        raise ApiError(422, "INVALID_SPLIT", "Policy comparison runs on 'validation' (tuning) or 'test' (final evaluation).")
    if body.split == S.Split.test and not body.acknowledge_final_evaluation:
        raise ApiError(
            422, "FINAL_EVALUATION_NOT_ACKNOWLEDGED",
            "The test split is reserved for final evaluation. Set acknowledge_final_evaluation=true to use it; use 'validation' for tuning.",
        )
    idx = np.flatnonzero(st.splits == body.split.value)
    idx = idx[np.argsort(st.df["Time"].to_numpy()[idx], kind="stable")]  # dataset-time order
    scores, labels, amounts = st.scores[idx], st.labels[idx], st.df["Amount"].to_numpy()[idx]
    results = []
    for p in body.policies:
        pol = Policy(p.review_threshold, p.hold_threshold)
        results.append(
            S.PolicyResult(
                name=p.name, review_threshold=pol.review_threshold, hold_threshold=pol.hold_threshold,
                policy_version=pol.version,
                metrics=rehearse(scores, labels, amounts, pol, p.review_capacity, body.batch_size),
            )
        )
    is_test = body.split == S.Split.test
    return S.PolicyCompareResponse(
        split=body.split,
        evaluation_split_note=(
            "FINAL EVALUATION on the reserved test split; do not tune against it." if is_test
            else "Validation split: appropriate for interactive tuning (thresholds were also selected here, so results are optimistic)."
        ),
        model_version=st.model_version, results=results,
        notes=[
            "'Flagged' means recommended for review or hold. It is not verified prevention or recovery.",
            "Review outcomes are not assumed: only cases within capacity count as reviewed, overflow is reported separately, and analyst review is not assumed to succeed.",
            "Holds are automatic simulated recommendations and do not consume review capacity.",
            "Review candidates within each batch are prioritised by descending model score.",
            "Known-fraud counts use verified dataset labels, available only in this retrospective analysis.",
        ],
    )
