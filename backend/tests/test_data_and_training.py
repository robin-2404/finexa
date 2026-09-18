import json

import joblib
import numpy as np
import pandas as pd
import pytest

from app.constants import FEATURE_COLUMNS, make_ref
from app.ml import explain as ex
from app.ml import pipeline as pl
from app.ml.data import DataValidationError, check_split_leakage, load_and_validate, make_splits
from app.services.scoring import InputValidationError, Scorer


# ---- validation ---------------------------------------------------------------------------
def _write(df, tmp_path):
    p = tmp_path / "d.csv"
    df.to_csv(p, index=False)
    return p


@pytest.mark.parametrize(
    "mutate,fragment",
    [
        (lambda d: d.drop(columns=["V5"]), "Schema mismatch"),
        (lambda d: d.assign(extra=1), "Schema mismatch"),
        (lambda d: d.assign(V1=d["V1"].where(d.index != 3)), "missing"),
        (lambda d: d.assign(V2=d["V2"].where(d.index != 3, np.inf)), "non-finite"),
        (lambda d: d.assign(Class=d["Class"].where(d.index != 3, 2)), "other than 0/1"),
        (lambda d: d.assign(Amount=d["Amount"].where(d.index != 3, -1.0)), "negative"),
    ],
)
def test_invalid_datasets_abort_with_report(synthetic_df, tmp_path, mutate, fragment):
    with pytest.raises(DataValidationError) as e:
        load_and_validate(_write(mutate(synthetic_df.copy()), tmp_path))
    assert fragment in str(e.value)
    assert e.value.report["errors"]


def test_non_numeric_values_are_reported(synthetic_df, tmp_path):
    d = synthetic_df.astype(object)
    d.loc[3, "V1"] = "abc"
    with pytest.raises(DataValidationError) as e:
        load_and_validate(_write(d, tmp_path))
    assert e.value.report["numeric_checks"]["V1"]["non_numeric"] == 1


def test_quality_report_counts_duplicates_and_conflicts(synthetic_df, tmp_path):
    df, groups, rep = load_and_validate(_write(synthetic_df, tmp_path))
    assert rep["duplicates"]["extra_duplicate_rows"] >= 15
    assert rep["duplicates"]["conflicting_label_groups"] >= 1
    assert rep["cleaning_performed"]["rows_removed"] == 0
    assert len(df) == len(synthetic_df)  # nothing silently dropped
    assert rep["class_balance"]["fraud"] == int(synthetic_df["Class"].sum())


# ---- split leakage --------------------------------------------------------------------------
def test_identical_records_never_cross_splits(synthetic_df, tmp_path):
    df, groups, _ = load_and_validate(_write(synthetic_df, tmp_path))
    splits = make_splits(df, groups, seed=1)
    assert check_split_leakage(df, splits)["passed"]
    dup_rows = df.duplicated(FEATURE_COLUMNS, keep=False)
    assert dup_rows.sum() > 0
    per = pd.DataFrame({"g": groups[dup_rows.to_numpy()], "s": splits[dup_rows.to_numpy()]}).groupby("g")["s"].nunique()
    assert (per == 1).all()


def test_leakage_check_detects_a_deliberate_leak(synthetic_df, tmp_path):
    df, groups, _ = load_and_validate(_write(synthetic_df, tmp_path))
    splits = make_splits(df, groups, seed=1)
    i = int(np.flatnonzero(df.duplicated(FEATURE_COLUMNS, keep=False).to_numpy())[0])
    twin = int(np.flatnonzero((df[FEATURE_COLUMNS] == df[FEATURE_COLUMNS].iloc[i]).all(axis=1).to_numpy())[-1])
    splits = splits.copy()
    splits[i], splits[twin] = "train", "test"
    assert not check_split_leakage(df, splits)["passed"]


def test_splits_reproducible_and_stratified(synthetic_df, tmp_path):
    df, groups, _ = load_and_validate(_write(synthetic_df, tmp_path))
    a, b = make_splits(df, groups, seed=5), make_splits(df, groups, seed=5)
    assert (a == b).all()
    assert not (a == make_splits(df, groups, seed=6)).all()
    prev = df["Class"].mean()
    for s in ("train", "validation", "test"):
        assert abs(df["Class"][a == s].mean() - prev) < 0.01


def test_saved_split_assignments_match_metadata(trained):
    sp = pd.read_csv(trained["artifacts"] / "splits.csv")
    assert list(sp.columns) == ["transaction_ref", "row_position", "split", "duplicate_group"]
    assert sp["transaction_ref"].iloc[7] == make_ref(7)
    counts = trained["meta"]["splits"]["counts"]
    for s, c in counts.items():
        assert int((sp["split"] == s).sum()) == c["rows"]
    assert trained["meta"]["splits"]["leakage_check"]["passed"]
    assert len(trained["meta"]["dataset"]["fingerprint_sha256"]) == 64


