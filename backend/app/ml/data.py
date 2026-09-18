"""Dataset loading, validation, data-quality reporting, and leakage-safe splitting.

Nothing here silently drops or edits records: problems are counted and reported,
and hard problems abort training with the report attached.
"""
from __future__ import annotations

import hashlib
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

from ..constants import EXPECTED_COLUMNS, FEATURE_COLUMNS, SPLITS, TARGET

# Counts stated in the project brief for the original creditcard.csv. They are
# compared with the actual file and any difference is reported, never "fixed".
DECLARED_EXPECTATION = {"rows": 284_807, "legitimate": 284_315, "fraud": 492}


class DataValidationError(Exception):
    def __init__(self, message: str, report: dict):
        super().__init__(message)
        self.report = report


def file_sha256(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while block := fh.read(chunk):
            h.update(block)
    return h.hexdigest()


def extract_zip_entry(zip_path: Path, entry: str, target: Path) -> Path:
    """Copy exactly one named entry out of a ZIP into `target`.

    The archive is opened read-only and never extracted wholesale, so entry names
    cannot write outside `target`.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        if entry not in zf.namelist():
            raise FileNotFoundError(f"Entry '{entry}' not found in {zip_path}")
        with zf.open(entry) as src, open(target, "wb") as dst:
            while block := src.read(1 << 20):
                dst.write(block)
    return target


def _duplicate_report(df: pd.DataFrame) -> tuple[np.ndarray, dict]:
    """Group identical feature records; report exact duplicates and label conflicts."""
    n = len(df)
    dup_mask = df.duplicated(FEATURE_COLUMNS, keep=False).to_numpy()
    groups = np.arange(n, dtype=np.int64)  # unique group per row by default
    conflicting_groups = 0
    conflicting_rows = 0
    dup_groups = 0
    if dup_mask.any():
        sub = df.loc[dup_mask, FEATURE_COLUMNS + [TARGET]]
        gid = sub.groupby(FEATURE_COLUMNS, sort=False).ngroup().to_numpy()
        groups[np.flatnonzero(dup_mask)] = n + gid  # offset so ids never collide with singletons
        dup_groups = int(gid.max()) + 1
        nunique = pd.Series(sub[TARGET].to_numpy()).groupby(gid).nunique()
        conflict_ids = nunique[nunique > 1].index.to_numpy()
        conflicting_groups = len(conflict_ids)
        conflicting_rows = int(np.isin(gid, conflict_ids).sum())
    rep = {
        "rows_in_duplicate_groups": int(dup_mask.sum()),
        "duplicate_groups": dup_groups,
        "extra_duplicate_rows": int(df.duplicated(FEATURE_COLUMNS).sum()),
        "conflicting_label_groups": conflicting_groups,
        "conflicting_label_rows": conflicting_rows,
        "handling": (
            "Duplicate records are kept (not removed). All rows of an identical-feature group "
            "are assigned to the same split, so they cannot leak across train/validation/test. "
            "For stratification a group is treated as fraud if any member is fraud."
        ),
    }
    return groups, rep


def load_and_validate(csv_path: Path) -> tuple[pd.DataFrame, np.ndarray, dict]:
    """Return (frame with EXPECTED_COLUMNS, duplicate-group ids, quality report).

    Raises DataValidationError (report attached) for schema, numeric, missing,
    non-finite, or target problems.
    """
    csv_path = Path(csv_path)
    if not csv_path.exists():
        raise FileNotFoundError(f"Dataset not found: {csv_path}")
    raw = pd.read_csv(csv_path)
    errors: list[str] = []
    report: dict = {
        "source_file": csv_path.name,
        "fingerprint_sha256": file_sha256(csv_path),
        "rows": int(len(raw)),
        "columns": list(raw.columns),
        "cleaning_performed": {
            "rows_removed": 0,
            "values_modified": 0,
            "description": "None. The file is used exactly as supplied; problems are reported, not repaired.",
        },
    }

    missing_cols = [c for c in EXPECTED_COLUMNS if c not in raw.columns]
    extra_cols = [c for c in raw.columns if c not in EXPECTED_COLUMNS]
    report["schema"] = {"missing_columns": missing_cols, "unexpected_columns": extra_cols}
    if missing_cols or extra_cols:
        errors.append(f"Schema mismatch: missing={missing_cols}, unexpected={extra_cols}")
    if len(raw) == 0:
        errors.append("Dataset has no rows.")
    if errors:
        report["errors"] = errors
        raise DataValidationError("; ".join(errors), report)

    per_col: dict[str, dict] = {}
    df = pd.DataFrame(index=raw.index)
    for c in EXPECTED_COLUMNS:
        s = raw[c]
        non_numeric = 0
        if pd.api.types.is_numeric_dtype(s):
            conv = s
        else:
            conv = pd.to_numeric(s, errors="coerce")
            non_numeric = int((conv.isna() & s.notna()).sum())
        conv = conv.astype("float64")
        per_col[c] = {
            "missing": int(s.isna().sum()),
            "non_numeric": non_numeric,
            "non_finite": int(np.isinf(conv).sum()),
        }
        df[c] = conv
    report["numeric_checks"] = per_col
    for c, m in per_col.items():
        bad = m["missing"] + m["non_numeric"] + m["non_finite"]
        if bad:
            errors.append(f"Column {c}: {m['missing']} missing, {m['non_numeric']} non-numeric, {m['non_finite']} non-finite")

    if not errors:
        vals = sorted(pd.unique(df[TARGET]).tolist())
        report["target_values"] = vals
        if not set(vals) <= {0.0, 1.0}:
            errors.append(f"Class contains values other than 0/1: {vals}")
        for c in ("Time", "Amount"):
            neg = int((df[c] < 0).sum())
            report.setdefault("negative_values", {})[c] = neg
            if neg:
                errors.append(f"{c} has {neg} negative values")
    if errors:
        report["errors"] = errors
        raise DataValidationError("; ".join(errors), report)

    df[TARGET] = df[TARGET].astype("int8")
    df = df[EXPECTED_COLUMNS].reset_index(drop=True)

    fraud = int(df[TARGET].sum())
    legit = int(len(df) - fraud)
    report["class_balance"] = {
        "legitimate": legit,
        "fraud": fraud,
        "fraud_prevalence": fraud / len(df),
        "imbalance_ratio_legit_per_fraud": (legit / fraud) if fraud else None,
    }
    groups, dup = _duplicate_report(df)
    report["duplicates"] = dup
    report["time"] = {
        "min": float(df["Time"].min()),
        "max": float(df["Time"].max()),
        "sorted_by_time_in_file": bool(df["Time"].is_monotonic_increasing),
        "semantics": "Seconds relative to the dataset start. Not a calendar date or local clock time.",
    }
    report["amount"] = {
        "min": float(df["Amount"].min()),
        "median": float(df["Amount"].median()),
        "mean": float(df["Amount"].mean()),
        "max": float(df["Amount"].max()),
        "zero_amount_rows": int((df["Amount"] == 0).sum()),
    }
    exp = DECLARED_EXPECTATION
    diffs = {
        "rows": len(df) - exp["rows"],
        "legitimate": legit - exp["legitimate"],
        "fraud": fraud - exp["fraud"],
    }
    report["declared_vs_actual"] = {
        "declared": exp,
        "actual": {"rows": len(df), "legitimate": legit, "fraud": fraud},
        "difference": diffs,
        "matches": all(v == 0 for v in diffs.values()),
        "note": (
            "The supplied file does not match the declared counts; this run trains on the file as supplied. "
            "A file with no duplicate rows and fewer records than the declared original is consistent with a "
            "duplicate-removed variant, but that could not be verified against the original archive."
            if any(diffs.values())
            else "Counts match the declared original."
        ),
    }
    report["errors"] = []
    return df, groups, report


def make_splits(
    df: pd.DataFrame,
    groups: np.ndarray,
    seed: int = 42,
    fractions: tuple[float, float, float] = (0.6, 0.2, 0.2),
) -> np.ndarray:
    """Group-aware, approximately stratified train/validation/test assignment.

    Identical-feature records share a group and always land in the same split.
    Stratification is done on the group label (fraud if any member is fraud).
    """
    if abs(sum(fractions) - 1) > 1e-9:
        raise ValueError("Split fractions must sum to 1")
    gdf = pd.DataFrame({"g": groups, "y": df[TARGET].to_numpy()}).groupby("g", sort=True)["y"].max()
    gids, gy = gdf.index.to_numpy(), gdf.to_numpy()
    g_train, g_rest, _, y_rest = train_test_split(
        gids, gy, test_size=fractions[1] + fractions[2], stratify=gy, random_state=seed
    )
    g_val, g_test = train_test_split(
        g_rest, test_size=fractions[2] / (fractions[1] + fractions[2]), stratify=y_rest, random_state=seed
    )
    lookup = {**dict.fromkeys(g_train.tolist(), "train"), **dict.fromkeys(g_val.tolist(), "validation"),
              **dict.fromkeys(g_test.tolist(), "test")}
    return np.array([lookup[g] for g in groups.tolist()], dtype=object)


def check_split_leakage(df: pd.DataFrame, splits: np.ndarray) -> dict:
    """Verify that no identical feature record appears in more than one split."""
    frame = df[FEATURE_COLUMNS].copy()
    frame["_split"] = splits
    n_splits_per_record = frame.groupby(FEATURE_COLUMNS, sort=False)["_split"].nunique()
    crossing = int((n_splits_per_record > 1).sum())
    return {
        "identical_feature_records_crossing_splits": crossing,
        "passed": crossing == 0,
    }


def split_summary(df: pd.DataFrame, splits: np.ndarray, groups: np.ndarray) -> dict:
    out = {}
    for s in SPLITS:
        m = splits == s
        rows = int(m.sum())
        fraud = int(df[TARGET].to_numpy()[m].sum())
        out[s] = {
            "rows": rows,
            "fraud": fraud,
            "legitimate": rows - fraud,
            "fraud_prevalence": fraud / rows if rows else None,
            "distinct_feature_groups": int(len(np.unique(groups[m]))),
        }
    return out
