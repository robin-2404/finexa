"""Transaction browsing, analysis, explanation, similarity, and analyst cases."""
from __future__ import annotations

from datetime import datetime, timezone
import math

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, Path, Query

from .. import schemas as S
from ..constants import FEATURE_COLUMNS, V_COLUMNS, make_ref, time_label
from ..errors import ApiError
from ..ml.similarity import to_similarity_space
from ..services.scoring import InputValidationError
from ..services.state import AppState
from .common import adhoc_ref, current_user, explain_frame, parse_dt, require_ready, resolve_policy

router = APIRouter()
ERR = {503: {"model": S.ErrorResponse}, 404: {"model": S.ErrorResponse}, 422: {"model": S.ErrorResponse}}
REF_PATH = Path(description="Transaction reference, e.g. TXN-000123", pattern=r"^TXN-\d{6,}$")


def _pos(st: AppState, ref: str) -> int:
    pos = st.position_of(ref)
    if pos is None:
        raise ApiError(404, "TRANSACTION_NOT_FOUND", f"No transaction with reference '{ref}'.")
    return pos


def _summary(st: AppState, pos: int, reveal: bool, case: tuple[str, str | None] | None) -> dict:
    t = float(st.df["Time"].iat[pos])
    return {
        "transaction_ref": make_ref(pos),
        "split": st.splits[pos],
        "source_time_seconds": t,
        "source_time_label": time_label(t),
        "amount": float(st.df["Amount"].iat[pos]),
        "score": float(st.scores[pos]),
        "risk_band": st.bands[pos],
        "recommended_action": st.actions[pos],
        "known_outcome": st.outcome(pos, reveal),
        "review_status": case[0] if case else "unreviewed",
        "analyst_assessment": case[1] if case else None,
    }


@router.get("/transactions", response_model=S.TransactionList, responses=ERR, tags=["transactions"], summary="Paginated, filterable transaction list")
def list_transactions(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    split: S.Split | None = None,
    risk_band: S.RiskBand | None = None,
    action: S.Action | None = None,
    min_score: float | None = Query(None, ge=0, le=1),
    max_score: float | None = Query(None, ge=0, le=1),
    min_amount: float | None = Query(None, ge=0),
    max_amount: float | None = Query(None, ge=0),
    time_from: float | None = Query(None, ge=0, description="Dataset-relative seconds (inclusive)."),
    time_to: float | None = Query(None, ge=0, description="Dataset-relative seconds (inclusive)."),
    review_status: S.ReviewStatus | None = None,
    outcome: S.Outcome | None = Query(None, description="Filter by verified label. For validation/test rows requires reveal_outcome=true."),
    reveal_outcome: bool = Query(False, description="Include verified labels for validation/test rows (retrospective views only)."),
    sort: S.SortField = S.SortField.time,
    order: S.SortOrder = S.SortOrder.asc,
    st: AppState = Depends(require_ready),
):
    if min_score is not None and max_score is not None and min_score > max_score:
        raise ApiError(422, "INVALID_FILTER", "min_score must be <= max_score.")
    if min_amount is not None and max_amount is not None and min_amount > max_amount:
        raise ApiError(422, "INVALID_FILTER", "min_amount must be <= max_amount.")
    if time_from is not None and time_to is not None and time_from > time_to:
        raise ApiError(422, "INVALID_FILTER", "time_from must be <= time_to.")
    if outcome is not None and not reveal_outcome and split != S.Split.train:
        raise ApiError(422, "OUTCOME_REVEAL_REQUIRED", "Filtering by outcome needs reveal_outcome=true (or split=train).")

    times = st.df["Time"].to_numpy()
    amounts = st.df["Amount"].to_numpy()
    mask = np.ones(len(st.scores), dtype=bool)
    if split:
        mask &= st.splits == split.value
    if risk_band:
        mask &= st.bands == risk_band.value
    if action:
        mask &= st.actions == action.value
    if min_score is not None:
        mask &= st.scores >= min_score
    if max_score is not None:
        mask &= st.scores <= max_score
    if min_amount is not None:
        mask &= amounts >= min_amount
    if max_amount is not None:
        mask &= amounts <= max_amount
    if time_from is not None:
        mask &= times >= time_from
    if time_to is not None:
        mask &= times <= time_to
    if outcome is not None:
        mask &= st.labels == (1 if outcome == S.Outcome.fraud else 0)
    if review_status is not None:
        refs = st.db.statuses(review_status.value) if review_status != S.ReviewStatus.unreviewed else None
        if refs is None:
            reviewed = st.db.statuses("in_review") | st.db.statuses("closed")
            for r in reviewed:
                p = st.position_of(r)
                if p is not None:
                    mask[p] = False
        else:
            keep = np.zeros_like(mask)
            for r in refs:
                p = st.position_of(r)
                if p is not None:
                    keep[p] = True
            mask &= keep

    idx = np.flatnonzero(mask)
    key = {"time": times, "amount": amounts, "score": st.scores}[sort.value][idx]
    o = np.argsort(key, kind="stable")
    if order == S.SortOrder.desc:
        o = o[::-1]
    idx = idx[o]
    total = len(idx)
    start = (page - 1) * page_size
    page_idx = idx[start : start + page_size]
    cases = st.db.status_for([make_ref(int(p)) for p in page_idx])
    items = [_summary(st, int(p), reveal_outcome, cases.get(make_ref(int(p)))) for p in page_idx]
    return S.TransactionList(
        items=items, page=page, page_size=page_size, total=total,
        total_pages=math.ceil(total / page_size) if total else 0,
        model_version=st.model_version, policy_version=st.policy.version,
    )


