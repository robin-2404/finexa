import json
import math

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.constants import FEATURE_COLUMNS
from app.main import create_app

from .conftest import API


def _row(state, pos=5):
    r = state.df.iloc[pos]
    return {c: float(r[c]) for c in FEATURE_COLUMNS}


def _post_raw(client, path, payload: str):
    return client.post(API + path, content=payload, headers={"content-type": "application/json"})


# ---- readiness ------------------------------------------------------------------------------
def test_not_ready_when_artifacts_absent(tmp_path):
    s = Settings(data_path=tmp_path / "none.csv", artifacts_dir=tmp_path / "no-artifacts",
                 database_path=tmp_path / "x.sqlite3", sim_background_task=False)
    with TestClient(create_app(s)) as c:
        h = c.get(API + "/health")
        assert h.status_code == 200
        body = h.json()
        assert body["ready"] is False and body["status"] == "degraded" and body["reasons"]
        for path in ("/dataset", "/metrics", "/transactions", "/model/evaluation", "/patterns", "/simulation"):
            r = c.get(API + path)
            assert r.status_code == 503, path
            assert r.json()["error"]["code"] == "MODEL_NOT_READY"
        assert c.post(API + "/analyze", json={"transaction_ref": "TXN-000001"}).status_code == 503


def test_dataset_fingerprint_mismatch_is_not_ready(trained, tmp_path):
    bad = tmp_path / "other.csv"
    bad.write_text(trained["csv"].read_text().replace("\n", "\n", 1) + "0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0\n")
    s = Settings(data_path=bad, artifacts_dir=trained["artifacts"], database_path=tmp_path / "y.sqlite3", sim_background_task=False)
    with TestClient(create_app(s)) as c:
        assert c.get(API + "/health").json()["ready"] is False


def test_health_ready(client):
    b = client.get(API + "/health").json()
    assert b["ready"] and b["model_version"] and b["policy_version"].startswith("policy-v1")


def test_invalid_env_thresholds_make_service_not_ready(trained, tmp_path):
    s = Settings(data_path=trained["csv"], artifacts_dir=trained["artifacts"], database_path=tmp_path / "z.sqlite3",
                 sim_background_task=False, review_threshold=0.99)  # above the saved hold threshold
    with TestClient(create_app(s)) as c:
        assert c.get(API + "/health").json()["ready"] is False


def test_settings_reject_inverted_thresholds():
    with pytest.raises(ValueError):
        Settings(review_threshold=0.9, hold_threshold=0.1)


# ---- analyze / invalid inputs ---------------------------------------------------------------
def test_analyze_dataset_reference_matches_listing(client, state):
    r = client.post(API + "/analyze", json={"transaction_ref": "TXN-000005"})
    assert r.status_code == 200
    b = r.json()
    assert 0 <= b["score"] <= 1
    assert b["recommended_action"] in ("allow", "review", "hold") and b["risk_band"] in ("low", "medium", "high")
    assert b["model_version"] == state.model_version and b["policy_version"].startswith("policy-v1")
    assert b["source"] == "dataset_reference" and b["processed_at"].endswith("Z")
    assert b["explanation"]["status"] in ("available", "unavailable")
    assert b["score"] == pytest.approx(state.scores[5])
    listed = client.get(API + "/transactions/TXN-000005").json()
    assert listed["score"] == pytest.approx(b["score"])


def test_analyze_adhoc_and_target_is_rejected(client, state):
    row = _row(state)
    ok = client.post(API + "/analyze", json={"transaction": row})
    assert ok.status_code == 200 and ok.json()["transaction_ref"].startswith("ADHOC-") and ok.json()["source"] == "ad_hoc"
    assert client.post(API + "/analyze", json={"transaction": row}).json()["transaction_ref"] == ok.json()["transaction_ref"]
    leak = client.post(API + "/analyze", json={"transaction": {**row, "Class": 1}})
    assert leak.status_code == 422 and leak.json()["error"]["code"] == "VALIDATION_ERROR"
    assert any("Class" in d["location"] for d in leak.json()["error"]["details"])


