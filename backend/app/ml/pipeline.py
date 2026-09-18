"""Preprocessing + candidate models.

The single sklearn Pipeline built here (preprocess -> model) is what is fitted in
training, saved with joblib, and loaded by the API, so training and inference
share exactly one preprocessing implementation.
"""
from __future__ import annotations

import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

from ..constants import FEATURE_COLUMNS, V_COLUMNS

TRANSFORMATIONS = [
    "Time: standardized (dataset-relative seconds).",
    "V1-V28: standardized.",
    "Amount: log1p transform, then standardized.",
]


def build_preprocessor() -> ColumnTransformer:
    """Learned scaling; fitted on the training split only. Output order == FEATURE_COLUMNS."""
    amount = Pipeline(
        [
            ("log1p", FunctionTransformer(np.log1p, feature_names_out="one-to-one")),
            ("scale", StandardScaler()),
        ]
    )
    return ColumnTransformer(
        [
            ("time", StandardScaler(), ["Time"]),
            ("v", StandardScaler(), V_COLUMNS),
            ("amount", amount, ["Amount"]),
        ],
        remainder="drop",
        verbose_feature_names_out=False,
    )


def build_logistic(C: float, seed: int) -> Pipeline:
    return Pipeline(
        [
            ("preprocess", build_preprocessor()),
            ("model", LogisticRegression(C=C, class_weight="balanced", max_iter=5000, random_state=seed)),
        ]
    )


HGB_PARAMS = dict(
    learning_rate=0.05,
    max_iter=400,
    max_leaf_nodes=31,
    min_samples_leaf=40,
    l2_regularization=1.0,
    early_stopping=True,
    validation_fraction=0.1,  # carved out of the TRAINING split only
    n_iter_no_change=25,
)


def build_hgb(seed: int) -> Pipeline:
    return Pipeline(
        [
            ("preprocess", build_preprocessor()),
            ("model", HistGradientBoostingClassifier(class_weight="balanced", random_state=seed, **HGB_PARAMS)),
        ]
    )


def feature_names(pipe: Pipeline) -> list[str]:
    names = list(pipe.named_steps["preprocess"].get_feature_names_out())
    assert names == FEATURE_COLUMNS, names
    return names