@router.post("/analyze", response_model=S.AnalyzeResponse, responses=ERR, tags=["scoring"], summary="Score one transaction (dataset reference or ad-hoc features)")
def analyze(body: S.AnalyzeRequest, st: AppState = Depends(require_ready)):
    """Pipeline: validate -> saved preprocessing -> model score -> explanation -> decision policy.
    The target label is never accepted. `recommended_action` is a simulated recommendation only."""
    policy = resolve_policy(st, body.review_threshold, body.hold_threshold)
    if body.transaction_ref is not None:
        ref = body.transaction_ref
        pos = st.position_of(ref)
        if pos is None:
            raise ApiError(404, "TRANSACTION_NOT_FOUND", f"No transaction with reference '{ref}'.")
        frame, source = st.row_frame(pos), "dataset_reference"
    else:
        frame = pd.DataFrame([body.transaction.model_dump()])[FEATURE_COLUMNS]
        ref, source = adhoc_ref(frame), "ad_hoc"
    try:
        score = float(st.scorer.score(frame)[0])
    except InputValidationError as exc:
        raise ApiError(422, "INVALID_TRANSACTION", str(exc))
    band, action = policy.decide_one(score)
    expl = explain_frame(st, frame, body.top_features) if body.include_explanation else None
    return S.AnalyzeResponse(
        transaction_ref=ref, score=score, risk_band=band, recommended_action=action,
        model_version=st.model_version, policy_version=policy.version,
        review_threshold=policy.review_threshold, hold_threshold=policy.hold_threshold,
        explanation=expl, source=source, source_time_seconds=float(frame["Time"].iloc[0]),
        processed_at=datetime.now(timezone.utc),
    )


@router.get("/transactions/{transaction_id}", response_model=S.TransactionDetail, responses=ERR, tags=["transactions"], summary="Transaction detail")
def get_transaction(
    transaction_id: str = REF_PATH,
    reveal_outcome: bool = Query(False, description="Include the verified label for validation/test rows."),
    st: AppState = Depends(require_ready),
):
    pos = _pos(st, transaction_id)
    case = st.db.status_for([transaction_id]).get(transaction_id)
    d = _summary(st, pos, reveal_outcome, case)
    vec = to_similarity_space(st.pipeline.named_steps["preprocess"].transform(st.row_frame(pos)))[0]
    return S.TransactionDetail(
        **d,
        features={c: float(st.df[c].iat[pos]) for c in V_COLUMNS},
        model_version=st.model_version, policy_version=st.policy.version,
        cluster_id=st.similarity.cluster_of(vec),
    )


@router.get("/transactions/{transaction_id}/explanation", response_model=S.ExplanationResponse, responses=ERR, tags=["transactions"], summary="Local feature contributions")
def get_explanation(
    transaction_id: str = REF_PATH,
    top_features: int = Query(10, ge=1, le=30),
    st: AppState = Depends(require_ready),
):
    pos = _pos(st, transaction_id)
    e = explain_frame(st, st.row_frame(pos), top_features)
    return S.ExplanationResponse(transaction_ref=transaction_id, model_version=st.model_version, **e)