@pytest.mark.parametrize(
    "mutate",
    [
        lambda r: {k: v for k, v in r.items() if k != "V7"},  # missing
        lambda r: {**r, "V7": "abc"},  # non-numeric
        lambda r: {**r, "Amount": -1},  # negative amount
        lambda r: {**r, "Time": -5},  # negative time
        lambda r: {**r, "V_extra": 1},  # unknown field
    ],
)
def test_invalid_prediction_inputs_return_422(client, state, mutate):
    r = client.post(API + "/analyze", json={"transaction": mutate(_row(state))})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR" and r.json()["error"]["details"]


def test_nan_and_infinity_are_rejected(client, state):
    row = json.dumps(_row(state)).replace(f'"V3": {_row(state)["V3"]}', '"V3": NaN')
    assert "NaN" in row
    assert _post_raw(client, "/analyze", '{"transaction": ' + row + "}").status_code == 422
    assert _post_raw(client, "/analyze", '{"transaction": ' + json.dumps(_row(state)).replace(f'"V4": {_row(state)["V4"]}', '"V4": Infinity') + "}").status_code == 422


def test_analyze_needs_exactly_one_source(client, state):
    assert client.post(API + "/analyze", json={}).status_code == 422
    assert client.post(API + "/analyze", json={"transaction_ref": "TXN-000001", "transaction": _row(state)}).status_code == 422
    assert client.post(API + "/analyze", json={"transaction_ref": "TXN-999999"}).status_code == 404
    assert client.post(API + "/analyze", json={"transaction_ref": "nope"}).status_code == 404


def test_threshold_overrides_validated_and_applied(client):
    base = client.post(API + "/analyze", json={"transaction_ref": "TXN-000005"}).json()
    s = base["score"]
    assert s > 0
    at_score = client.post(API + "/analyze", json={"transaction_ref": "TXN-000005", "review_threshold": 0.0, "hold_threshold": s}).json()
    assert at_score["recommended_action"] == "hold" and at_score["hold_threshold"] == s  # boundary is inclusive
    assert at_score["policy_version"] != base["policy_version"]
    above = client.post(API + "/analyze", json={"transaction_ref": "TXN-000005", "review_threshold": 0.0, "hold_threshold": min(1.0, s * 1.01 + 1e-9)}).json()
    assert s < 1 and above["recommended_action"] == "review"  # just below the hold threshold
    bad = client.post(API + "/analyze", json={"transaction_ref": "TXN-000005", "review_threshold": 0.9, "hold_threshold": 0.5})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_THRESHOLDS"
    only_review = client.post(API + "/analyze", json={"transaction_ref": "TXN-000005", "review_threshold": 1.0})
    assert only_review.status_code == 422  # would be >= saved hold threshold