# ---- target exclusion & preprocessing -------------------------------------------------------
def test_model_inputs_exclude_target_and_references(trained):
    pipe = joblib.load(trained["artifacts"] / "model.joblib")
    assert list(pipe.feature_names_in_) == FEATURE_COLUMNS
    assert len(FEATURE_COLUMNS) == 30
    for banned in ("Class", "transaction_ref", "row_position"):
        assert banned not in pipe.feature_names_in_
    assert set(trained["meta"]["feature_schema"]["excluded_from_model"]) >= {"Class", "transaction_ref"}


def test_scorer_rejects_target_and_extra_columns(trained):
    scorer = Scorer(joblib.load(trained["artifacts"] / "model.joblib"))
    frame = trained["df"].iloc[:3]  # still contains Class
    with pytest.raises(InputValidationError, match="target"):
        scorer.score(frame)
    with pytest.raises(InputValidationError):
        scorer.score(frame[FEATURE_COLUMNS].assign(transaction_ref="x"))
    with pytest.raises(InputValidationError):
        scorer.score(frame[FEATURE_COLUMNS].drop(columns=["V9"]))
    bad = frame[FEATURE_COLUMNS].copy()
    bad.iloc[0, 3] = np.nan
    with pytest.raises(InputValidationError):
        scorer.score(bad)
    bad = frame[FEATURE_COLUMNS].copy()
    bad.loc[bad.index[0], "Amount"] = -5
    with pytest.raises(InputValidationError):
        scorer.score(bad)


def test_preprocessing_is_fitted_on_training_rows_only(trained):
    pipe = joblib.load(trained["artifacts"] / "model.joblib")
    sp = pd.read_csv(trained["artifacts"] / "splits.csv")
    df = trained["df"]
    tr = df[(sp["split"] == "train").to_numpy()]
    scaler = pipe.named_steps["preprocess"].named_transformers_["v"]
    np.testing.assert_allclose(scaler.mean_, tr[[f"V{i}" for i in range(1, 29)]].mean().to_numpy(), rtol=1e-9)
    assert not np.allclose(scaler.mean_, df[[f"V{i}" for i in range(1, 29)]].mean().to_numpy(), rtol=0, atol=1e-12)
    t_scaler = pipe.named_steps["preprocess"].named_transformers_["time"]
    assert t_scaler.mean_[0] == pytest.approx(tr["Time"].mean())


def test_saved_pipeline_reproduces_scores_and_metrics(trained):
    pipe = joblib.load(trained["artifacts"] / "model.joblib")
    meta = json.loads((trained["artifacts"] / "metadata.json").read_text())
    sp = pd.read_csv(trained["artifacts"] / "splits.csv")
    df = trained["df"]
    te = (sp["split"] == "test").to_numpy()
    s1 = pipe.predict_proba(df.loc[te, FEATURE_COLUMNS])[:, 1]
    s2 = pipe.predict_proba(df.loc[te, FEATURE_COLUMNS])[:, 1]
    np.testing.assert_array_equal(s1, s2)
    assert s1.min() >= 0 and s1.max() <= 1
    from sklearn.metrics import average_precision_score

    assert average_precision_score(df.loc[te, "Class"], s1) == pytest.approx(meta["evaluation"]["test"]["average_precision"])
    ev = meta["evaluation"]["test"]
    assert ev["always_legitimate_baseline"]["recall"] == 0.0
    assert ev["evaluation_prevalence"] == pytest.approx(df.loc[te, "Class"].mean())
    t = meta["thresholds"]
    assert 0 <= t["review"] < t["hold"] <= 1


# ---- explanations ---------------------------------------------------------------------------
def _row(trained):
    return trained["df"][FEATURE_COLUMNS].iloc[[10]]


def test_linear_explanation_is_exact_and_additive(trained):
    df = trained["df"]
    pipe = pl.build_logistic(1.0, 0).fit(df[FEATURE_COLUMNS], df["Class"])
    e = ex.Explainer(pipe, np.zeros(30))
    out = e.explain(_row(trained), top_n=30)
    assert out["status"] == "available" and out["additive"] is True
    total = out["baseline_logit"] + sum(c["contribution"] for c in out["contributions"])
    assert total == pytest.approx(pipe.decision_function(_row(trained))[0])


def test_tree_explanation_available_and_unsupported_model_is_explicit(trained):
    pipe = joblib.load(trained["artifacts"] / "model.joblib")
    med = json.loads((trained["artifacts"] / "metadata.json").read_text())["explanation"]["reference_median_scaled"]
    out = ex.Explainer(pipe, np.array(med)).explain(_row(trained), top_n=5)
    assert out["status"] in ("available",) and len(out["contributions"]) == 5
    e = ex.Explainer(pipe, np.array(med))
    e.method = None  # simulate a model type without explanation support
    un = e.explain(_row(trained))
    assert un["status"] == "unavailable" and un["contributions"] == [] and un["unavailable_reason"]
