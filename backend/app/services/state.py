"""Application state, built once at startup from saved artifacts. Never trains anything."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from ..config import Settings
from ..constants import EXPECTED_COLUMNS, FEATURE_COLUMNS, TARGET, make_ref, parse_ref
from ..ml.data import file_sha256
from ..ml.explain import Explainer
from ..ml.similarity import SimilarityIndex, to_similarity_space
from .auth import LoginThrottle
from .db import Database
from .policy import Policy, PolicyError
from .scoring import Scorer
from .simulation import SimulationEngine

log = logging.getLogger("finexa")


@dataclass
class AppState:
    settings: Settings
    db: Database | None = None
    ready: bool = False
    reasons: list[str] = field(default_factory=list)
    meta: dict | None = None
    patterns: dict | None = None
    quality: dict | None = None
    pipeline: object | None = None
    scorer: Scorer | None = None
    explainer: Explainer | None = None
    policy: Policy | None = None
    similarity: SimilarityIndex | None = None
    # dataset columns as numpy for fast filtering (features stay in `df`)
    df: pd.DataFrame | None = None
    labels: np.ndarray | None = None
    splits: np.ndarray | None = None
    scores: np.ndarray | None = None
    actions: np.ndarray | None = None
    bands: np.ndarray | None = None
    sim: SimulationEngine | None = None
    cache: dict = field(default_factory=dict)
    throttle: LoginThrottle = field(default_factory=LoginThrottle)

    @property
    def model_version(self) -> str | None:
        return self.meta["model_version"] if self.meta else None

    def position_of(self, ref: str) -> int | None:
        pos = parse_ref(ref)
        if pos is None or self.df is None or pos >= len(self.df) or make_ref(pos) != ref:
            return None
        return pos

    def row_frame(self, pos: int) -> pd.DataFrame:
        return self.df.iloc[[pos]][FEATURE_COLUMNS]

    # Labels for hold-out rows are only exposed when the caller explicitly asks (retrospective views).
    def outcome(self, pos: int, reveal_holdout: bool) -> str | None:
        if self.splits[pos] != "train" and not reveal_holdout:
            return None
        return "fraud" if self.labels[pos] == 1 else "legitimate"


def load_state(settings: Settings) -> AppState:
    st = AppState(settings=settings)
    try:
        st.db = Database(settings.database_path)
    except Exception as exc:  # pragma: no cover - environment specific
        st.reasons.append(f"database unavailable: {type(exc).__name__}")

    art = Path(settings.artifacts_dir)
    needed = ["model.joblib", "metadata.json", "splits.csv", "patterns.json", "data_quality_report.json"]
    missing = [f for f in needed if not (art / f).exists()]
    if missing:
        st.reasons.append(f"model artifacts missing in {art}: {', '.join(missing)}. Run the training command.")
    if not Path(settings.data_path).exists():
        st.reasons.append(f"dataset not found at {settings.data_path}")
    if st.reasons:
        return st

    try:
        meta = json.loads((art / "metadata.json").read_text(encoding="utf-8"))
        patterns = json.loads((art / "patterns.json").read_text(encoding="utf-8"))
        quality = json.loads((art / "data_quality_report.json").read_text(encoding="utf-8"))
        if file_sha256(Path(settings.data_path)) != meta["dataset"]["fingerprint_sha256"]:
            st.reasons.append("dataset fingerprint differs from the one used in training; retrain or restore the original file")
            return st
        pipeline = joblib.load(art / "model.joblib")
        raw = pd.read_csv(settings.data_path)
        if list(raw.columns) != EXPECTED_COLUMNS or len(raw) != meta["dataset"]["rows"]:
            st.reasons.append("dataset schema/row count differs from training metadata")
            return st
        split_df = pd.read_csv(art / "splits.csv")
        if len(split_df) != len(raw) or not (split_df["row_position"].to_numpy() == np.arange(len(raw))).all():
            st.reasons.append("splits.csv does not align with the dataset rows")
            return st

        review = settings.review_threshold if settings.review_threshold is not None else meta["thresholds"]["review"]
        hold = settings.hold_threshold if settings.hold_threshold is not None else meta["thresholds"]["hold"]
        try:
            st.policy = Policy(review, hold)
        except PolicyError as exc:
            st.reasons.append(f"invalid policy thresholds: {exc}")
            return st

        st.meta, st.patterns, st.quality, st.pipeline = meta, patterns, quality, pipeline
        st.scorer = Scorer(pipeline)
        st.df = raw[FEATURE_COLUMNS].astype("float64")
        st.labels = raw[TARGET].to_numpy().astype(np.int8)
        st.splits = split_df["split"].to_numpy(dtype=object)

        # Score every row once through the same saved pipeline (used for browsing and policy rehearsal).
        st.scores = st.scorer.score(st.df)
        st.actions, st.bands = st.policy.actions(st.scores), st.policy.bands(st.scores)

        pre = pipeline.named_steps["preprocess"]
        train_pos = np.flatnonzero(st.splits == "train")
        train_space = to_similarity_space(pre.transform(st.df.iloc[train_pos]))
        cents = np.array([c["centroid"] for c in patterns["clusters"]["items"]])
        st.similarity = SimilarityIndex(train_pos, train_space, cents)
        st.explainer = Explainer(pipeline, np.array(meta["explanation"]["reference_median_scaled"]))

        hold_split = {"test": ["test"], "validation": ["validation"], "holdout": ["validation", "test"]}[settings.sim_split]
        pos = np.flatnonzero(np.isin(st.splits, hold_split))
        pos = pos[np.argsort(st.df["Time"].to_numpy()[pos], kind="stable")]
        st.sim = SimulationEngine(
            features=st.df.iloc[pos][FEATURE_COLUMNS],
            positions=pos,
            labels=st.labels[pos],
            scorer=st.scorer,
            policy_provider=lambda: st.policy,
            model_version=meta["model_version"],
            base_rate=settings.sim_base_events_per_second,
        )
        st.ready = st.db is not None
        if not st.ready:
            st.reasons.append("database unavailable")
    except Exception as exc:
        log.exception("Failed to load artifacts")
        st.ready = False
        st.reasons.append(f"failed to load artifacts: {type(exc).__name__}: {exc}")
    return st
