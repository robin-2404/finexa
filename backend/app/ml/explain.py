"""Local (per-transaction) feature contributions compatible with the selected model.

* Logistic regression -> exact linear decomposition of the log-odds relative to the
  training-mean reference: contribution_i = coef_i * standardized_value_i, and
  baseline_logit + sum(contributions) == model log-odds (additive).
* Histogram gradient boosting -> single-feature substitution: for each feature, the drop
  in log-odds when that feature alone is replaced by its training-median value. This is an
  approximation and is NOT additive (interactions are not apportioned).

Feature names are the dataset's anonymous names; no business meaning is attached.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

from ..constants import FEATURE_COLUMNS

LINEAR = "linear_logodds_decomposition"
SUBSTITUTION = "single_feature_substitution"

DESCRIPTIONS = {
    LINEAR: (
        "Exact decomposition of the model log-odds into per-feature terms (coefficient x standardized "
        "value), relative to the training-mean reference. Terms plus baseline_logit sum to the model log-odds."
    ),
    SUBSTITUTION: (
        "For each feature, the change in model log-odds when that feature alone is replaced with its "
        "training-median value. Approximate and not additive: interactions between features are not apportioned."
    ),
}


class Explainer:
    def __init__(self, pipeline: Pipeline, reference_median_scaled: np.ndarray):
        self.pre = pipeline.named_steps["preprocess"]
        self.clf = pipeline.named_steps["model"]
        self.ref = np.asarray(reference_median_scaled, dtype=float)
        if isinstance(self.clf, LogisticRegression):
            self.method = LINEAR
        elif isinstance(self.clf, HistGradientBoostingClassifier):
            self.method = SUBSTITUTION
        else:
            self.method = None

    @property
    def supported(self) -> bool:
        return self.method is not None

    def explain(self, raw_row: pd.DataFrame, top_n: int = 10) -> dict:
        """`raw_row` is a 1-row frame with exactly FEATURE_COLUMNS."""
        if not self.supported:
            return unavailable("model type has no supported local explanation method")
        x = self.pre.transform(raw_row[FEATURE_COLUMNS])[0]
        if self.method == LINEAR:
            coef = self.clf.coef_[0]
            contrib = coef * x
            baseline = float(self.clf.intercept_[0])
            logit = float(baseline + contrib.sum())
            additive = True
        else:
            mat = np.tile(x, (len(x) + 1, 1))
            for i in range(len(x)):
                mat[i + 1, i] = self.ref[i]
            d = self.clf.decision_function(mat)
            logit = float(d[0])
            contrib = d[0] - d[1:]
            baseline = None
            additive = False
        order = np.argsort(-np.abs(contrib), kind="stable")[:top_n]
        raw_vals = raw_row[FEATURE_COLUMNS].iloc[0]
        items = [
            {
                "feature": FEATURE_COLUMNS[i],
                "value": float(raw_vals.iloc[i]),
                "contribution": float(contrib[i]),
                "direction": "increases_score" if contrib[i] > 0 else ("decreases_score" if contrib[i] < 0 else "neutral"),
            }
            for i in order
        ]
        return {
            "status": "available",
            "method": self.method,
            "method_description": DESCRIPTIONS[self.method],
            "contribution_scale": "log_odds",
            "additive": additive,
            "baseline_logit": baseline,
            "logit": logit,
            "contributions": items,
            "unavailable_reason": None,
        }


def unavailable(reason: str) -> dict:
    return {
        "status": "unavailable",
        "method": None,
        "method_description": None,
        "contribution_scale": None,
        "additive": None,
        "baseline_logit": None,
        "logit": None,
        "contributions": [],
        "unavailable_reason": reason,
    }