@router.get("/transactions/{transaction_id}/similar", response_model=S.SimilarResponse, responses=ERR, tags=["transactions"], summary="Similar historical training transactions")
def get_similar(
    transaction_id: str = REF_PATH,
    k: int = Query(5, ge=1, le=25),
    st: AppState = Depends(require_ready),
):
    pos = _pos(st, transaction_id)
    vec = to_similarity_space(st.pipeline.named_steps["preprocess"].transform(st.row_frame(pos)))[0]
    npos, dist = st.similarity.query(vec, k, exclude_position=pos)
    train_vecs = to_similarity_space(st.pipeline.named_steps["preprocess"].transform(st.df.iloc[npos]))
    neighbors = [
        S.SimilarCase(
            transaction_ref=make_ref(int(p)), distance=float(d), amount=float(st.df["Amount"].iat[int(p)]),
            source_time_seconds=float(st.df["Time"].iat[int(p)]),
            known_outcome=st.outcome(int(p), False), cluster_id=st.similarity.cluster_of(v),
        )
        for p, d, v in zip(npos, dist, train_vecs)
    ]
    return S.SimilarResponse(
        transaction_ref=transaction_id, reference_set="training split (verified labels)",
        space="standardized V1-V28 plus log-scaled Amount; Time and the target label are excluded",
        k=len(neighbors), neighbors=neighbors,
        known_fraud_among_neighbors=sum(n.known_outcome == S.Outcome.fraud for n in neighbors),
        note="Similar records only; this does not imply related actors. Neighbor outcomes are verified historical labels, not predictions.",
    )


def _case_response(st: AppState, ref: str, pos: int) -> S.CaseResponse:
    band, action = st.bands[pos], st.actions[pos]
    cur = S.CurrentContext(score=float(st.scores[pos]), risk_band=band, recommended_action=action,
                           model_version=st.model_version, policy_version=st.policy.version)
    rec = st.db.get_case(ref)
    if rec is None:
        return S.CaseResponse(
            transaction_ref=ref, persisted=False, review_status="unreviewed", analyst_assessment=None,
            assessed_at=None, closed_at=None, created_at=None, updated_at=None,
            model_version_at_last_update=None, policy_version_at_last_update=None,
            score_at_last_update=None, action_at_last_update=None, notes=[], history=[], current=cur,
        )
    c = rec["case"]
    return S.CaseResponse(
        transaction_ref=ref, persisted=True, review_status=c["review_status"], analyst_assessment=c["analyst_assessment"],
        assessed_at=parse_dt(c["assessed_at"]), closed_at=parse_dt(c["closed_at"]),
        created_at=parse_dt(c["created_at"]), updated_at=parse_dt(c["updated_at"]),
        model_version_at_last_update=c["model_version"], policy_version_at_last_update=c["policy_version"],
        score_at_last_update=c["score_at_update"], action_at_last_update=c["action_at_update"],
        notes=[S.CaseNote(**{**n, "created_at": parse_dt(n["created_at"])}) for n in rec["notes"]],
        history=[
            S.CaseHistoryItem(field=h["field"], old_value=h["old_value"], new_value=h["new_value"],
                              changed_at=parse_dt(h["changed_at"]), model_version=h["model_version"],
                              policy_version=h["policy_version"])
            for h in rec["history"]
        ],
        current=cur,
    )


@router.get("/transactions/{transaction_id}/case", response_model=S.CaseResponse, responses=ERR, tags=["cases"], summary="Analyst case for a transaction")
def get_case(transaction_id: str = REF_PATH, st: AppState = Depends(require_ready)):
    return _case_response(st, transaction_id, _pos(st, transaction_id))


@router.patch("/transactions/{transaction_id}/case", response_model=S.CaseResponse, responses={**ERR, 409: {"model": S.ErrorResponse}}, tags=["cases"], summary="Update review status / assessment / add a note")
def patch_case(
    body: S.CasePatch,
    transaction_id: str = REF_PATH,
    st: AppState = Depends(require_ready),
    user: dict | None = Depends(current_user),
):
    """Analyst input is stored separately from dataset labels and is never used for retraining."""
    pos = _pos(st, transaction_id)
    existing = st.db.get_case(transaction_id)
    cur_status = existing["case"]["review_status"] if existing else "unreviewed"
    cur_assess = existing["case"]["analyst_assessment"] if existing else None
    fields = body.model_fields_set
    new_status = body.review_status.value if "review_status" in fields else cur_status
    new_assess = (body.analyst_assessment.value if body.analyst_assessment else None) if "analyst_assessment" in fields else cur_assess
    if new_status == "closed" and new_assess is None:
        raise ApiError(422, "ASSESSMENT_REQUIRED_TO_CLOSE", "A case can only be closed with an analyst_assessment.")
    st.db.update_case(
        transaction_id,
        model_version=st.model_version, policy_version=st.policy.version,
        score=float(st.scores[pos]), action=str(st.actions[pos]),
        review_status=body.review_status.value if "review_status" in fields else None,
        set_assessment="analyst_assessment" in fields,
        analyst_assessment=new_assess if "analyst_assessment" in fields else None,
        note=body.note, author=body.author or (user["email"] if user else None),
    )
    return _case_response(st, transaction_id, pos)
