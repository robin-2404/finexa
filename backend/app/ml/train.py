"""Repeatable training command.

    python -m app.ml.train                      # uses FINEXA_DATA_PATH / FINEXA_ARTIFACTS_DIR
    python -m app.ml.train --csv path/to.csv --artifacts-dir ../artifacts

Nothing is fabricated: if the dataset is missing or invalid, the command fails and writes no model.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import scipy
import sklearn
from sklearn.metrics import average_precision_score, roc_auc_score

from ..config import Settings
from ..constants import FEATURE_COLUMNS, NON_FEATURE_COLUMNS, TARGET, make_ref
from . import evaluate as ev
from . import explain, patterns, pipeline as pl
from .data import (
    DataValidationError,
    check_split_leakage,
    extract_zip_entry,
    load_and_validate,
    make_splits,
    split_summary,
)

ZIP_ENTRY = "fraud detection/creditcard.csv"
LR_GRID = (0.01, 0.1, 1.0)

HISTORICAL_CAVEAT = (
    "These results come from one stratified random split of a historical dataset. They do not establish "
    "how the model will perform on future production traffic, where fraud patterns, prevalence and data "
    "drift may differ. Test data was used once, after model and threshold selection on validation data."
)


def _write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=2, default=_json_default), encoding="utf-8")


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, Path):
        return str(o)
    raise TypeError(f"not serialisable: {type(o)}")


def run_training(
    csv_path: Path,
    artifacts_dir: Path,
    seed: int = 42,
    fractions: tuple[float, float, float] = (0.6, 0.2, 0.2),
    importance_repeats: int = 3,
    kmeans_k: int = 8,
    log=print,
) -> dict:
    csv_path, artifacts_dir = Path(csv_path), Path(artifacts_dir)
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    # 1-2. Validate, audit duplicates, build stable references.
    log(f"[1/8] Validating {csv_path}")
    try:
        df, groups, quality = load_and_validate(csv_path)
    except DataValidationError as exc:
        _write_json(artifacts_dir / "data_quality_report.json", exc.report)
        raise
    n = len(df)
    refs = np.array([make_ref(i) for i in range(n)])  # from source row position; never a model feature
    log(f"      rows={n}, fraud={quality['class_balance']['fraud']}, duplicates={quality['duplicates']['extra_duplicate_rows']}")

    # 3-5. Group-aware stratified splits + leakage proof + fingerprint.
    log("[2/8] Creating group-aware stratified splits")
    splits = make_splits(df, groups, seed=seed, fractions=fractions)
    leakage = check_split_leakage(df, splits)
    if not leakage["passed"]:
        raise RuntimeError(f"Split leakage detected: {leakage}")
    summary = split_summary(df, splits, groups)
    quality["split_leakage_check"] = leakage
    _write_json(artifacts_dir / "data_quality_report.json", quality)
    pd.DataFrame(
        {"transaction_ref": refs, "row_position": np.arange(n), "split": splits, "duplicate_group": groups}
    ).to_csv(artifacts_dir / "splits.csv", index=False)

    X, y = df[FEATURE_COLUMNS], df[TARGET].to_numpy()
    tr, va, te = (np.flatnonzero(splits == s) for s in ("train", "validation", "test"))
    assert not ({TARGET, "transaction_ref", "row_position"} & set(X.columns))
    X_tr, y_tr, X_va, y_va, X_te, y_te = X.iloc[tr], y[tr], X.iloc[va], y[va], X.iloc[te], y[te]

    # 6-7. Fit candidates (preprocessing is fitted inside each pipeline, on training rows only).
    log("[3/8] Fitting candidates on the training split")
    candidates: list[dict] = []
    fitted: dict[str, object] = {}
    best_lr, best_lr_ap = None, -1.0
    for C in LR_GRID:
        p = pl.build_logistic(C, seed).fit(X_tr, y_tr)
        s = p.predict_proba(X_va)[:, 1]
        ap = float(average_precision_score(y_va, s))
        log(f"      logistic_regression C={C}: validation AP={ap:.4f}")
        if ap > best_lr_ap:
            best_lr, best_lr_ap, best_lr_C = p, ap, C
    lr_scores = best_lr.predict_proba(X_va)[:, 1]
    candidates.append(
        {
            "name": "logistic_regression",
            "family": "linear_baseline",
            "params": {"C": best_lr_C, "class_weight": "balanced", "C_grid_searched_on": "validation"},
            "validation": {"average_precision": best_lr_ap, "roc_auc": float(roc_auc_score(y_va, lr_scores))},
        }
    )
    fitted["logistic_regression"] = best_lr
    hgb = pl.build_hgb(seed).fit(X_tr, y_tr)
    hgb_scores = hgb.predict_proba(X_va)[:, 1]
    hgb_ap = float(average_precision_score(y_va, hgb_scores))
    log(f"      hist_gradient_boosting: validation AP={hgb_ap:.4f}")
    candidates.append(
        {
            "name": "hist_gradient_boosting",
            "family": "tree_ensemble",
            "params": {**pl.HGB_PARAMS, "class_weight": "balanced"},
            "validation": {"average_precision": hgb_ap, "roc_auc": float(roc_auc_score(y_va, hgb_scores))},
        }
    )
    fitted["hist_gradient_boosting"] = hgb

    # 8. Select on validation AP (ties go to the simpler linear baseline).
    log("[4/8] Selecting model and thresholds on validation data")
    selected = max(candidates, key=lambda c: (c["validation"]["average_precision"], c["name"] == "logistic_regression"))
    for c in candidates:
        c["selected"] = c is selected
    pipe = fitted[selected["name"]]
    val_scores = pipe.predict_proba(X_va)[:, 1]
    thr = ev.select_thresholds(y_va, val_scores)
    log(f"      selected={selected['name']} review={thr['review']:.6f} hold={thr['hold']:.6f}")

    # 9. Final, single evaluation on the untouched test split.
    log("[5/8] Evaluating on the untouched test split")
    ops = {"hold": thr["hold"], "review": thr["review"]}
    val_eval = ev.evaluate_split(y_va, val_scores, ops, "validation")
    test_eval = ev.evaluate_split(y_te, pipe.predict_proba(X_te)[:, 1], ops, "test")
    for k in ("hold", "review"):
        o = test_eval["operating_points"][k]
        log(f"      test @{k}: precision={o['precision']} recall={o['recall']} f1={o['f1']}")
    log(f"      test AP={test_eval['average_precision']:.4f} ROC-AUC={test_eval['roc_auc']:.4f} prevalence={test_eval['evaluation_prevalence']:.5f}")

    # Pattern Lab material (training reference data; importance on validation).
    log("[6/8] Computing patterns (importance, clusters)")
    pre = pipe.named_steps["preprocess"]
    tr_transformed = pre.transform(X_tr)
    importance = patterns.global_importance(pipe, X_va, y_va, seed, importance_repeats)
    clusters = patterns.compute_clusters(tr_transformed, df.iloc[tr], kmeans_k, seed)
    _write_json(artifacts_dir / "patterns.json", {"global_importance": importance, "clusters": clusters})

    # Persist the complete pipeline + metadata.
    log("[7/8] Saving artifacts")
    fingerprint = quality["fingerprint_sha256"]
    version_hash = hashlib.sha256(
        json.dumps([fingerprint, seed, list(fractions), selected["name"], selected["params"]], sort_keys=True, default=str).encode()
    ).hexdigest()[:8]
    model_version = f"finexa-{'lr' if selected['name'] == 'logistic_regression' else 'hgb'}-{version_hash}"
    method = explain.LINEAR if selected["name"] == "logistic_regression" else explain.SUBSTITUTION
    metadata = {
        "schema_version": 1,
        "model_version": model_version,
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "seed": seed,
        "selected_model": {k: selected[k] for k in ("name", "family", "params")},
        "candidates": candidates,
        "selection_rule": "Highest validation average precision; ties go to the linear baseline.",
        "feature_schema": {
            "features": FEATURE_COLUMNS,
            "target": TARGET,
            "excluded_from_model": NON_FEATURE_COLUMNS,
            "transformations": pl.TRANSFORMATIONS,
            "time_semantics": "Dataset-relative seconds; not a calendar date or clock time.",
        },
        "thresholds": {"review": thr["review"], "hold": thr["hold"], "selection_rule": thr["selection_rule"]},
        "score_semantics": {"range": [0, 1], "calibrated": False, "note": ev.SCORE_NOTE},
        "explanation": {
            "method": method,
            "description": explain.DESCRIPTIONS[method],
            "reference_median_scaled": np.median(tr_transformed, axis=0).tolist(),
        },
        "dataset": {
            "file_name": csv_path.name,
            "fingerprint_sha256": fingerprint,
            "rows": n,
            "class_counts": quality["class_balance"],
            "declared_vs_actual": quality["declared_vs_actual"],
        },
        "splits": {
            "strategy": "group-aware stratified random split (identical feature records share a split)",
            "fractions": {"train": fractions[0], "validation": fractions[1], "test": fractions[2]},
            "seed": seed,
            "counts": summary,
            "leakage_check": leakage,
            "assignments_file": "splits.csv",
        },
        "evaluation": {
            "average_precision_definition": ev.AP_DEFINITION,
            "score_note": ev.SCORE_NOTE,
            "validation": val_eval,
            "test": test_eval,
            "caveat": HISTORICAL_CAVEAT,
        },
        "library_versions": {
            "python": platform.python_version(),
            "scikit-learn": sklearn.__version__,
            "pandas": pd.__version__,
            "numpy": np.__version__,
            "scipy": scipy.__version__,
        },
    }
    joblib.dump(pipe, artifacts_dir / "model.joblib")
    _write_json(artifacts_dir / "metadata.json", metadata)

    # Verify the saved pipeline reloads and reproduces the in-memory scores.
    log("[8/8] Verifying saved pipeline round-trip")
    reloaded = joblib.load(artifacts_dir / "model.joblib")
    diff = float(np.max(np.abs(reloaded.predict_proba(X_va.iloc[:2000])[:, 1] - val_scores[:2000])))
    if diff > 1e-12:
        raise RuntimeError(f"Reloaded pipeline differs from in-memory pipeline by {diff}")
    log(f"Done. model_version={model_version}; artifacts in {artifacts_dir}")
    return metadata


def main(argv: list[str] | None = None) -> int:
    s = Settings()
    ap = argparse.ArgumentParser(description="Train the FINEXA fraud model.")
    ap.add_argument("--csv", type=Path, default=s.data_path, help="Path to creditcard.csv")
    ap.add_argument("--zip", type=Path, default=None, help="Optional ZIP to copy the CSV from if --csv is missing")
    ap.add_argument("--zip-entry", default=ZIP_ENTRY)
    ap.add_argument("--artifacts-dir", type=Path, default=s.artifacts_dir)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args(argv)

    if not args.csv.exists() and args.zip is not None:
        if not args.zip.exists():
            print(f"ERROR: neither {args.csv} nor archive {args.zip} exists; training requires the dataset.", file=sys.stderr)
            return 2
        print(f"Extracting {args.zip_entry} -> {args.csv}")
        extract_zip_entry(args.zip, args.zip_entry, args.csv)
    if not args.csv.exists():
        print(f"ERROR: dataset not found at {args.csv}. Training requires the CSV (set --csv or FINEXA_DATA_PATH).", file=sys.stderr)
        return 2
    try:
        run_training(args.csv, args.artifacts_dir, seed=args.seed)
    except DataValidationError as exc:
        print(f"ERROR: data validation failed: {exc}\nSee {args.artifacts_dir / 'data_quality_report.json'}", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
