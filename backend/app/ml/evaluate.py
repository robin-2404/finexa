"""Metrics and threshold selection. Scores are uncalibrated model scores, not probabilities."""
from __future__ import annotations

import numpy as np
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score

AP_DEFINITION = (
    "Average precision (AP) summarises the precision-recall curve as the step-wise sum "
    "over thresholds of (recall_n - recall_{n-1}) * precision_n, without interpolation "
    "(scikit-learn average_precision_score). A no-skill scorer has AP equal to the fraud prevalence."
)
SCORE_NOTE = (
    "Model scores are ranking scores in [0, 1] from a class-weighted model. Calibration was not "
    "evaluated, so they must not be read as probabilities or percentage chances of fraud."
)


def _safe_div(a: float, b: float):
    return float(a / b) if b else None


def confusion_at(y: np.ndarray, score: np.ndarray, threshold: float) -> dict:
    """Flag when score >= threshold."""
    pred = score >= threshold
    pos = y == 1
    tp = int((pred & pos).sum())
    fp = int((pred & ~pos).sum())
    fn = int((~pred & pos).sum())
    tn = int((~pred & ~pos).sum())
    precision = _safe_div(tp, tp + fp)
    recall = _safe_div(tp, tp + fn)
    f1 = _safe_div(2 * tp, 2 * tp + fp + fn)
    return {
        "threshold": float(threshold),
        "confusion_matrix": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
        "flagged": tp + fp,
        "precision": precision,
        "recall": recall,
        "f1": f1,
    }


def always_legitimate_baseline(y: np.ndarray) -> dict:
    """A scorer that calls everything legitimate (constant score 0, nothing flagged)."""
    n, p = len(y), int(y.sum())
    return {
        "description": "Predicts every transaction as legitimate.",
        "confusion_matrix": {"tn": n - p, "fp": 0, "fn": p, "tp": 0},
        "precision": None,
        "recall": 0.0,
        "f1": 0.0,
        "average_precision": float(average_precision_score(y, np.zeros(n))),
        "roc_auc": 0.5,
        "accuracy_context_only": (n - p) / n,
    }


def evaluate_split(y: np.ndarray, score: np.ndarray, thresholds: dict[str, float], name: str) -> dict:
    n, p = len(y), int(y.sum())
    ops = {k: confusion_at(y, score, t) for k, t in thresholds.items()}
    return {
        "split": name,
        "rows": n,
        "fraud": p,
        "legitimate": n - p,
        "evaluation_prevalence": p / n,
        "average_precision": float(average_precision_score(y, score)),
        "roc_auc": float(roc_auc_score(y, score)),
        "operating_points": ops,
        "always_legitimate_baseline": always_legitimate_baseline(y),
    }


def select_thresholds(y: np.ndarray, score: np.ndarray, review_precision_floor: float = 0.20) -> dict:
    """Choose decision thresholds on VALIDATION data only.

    hold   : threshold maximising F1 (precision/recall balance).
    review : scanning downward from the hold threshold, the lowest threshold at which validation
             precision is still >= review_precision_floor (i.e. widen the analyst net while roughly
             1 in 5 reviewed cases is still fraud). Keeps review workload bounded.
    Guarantees 0 <= review < hold <= 1.
    """
    prec, rec, thr = precision_recall_curve(y, score)
    p, r = prec[:-1], rec[:-1]
    f1 = np.divide(2 * p * r, p + r, out=np.zeros_like(p), where=(p + r) > 0)
    ih = int(np.argmax(f1))
    hold = float(thr[ih])
    below = np.flatnonzero(p[:ih] < review_precision_floor)
    review = float(thr[below[-1] + 1]) if len(below) else float(thr[0])
    fallback = None
    if not review < hold:
        review = hold / 2
        fallback = "precision fell below the floor immediately below the hold threshold; review set to hold/2"
    if not (0 <= review < hold <= 1):
        raise ValueError(f"Could not derive valid thresholds (review={review}, hold={hold})")
    return {
        "review": review,
        "hold": hold,
        "selection_rule": {
            "hold": "threshold maximising F1 on the validation split",
            "review": (
                f"lowest threshold (scanning down from hold) keeping validation precision >= {review_precision_floor:.2f}"
            ),
            "fallback_applied": fallback,
            "selected_on_split": "validation",
        },
    }
