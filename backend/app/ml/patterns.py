"""Pattern Lab computations: global importance, similarity clusters, and distributions.

Clusters group *similar records* in the standardized feature space. They are not
criminal networks, rings, or actors. Labels (Class) are used only to report the
fraud prevalence of each group on the labelled training reference data; they are
never part of the clustering input.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.inspection import permutation_importance

from ..constants import FEATURE_COLUMNS, TARGET
from .similarity import SIM_COLUMNS, to_similarity_space

AMOUNT_EDGES = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, float("inf")]
LOW_SAMPLE_FRAUD = 10


def amount_distribution(df: pd.DataFrame) -> list[dict]:
    out = []
    for lo, hi in zip(AMOUNT_EDGES[:-1], AMOUNT_EDGES[1:]):
        m = (df["Amount"] >= lo) & (df["Amount"] < hi)
        if lo == 0:
            m = df["Amount"] < hi
        y = df.loc[m, TARGET]
        n = int(m.sum())
        out.append(
            {
                "label": f"{lo:g}+" if hi == float("inf") else f"{lo:g}-{hi:g}",
                "lower": float(lo),
                "upper": None if hi == float("inf") else float(hi),
                "count": n,
                "fraud_count": int(y.sum()),
                "fraud_prevalence": float(y.mean()) if n else None,
            }
        )
    return out


def feature_distribution(df: pd.DataFrame, feature: str, bins: int = 20) -> dict:
    """Equal-width histogram over the 0.5-99.5 percentile range; tails fold into the edge bins."""
    x = df[feature].to_numpy()
    lo, hi = np.percentile(x, [0.5, 99.5])
    if hi <= lo:
        hi = lo + 1.0
    edges = np.linspace(lo, hi, bins + 1)
    clipped = np.clip(x, lo, hi)
    y = df[TARGET].to_numpy()
    idx = np.clip(np.digitize(clipped, edges[1:-1]), 0, bins - 1)
    out = []
    for b in range(bins):
        m = idx == b
        out.append(
            {
                "lower": float(edges[b]),
                "upper": float(edges[b + 1]),
                "legitimate_count": int((m & (y == 0)).sum()),
                "fraud_count": int((m & (y == 1)).sum()),
            }
        )
    return {
        "feature": feature,
        "bins": out,
        "range_percentiles": [0.5, 99.5],
        "note": "Values outside the range are folded into the first/last bin.",
    }


def feature_summary(df: pd.DataFrame) -> list[dict]:
    fr = df[TARGET] == 1
    rows = []
    for c in FEATURE_COLUMNS:
        rows.append(
            {
                "feature": c,
                "mean": float(df[c].mean()),
                "std": float(df[c].std()),
                "min": float(df[c].min()),
                "max": float(df[c].max()),
                "median_legitimate": float(df.loc[~fr, c].median()),
                "median_fraud": float(df.loc[fr, c].median()) if fr.any() else None,
            }
        )
    return rows


def global_importance(pipeline, val_X: pd.DataFrame, val_y: np.ndarray, seed: int, repeats: int) -> dict:
    from sklearn.linear_model import LogisticRegression

    clf = pipeline.named_steps["model"]
    if isinstance(clf, LogisticRegression):
        items = [
            {"feature": f, "importance": float(abs(c)), "signed_coefficient": float(c), "importance_std": None}
            for f, c in zip(FEATURE_COLUMNS, clf.coef_[0])
        ]
        method = "absolute standardized logistic-regression coefficient"
        scope = "fitted model (training data)"
    else:
        res = permutation_importance(
            pipeline, val_X, val_y, scoring="average_precision", n_repeats=repeats, random_state=seed, n_jobs=1
        )
        items = [
            {"feature": f, "importance": float(m), "signed_coefficient": None, "importance_std": float(s)}
            for f, m, s in zip(FEATURE_COLUMNS, res.importances_mean, res.importances_std)
        ]
        method = f"permutation importance: mean drop in average precision when the feature is shuffled ({repeats} repeats)"
        scope = "validation split"
    items.sort(key=lambda d: -d["importance"])
    return {
        "method": method,
        "computed_on": scope,
        "is_local_explanation": False,
        "note": "Global importance describes the model overall. It is not an explanation of any single transaction.",
        "items": items,
    }


def compute_clusters(train_transformed: np.ndarray, train_df: pd.DataFrame, k: int, seed: int) -> dict:
    space = to_similarity_space(train_transformed)
    km = KMeans(n_clusters=k, n_init=5, random_state=seed).fit(space)
    labels = km.labels_
    y = train_df[TARGET].to_numpy()
    amt = train_df["Amount"].to_numpy()
    items = []
    for cid in range(k):
        m = labels == cid
        size = int(m.sum())
        fraud = int(y[m].sum())
        items.append(
            {
                "cluster_id": cid,
                "size": size,
                "share_of_reference": size / len(labels),
                "fraud_count": fraud,
                "fraud_prevalence": fraud / size if size else None,
                "median_amount": float(np.median(amt[m])) if size else None,
                "mean_amount": float(amt[m].mean()) if size else None,
                "low_sample": bool(fraud < LOW_SAMPLE_FRAUD),
                "centroid": km.cluster_centers_[cid].astype(float).tolist(),
            }
        )
    return {
        "algorithm": "kmeans",
        "k": k,
        "space": "standardized " + ", ".join(SIM_COLUMNS[:1] + ["..."] + SIM_COLUMNS[-1:]) + " (Time excluded; Class never used)",
        "fitted_on": "train",
        "note": (
            "Clusters are groups of similar records only. They do not indicate related people, accounts, or "
            f"coordinated activity. Prevalence is computed on labelled training data; groups with fewer than "
            f"{LOW_SAMPLE_FRAUD} fraud cases (low_sample) have unreliable prevalence."
        ),
        "items": items,
    }
