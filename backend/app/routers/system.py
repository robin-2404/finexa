"""Health, dataset, metrics, evaluation, and pattern endpoints."""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
from fastapi import APIRouter, Depends, Query

from .. import schemas as S
from ..constants import API_VERSION, FEATURE_COLUMNS, TARGET, time_label
from ..errors import ApiError
from ..ml import patterns as pt
from ..services.state import AppState
from .common import get_state, require_ready

router = APIRouter()
ERR = {503: {"model": S.ErrorResponse}}


@router.get("/health", response_model=S.HealthResponse, tags=["system"], summary="Liveness and readiness")
def health(st: AppState = Depends(get_state)):
    """Always 200. `ready=false` (with `reasons`) means data endpoints will answer 503 MODEL_NOT_READY."""
    return S.HealthResponse(
        status="ok" if st.ready else "degraded",
        ready=st.ready,
        api_version=API_VERSION,
        model_loaded=st.pipeline is not None,
        data_loaded=st.df is not None,
        database_ok=bool(st.db and st.db.ping()),
        model_version=st.model_version,
        policy_version=st.policy.version if st.policy else None,
        reasons=st.reasons,
        checked_at=datetime.now(timezone.utc),
    )


@router.get("/dataset", response_model=S.DatasetResponse, responses=ERR, tags=["system"], summary="Dataset facts and data-quality report")
def dataset(st: AppState = Depends(require_ready)):
    q, m = st.quality, st.meta
    return S.DatasetResponse(
        source_file=m["dataset"]["file_name"],
        fingerprint_sha256=m["dataset"]["fingerprint_sha256"],
        rows=m["dataset"]["rows"],
        features=FEATURE_COLUMNS,
        target=TARGET,
        class_counts=q["class_balance"],
        splits=m["splits"],
        time=q["time"],
        amount=q["amount"],
        declared_vs_actual=q["declared_vs_actual"],
        data_quality=q,
    )


@router.get("/metrics", response_model=S.MetricsResponse, responses=ERR, tags=["system"], summary="Metrics, each block labelled with its scope")
def metrics(st: AppState = Depends(require_ready)):
    m, q = st.meta, st.quality
    test = m["evaluation"]["test"]
    snap = st.sim.snapshot()
    return S.MetricsResponse(
        historical_dataset={
            "scope": "historical_dataset",
            "rows": m["dataset"]["rows"],
            "class_counts": q["class_balance"],
            "split_counts": m["splits"]["counts"],
            "note": "Descriptive counts over the whole supplied file.",
        },
        replay={
            "scope": "replay",
            "label": "Historical simulation; no labels shown here.",
            "replay_split": st.settings.sim_split,
            "status": snap["status"],
            "run_id": snap["run_id"],
            "processed": snap["processed"],
            "total": snap["total"],
            **st.sim.action_counts(),
        },
        evaluation={
            "scope": "evaluation",
            "split": "test",
            "average_precision": test["average_precision"],
            "roc_auc": test["roc_auc"],
            "evaluation_prevalence": test["evaluation_prevalence"],
            "operating_points": test["operating_points"],
            "always_legitimate_baseline": test["always_legitimate_baseline"],
            "see": "/api/v1/model/evaluation",
        },
    )


@router.get("/model/evaluation", response_model=S.ModelEvaluationResponse, responses=ERR, tags=["model"], summary="Held-out evaluation (retrospective)")
def model_evaluation(st: AppState = Depends(require_ready)):
    m = st.meta
    ev = m["evaluation"]
    return S.ModelEvaluationResponse(
        model_version=m["model_version"],
        trained_at=m["trained_at"],
        selected_model=m["selected_model"],
        candidates=m["candidates"],
        selection_rule=m["selection_rule"],
        thresholds=m["thresholds"],
        average_precision_definition=ev["average_precision_definition"],
        score_note=ev["score_note"],
        validation=ev["validation"],
        test=ev["test"],
        caveat=ev["caveat"],
        feature_schema=m["feature_schema"],
        splits=m["splits"],
        explanation_method={k: v for k, v in m["explanation"].items() if k != "reference_median_scaled"},
        library_versions=m["library_versions"],
    )


