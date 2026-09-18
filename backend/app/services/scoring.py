"""Model scoring. Validate input -> saved preprocessing -> model score.

Decision policy and explanations are separate steps (see policy.py / ml/explain.py).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..constants import FEATURE_COLUMNS, TARGET


class InputValidationError(ValueError):
    pass


class Scorer:
    def __init__(self, pipeline):
        self.pipeline = pipeline

    @staticmethod
    def validate_frame(frame: pd.DataFrame) -> pd.DataFrame:
        """Strict check: exactly the 30 feature columns, numeric, finite, Time/Amount >= 0.

        The target (or any other extra column) is rejected rather than silently ignored, so a
        label can never reach the model by accident.
        """
        cols = list(frame.columns)
        if TARGET in cols:
            raise InputValidationError(f"'{TARGET}' is the target label and must not be part of a scoring input")
        extra = [c for c in cols if c not in FEATURE_COLUMNS]
        missing = [c for c in FEATURE_COLUMNS if c not in cols]
        if extra or missing:
            raise InputValidationError(f"Input columns must be exactly the model features; extra={extra}, missing={missing}")
        out = frame[FEATURE_COLUMNS].apply(pd.to_numeric, errors="coerce").astype("float64")
        arr = out.to_numpy()
        if not np.isfinite(arr).all():
            raise InputValidationError("Input contains missing, non-numeric, or non-finite values")
        if (out["Time"] < 0).any() or (out["Amount"] < 0).any():
            raise InputValidationError("Time and Amount must be non-negative")
        return out

    def score(self, frame: pd.DataFrame) -> np.ndarray:
        clean = self.validate_frame(frame)
        s = self.pipeline.predict_proba(clean)[:, 1]
        return np.clip(s, 0.0, 1.0)