def test_explanation_unavailable_is_explicit_and_prediction_still_works(client, state, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(state.explainer, "explain", boom)
    r = client.post(API + "/analyze", json={"transaction_ref": "TXN-000005"}).json()
    e = r["explanation"]
    assert e["status"] == "unavailable" and e["contributions"] == [] and e["method"] is None
    assert "secret" not in e["unavailable_reason"] and "RuntimeError" in e["unavailable_reason"]
    assert r["recommended_action"] in ("allow", "review", "hold")
    g = client.get(API + "/transactions/TXN-000005/explanation").json()
    assert g["status"] == "unavailable"


def test_explanation_disabled_by_config(trained, tmp_path):
    s = Settings(data_path=trained["csv"], artifacts_dir=trained["artifacts"], database_path=tmp_path / "e.sqlite3",
                 sim_background_task=False, explanations_enabled=False)
    with TestClient(create_app(s)) as c:
        r = c.get(API + "/transactions/TXN-000005/explanation").json()
        assert r["status"] == "unavailable" and "disabled" in r["unavailable_reason"]
        assert c.post(API + "/analyze", json={"transaction_ref": "TXN-000005"}).status_code == 200


def test_explanation_available_shape(client):
    r = client.get(API + "/transactions/TXN-000005/explanation?top_features=4").json()
    assert r["status"] == "available" and len(r["contributions"]) == 4
    assert r["contribution_scale"] == "log_odds"
    assert set(r["contributions"][0]) == {"feature", "value", "contribution", "direction"}
    assert all(c["feature"] in FEATURE_COLUMNS for c in r["contributions"])


# ---- transactions ---------------------------------------------------------------------------
def test_pagination_and_filters(client):
    r = client.get(API + "/transactions?page_size=10&page=2").json()
    assert len(r["items"]) == 10 and r["page"] == 2 and r["total_pages"] == math.ceil(r["total"] / 10)
    last = client.get(API + f"/transactions?page_size=10&page={r['total_pages'] + 1}").json()
    assert last["items"] == []
    t = client.get(API + "/transactions?split=test&page_size=200&sort=score&order=desc").json()
    assert all(i["split"] == "test" for i in t["items"])
    scores = [i["score"] for i in t["items"]]
    assert scores == sorted(scores, reverse=True)
    h = client.get(API + "/transactions?action=hold&page_size=200").json()
    assert all(i["recommended_action"] == "hold" and i["risk_band"] == "high" for i in h["items"])
    a = client.get(API + "/transactions?min_amount=50&max_amount=60&page_size=200").json()
    assert all(50 <= i["amount"] <= 60 for i in a["items"])
    tt = client.get(API + "/transactions?time_from=1000&time_to=2000&page_size=200").json()
    assert all(1000 <= i["source_time_seconds"] <= 2000 for i in tt["items"])


@pytest.mark.parametrize(
    "qs",
    ["page=0", "page_size=201", "page_size=0", "split=bogus", "risk_band=x", "min_score=1.5", "sort=nope",
     "min_score=0.9&max_score=0.1", "time_from=10&time_to=5", "min_amount=-1", "outcome=fraud&split=test"],
)
def test_invalid_filters_rejected_with_error_envelope(client, qs):
    r = client.get(API + "/transactions?" + qs)
    assert r.status_code == 422
    assert set(r.json()["error"]) == {"code", "message", "details"}


def test_labels_hidden_for_holdout_unless_revealed(client, state):
    tr = client.get(API + "/transactions?split=train&page_size=5").json()["items"]
    assert all(i["known_outcome"] in ("fraud", "legitimate") for i in tr)
    te = client.get(API + "/transactions?split=test&page_size=200").json()["items"]
    assert all(i["known_outcome"] is None for i in te)
    rv = client.get(API + "/transactions?split=test&reveal_outcome=true&outcome=fraud&page_size=200").json()
    assert rv["total"] > 0 and all(i["known_outcome"] == "fraud" for i in rv["items"])
    assert client.get(API + "/transactions?split=train&outcome=fraud").status_code == 200


def test_transaction_detail_and_404_and_malformed(client):
    d = client.get(API + "/transactions/TXN-000010").json()
    assert d["transaction_ref"] == "TXN-000010" and len(d["features"]) == 28 and "Class" not in d["features"]
    assert d["source_time_label"].startswith("T+")
    assert client.get(API + "/transactions/TXN-999999").json()["error"]["code"] == "TRANSACTION_NOT_FOUND"
    assert client.get(API + "/transactions/abc").status_code == 422
    assert client.get(API + "/nope").json()["error"]["code"] == "NOT_FOUND"


def test_similar_uses_training_reference_without_labels_in_space(client, state):
    tr_pos = int((state.splits == "train").nonzero()[0][3])
    ref = f"TXN-{tr_pos:06d}"
    r = client.get(API + f"/transactions/{ref}/similar?k=6").json()
    assert r["k"] == 6 and ref not in [n["transaction_ref"] for n in r["neighbors"]]
    assert all(state.splits[int(n["transaction_ref"][4:])] == "train" for n in r["neighbors"])
    dists = [n["distance"] for n in r["neighbors"]]
    assert dists == sorted(dists)
    assert "Time" in r["space"] and "excluded" in r["space"]


def test_similarity_index_is_label_independent(state):
    from app.ml.similarity import SIM_COLUMNS

    assert "Class" not in SIM_COLUMNS and "Time" not in SIM_COLUMNS and len(SIM_COLUMNS) == 29
    assert state.similarity.nn.n_features_in_ == 29


# ---- reporting endpoints --------------------------------------------------------------------
def test_dataset_metrics_evaluation_patterns(client, state):
    d = client.get(API + "/dataset").json()
    assert d["scope"] == "historical_dataset" and d["rows"] == len(state.df) and "declared_vs_actual" in d
    assert d["time"]["semantics"].startswith("Seconds relative")
    m = client.get(API + "/metrics").json()
    assert m["historical_dataset"]["scope"] == "historical_dataset"
    assert m["replay"]["scope"] == "replay" and m["evaluation"]["scope"] == "evaluation"
    assert "always_legitimate_baseline" in m["evaluation"]
    e = client.get(API + "/model/evaluation").json()
    t = e["test"]
    assert {"average_precision", "roc_auc", "evaluation_prevalence", "operating_points", "always_legitimate_baseline"} <= set(t)
    assert set(t["operating_points"]["hold"]["confusion_matrix"]) == {"tn", "fp", "fn", "tp"}
    assert "calibrat" in e["score_note"].lower() and "average precision" in e["average_precision_definition"].lower()
    assert "future" in e["caveat"]
    p = client.get(API + "/patterns?feature=V14").json()
    assert p["feature_distribution"]["feature"] == "V14" and p["clusters"]["items"]
    assert all("centroid" not in c for c in p["clusters"]["items"])
    assert "not" in p["clusters"]["note"].lower() and p["global_importance"]["is_local_explanation"] is False
    assert sum(c["size"] for c in p["clusters"]["items"]) == int((state.splits == "train").sum())
    assert client.get(API + "/patterns?feature=Class").status_code == 422


# ---- policy comparison ----------------------------------------------------------------------
def test_policy_compare_split_rules_and_shape(client):
    pol = {"name": "p", "review_threshold": 0.1, "hold_threshold": 0.8, "review_capacity": 3}
    r = client.post(API + "/policies/compare", json={"policies": [pol]}).json()
    assert r["split"] == "validation" and "tuning" in r["evaluation_split_note"]
    m = r["results"][0]["metrics"]
    assert m["alerts"]["cases_within_capacity"] + m["alerts"]["overflow"] == m["alerts"]["review_demand"]
    assert m["alerts"]["cases_within_capacity"] <= 3
    assert any("not verified prevention" in n for n in r["notes"])
    blocked = client.post(API + "/policies/compare", json={"policies": [pol], "split": "test"})
    assert blocked.status_code == 422 and blocked.json()["error"]["code"] == "FINAL_EVALUATION_NOT_ACKNOWLEDGED"
    final = client.post(API + "/policies/compare", json={"policies": [pol], "split": "test", "acknowledge_final_evaluation": True}).json()
    assert final["split"] == "test" and "FINAL" in final["evaluation_split_note"]
    assert client.post(API + "/policies/compare", json={"policies": [pol], "split": "train"}).status_code == 422


@pytest.mark.parametrize("r,h", [(0.5, 0.5), (0.9, 0.1), (-0.1, 0.5), (0.1, 1.5)])
def test_policy_compare_rejects_invalid_thresholds(client, r, h):
    res = client.post(API + "/policies/compare", json={"policies": [{"name": "x", "review_threshold": r, "hold_threshold": h}]})
    assert res.status_code == 422


def test_policy_compare_more_capacity_never_increases_overflow(client):
    out = []
    for cap in (0, 5, 50, None):
        pol = {"name": str(cap), "review_threshold": 0.05, "hold_threshold": 0.9, "review_capacity": cap}
        out.append(client.post(API + "/policies/compare", json={"policies": [pol]}).json()["results"][0]["metrics"]["alerts"]["overflow"])
    assert out == sorted(out, reverse=True) and out[-1] == 0


# ---- cors -----------------------------------------------------------------------------------
def test_cors_is_configurable(client):
    ok = client.options(API + "/health", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    bad = client.options(API + "/health", headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers


def test_cors_env_parsing(monkeypatch):
    monkeypatch.setenv("FINEXA_CORS_ORIGINS", "http://a.test, http://b.test")
    assert Settings().cors_origins == ["http://a.test", "http://b.test"]