@router.get("/patterns", response_model=S.PatternsResponse, responses={**ERR, 422: {"model": S.ErrorResponse}}, tags=["patterns"], summary="Pattern Lab")
def patterns(
    feature: str | None = Query(default=None, description="Optional feature name to return a histogram for (Time, V1..V28, Amount)."),
    st: AppState = Depends(require_ready),
):
    if feature is not None and feature not in FEATURE_COLUMNS:
        raise ApiError(422, "INVALID_FEATURE", f"Unknown feature '{feature}'.")
    if "train_df" not in st.cache:
        pos = np.flatnonzero(st.splits == "train")
        train_df = st.df.iloc[pos].copy()
        train_df[TARGET] = st.labels[pos]
        st.cache["train_df"] = train_df
        st.cache["amount_dist"] = pt.amount_distribution(train_df)
        st.cache["feature_summary"] = pt.feature_summary(train_df)
    train_df = st.cache["train_df"]
    clusters = {**st.patterns["clusters"], "items": [{k: v for k, v in c.items() if k != "centroid"} for c in st.patterns["clusters"]["items"]]}
    return S.PatternsResponse(
        note="Computed from the labelled training reference split only. Clusters are groups of similar records, not networks of actors.",
        amount_distribution=st.cache["amount_dist"],
        feature_summary=st.cache["feature_summary"],
        feature_distribution=pt.feature_distribution(train_df, feature) if feature else None,
        global_importance=st.patterns["global_importance"],
        clusters=clusters,
    )


@router.get("/overview/activity", response_model=S.ActivityResponse, responses={**ERR, 422: {"model": S.ErrorResponse}}, tags=["system"], summary="Transaction counts over dataset time (server-side aggregate)")
def overview_activity(
    split: S.Split | None = None,
    risk_band: S.RiskBand | None = None,
    action: S.Action | None = None,
    bucket_seconds: int = Query(7200, ge=600, le=86400, description="Bucket width in dataset-relative seconds."),
    reveal_outcome: bool = Query(False, description="Include known-fraud counts for validation/test rows (retrospective)."),
    st: AppState = Depends(require_ready),
):
    """Aggregates over the whole dataset without sending rows to the client. `known_fraud` is null when labels
    are not revealed (validation/test labels stay hidden unless `reveal_outcome=true`; train labels are shown)."""
    times = st.df["Time"].to_numpy()
    mask = np.ones(len(times), dtype=bool)
    if split:
        mask &= st.splits == split.value
    if risk_band:
        mask &= st.bands == risk_band.value
    if action:
        mask &= st.actions == action.value
    show_labels = reveal_outcome or split == S.Split.train
    nb = int(times.max() // bucket_seconds) + 1
    idx = (times[mask] // bucket_seconds).astype(int)
    bands, acts, labels = st.bands[mask], st.actions[mask], st.labels[mask]

    def count(sel=None):
        return np.bincount(idx if sel is None else idx[sel], minlength=nb)

    total, lo, me, hi = count(), count(bands == "low"), count(bands == "medium"), count(bands == "high")
    flagged = count(acts != "allow")
    fraud = count(labels == 1) if show_labels else None
    buckets = [
        S.ActivityBucket(
            start_seconds=float(b * bucket_seconds), end_seconds=float((b + 1) * bucket_seconds),
            label=time_label(b * bucket_seconds), transactions=int(total[b]),
            by_risk_band=S.RiskCounts(low=int(lo[b]), medium=int(me[b]), high=int(hi[b])),
            model_flagged=int(flagged[b]), known_fraud=int(fraud[b]) if fraud is not None else None,
        )
        for b in range(nb)
    ]
    return S.ActivityResponse(
        split=split, bucket_seconds=bucket_seconds, labels_revealed=show_labels, buckets=buckets,
        totals=S.ActivityTotals(
            transactions=int(mask.sum()),
            by_risk_band=S.RiskCounts(low=int((bands == "low").sum()), medium=int((bands == "medium").sum()), high=int((bands == "high").sum())),
            by_action={a: int((acts == a).sum()) for a in ("allow", "review", "hold")},
            model_flagged=int((acts != "allow").sum()),
            known_fraud=int((labels == 1).sum()) if show_labels else None,
        ),
        model_version=st.model_version, policy_version=st.policy.version,
        note="Counts use the active policy thresholds. 'Model flagged' means recommended for review or hold; it is not a fraud label.",
    )
