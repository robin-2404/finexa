import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.db import Database
from app.services.simulation import COMPLETED, IDLE, PAUSED, RUNNING, SimulationEngine, TransitionError

from .conftest import API


# ---- replay engine --------------------------------------------------------------------------
def test_replay_uses_holdout_only_in_time_order(state):
    sim = state.sim
    assert sim.total == int((state.splits == "test").sum())
    sim.advance(sim.total)
    ev = sim.events_after(0, 100000, None, False)["events"]
    times = [e["source_time_seconds"] for e in ev]
    assert times == sorted(times)
    assert all(state.splits[int(e["transaction_ref"][4:])] == "test" for e in ev)
    assert all(e["known_outcome"] is None for e in ev)  # labels not in the live display


def test_replay_goes_through_the_real_scoring_pipeline(state, monkeypatch):
    calls = []
    orig = state.scorer.score

    def spy(frame):
        calls.append(list(frame.columns))
        return orig(frame)

    monkeypatch.setattr(state.scorer, "score", spy)
    state.sim.advance(7)
    assert calls and "Class" not in calls[0] and len(calls[0]) == 30
    e = state.sim.events_after(0, 10, None, False)["events"][0]
    pos = int(e["transaction_ref"][4:])
    assert e["score"] == pytest.approx(float(orig(state.row_frame(pos))[0]))
    assert e["policy_version"] == state.policy.version and e["model_version"] == state.model_version


def test_state_transitions(state):
    sim = state.sim
    assert sim.status == IDLE
    for bad in (sim.pause, sim.resume):
        with pytest.raises(TransitionError):
            bad()
    sim.start(2.0)
    assert sim.status == RUNNING and sim.speed == 2.0
    with pytest.raises(TransitionError):
        sim.start()
    sim.pause()
    assert sim.status == PAUSED
    with pytest.raises(TransitionError):
        sim.pause()
    with pytest.raises(TransitionError):
        sim.start()
    sim.resume(5.0)
    assert sim.status == RUNNING and sim.speed == 5.0
    sim.reset()
    assert sim.status == IDLE and sim.processed == 0
    for bad in (0.0, -1, 1e6):
        with pytest.raises(ValueError):
            sim.set_speed(bad)


def test_tick_follows_clock_and_speed_and_pause_stops_progress(state):
    t = [100.0]
    sim = SimulationEngine(
        state.df.iloc[:200], np.arange(200), state.labels[:200], state.scorer, lambda: state.policy,
        state.model_version, base_rate=10.0, clock=lambda: t[0],
    )
    sim.start(1.0)
    t[0] += 1.0
    assert sim.tick() == 10
    sim.set_speed(3.0)
    t[0] += 1.0
    assert sim.tick() == 30
    sim.pause()
    n = sim.processed
    t[0] += 50
    assert sim.tick() == 0 and sim.processed == n
    sim.resume()
    t[0] += 0.5
    assert sim.tick() == 15


def test_completion_and_no_duplicates_via_cursor(state):
    sim = state.sim
    sim.start(1.0)
    seen, cursor = [], 0
    for step in (3, 10, 1):
        sim.advance(step)
        page = sim.events_after(cursor, 100, sim.run_id, False)
        seen += [e["event_id"] for e in page["events"]]
        cursor = page["next_cursor"]
    assert cursor == 14 and len(seen) == len(set(seen)) == 14
    assert sim.events_after(cursor, 10, None, False) ["events"] == []  # nothing new -> nothing repeated
    sim.advance(10**9)
    assert sim.status == COMPLETED and sim.processed == sim.total
    tail = sim.events_after(cursor, 10**6, None, False)
    assert tail["has_more"] is False and tail["next_cursor"] == sim.total
    assert sim.advance(5) == 0


def test_cursor_paging_limit_and_ids_are_stable(state):
    sim = state.sim
    sim.advance(25)
    p1 = sim.events_after(0, 10, None, False)
    p2 = sim.events_after(p1["next_cursor"], 10, None, False)
    assert p1["has_more"] and [e["sequence"] for e in p2["events"]] == list(range(11, 21))
    again = sim.events_after(0, 10, None, False)
    assert [e["event_id"] for e in again["events"]] == [e["event_id"] for e in p1["events"]]
    with pytest.raises(ValueError):
        sim.events_after(26, 10, None, False)
    with pytest.raises(LookupError):
        sim.events_after(0, 10, "other-run", False)


def test_reset_starts_new_run_and_api_reports_conflict(client):
    c = client
    run1 = c.get(API + "/simulation").json()["run_id"]
    assert c.post(API + "/simulation/control", json={"action": "reset"}).json()["run_id"] != run1
    assert c.get(API + f"/simulation/events?run_id={run1}").status_code == 409
    assert c.get(API + f"/simulation/events?run_id={run1}").json()["error"]["code"] == "SIMULATION_RESET"


def test_simulation_api_flow_and_labels(client, state):
    c = client
    s = c.get(API + "/simulation").json()
    assert s["status"] == "idle" and "Historical simulation" in s["label"] and s["retrospective"] is None
    assert c.post(API + "/simulation/control", json={"action": "pause"}).json()["error"]["code"] == "INVALID_STATE_TRANSITION"
    assert c.post(API + "/simulation/control", json={"action": "set_speed"}).status_code == 422
    assert c.post(API + "/simulation/control", json={"action": "start", "speed": 9999}).json()["error"]["code"] == "INVALID_SPEED"
    assert c.post(API + "/simulation/control", json={"action": "start", "speed": 4}).json()["status"] == "running"
    state.sim.advance(30)
    r = c.get(API + "/simulation/events?limit=20").json()
    assert len(r["events"]) == 20 and r["next_cursor"] == 20
    e = r["events"][0]
    assert e["processed_at"].endswith("Z") and e["source_time_label"].startswith("T+") and isinstance(e["source_time_seconds"], float)
    assert e["known_outcome"] is None and set(e) >= {"event_id", "sequence", "run_id", "recommended_action", "policy_version"}
    nxt = c.get(API + f"/simulation/events?cursor={r['next_cursor']}&run_id={r['run_id']}&limit=100").json()
    assert {x["event_id"] for x in nxt["events"]}.isdisjoint({x["event_id"] for x in r["events"]})
    rev = c.get(API + "/simulation/events?limit=5&reveal_outcome=true").json()["events"]
    assert all(x["known_outcome"] in ("fraud", "legitimate") for x in rev)
    retro = c.get(API + "/simulation?reveal_outcome=true").json()["retrospective"]
    assert retro["scope"] == "replay_retrospective" and retro["processed"] >= 30
    assert c.get(API + "/simulation/events?cursor=99999").json()["error"]["code"] == "INVALID_CURSOR"
    assert c.post(API + "/simulation/control", json={"action": "set_speed", "speed": 50}).json()["speed"] == 50
    assert c.post(API + "/simulation/control", json={"action": "reset"}).json()["processed"] == 0


def test_background_task_advances_replay(trained, tmp_path):
    s = Settings(data_path=trained["csv"], artifacts_dir=trained["artifacts"], database_path=tmp_path / "bg.sqlite3",
                 sim_background_task=True, sim_tick_seconds=0.05, sim_base_events_per_second=200)
    with TestClient(create_app(s)) as c:
        c.post(API + "/simulation/control", json={"action": "start", "speed": 1})
        import time

        time.sleep(0.8)
        assert c.get(API + "/simulation").json()["processed"] > 0
        c.post(API + "/simulation/control", json={"action": "pause"})
        n = c.get(API + "/simulation").json()["processed"]
        time.sleep(0.3)
        assert c.get(API + "/simulation").json()["processed"] == n


# ---- SQLite persistence ---------------------------------------------------------------------
def test_case_defaults_then_patch_persists_across_restart(trained, tmp_path):
    settings = Settings(data_path=trained["csv"], artifacts_dir=trained["artifacts"], database_path=tmp_path / "p.sqlite3",
                        sim_background_task=False)
    ref = "TXN-000042"
    with TestClient(create_app(settings)) as c:
        g = c.get(API + f"/transactions/{ref}/case").json()
        assert g["persisted"] is False and g["review_status"] == "unreviewed" and g["notes"] == []
        assert g["current"]["model_version"] and g["current"]["policy_version"]
        r = c.patch(API + f"/transactions/{ref}/case", json={"review_status": "in_review", "note": "checking", "author": "ana"})
        assert r.status_code == 200
        r = c.patch(API + f"/transactions/{ref}/case", json={"analyst_assessment": "suspected_fraud"}).json()
        assert r["assessed_at"].endswith("Z") and r["analyst_assessment"] == "suspected_fraud"
        closed = c.patch(API + f"/transactions/{ref}/case", json={"review_status": "closed", "note": "done"}).json()
        assert closed["closed_at"] and closed["review_status"] == "closed"
        mv = closed["model_version_at_last_update"]
    with TestClient(create_app(settings)) as c2:  # brand-new app, same SQLite file
        g = c2.get(API + f"/transactions/{ref}/case").json()
        assert g["persisted"] and g["review_status"] == "closed" and g["analyst_assessment"] == "suspected_fraud"
        assert [n["note"] for n in g["notes"]] == ["checking", "done"] and g["notes"][0]["author"] == "ana"
        assert g["model_version_at_last_update"] == mv and g["policy_version_at_last_update"].startswith("policy-v1")
        assert g["notes"][0]["model_version"] == mv and g["notes"][0]["policy_version"]
        fields = [h["field"] for h in g["history"]]
        assert fields.count("review_status") == 2 and "analyst_assessment" in fields and fields.count("note_added") == 2
        listed = c2.get(API + "/transactions?review_status=closed").json()
        assert [i["transaction_ref"] for i in listed["items"]] == [ref]
        assert listed["items"][0]["analyst_assessment"] == "suspected_fraud"
        un = c2.get(API + "/transactions?review_status=unreviewed&page_size=200").json()
        assert ref not in [i["transaction_ref"] for i in un["items"]]


def test_analyst_assessment_is_separate_from_dataset_label(client, state):
    pos = int(np.flatnonzero(state.labels == 0)[0])
    ref = f"TXN-{pos:06d}"
    before = state.labels.copy()
    client.patch(API + f"/transactions/{ref}/case", json={"analyst_assessment": "suspected_fraud"})
    assert (state.labels == before).all()
    tr = client.get(API + f"/transactions/{ref}?reveal_outcome=true").json()
    assert tr["known_outcome"] == "legitimate" and tr["analyst_assessment"] == "suspected_fraud"


def test_patch_validation(client):
    ref = "TXN-000003"
    assert client.patch(API + f"/transactions/{ref}/case", json={}).status_code == 422
    assert client.patch(API + f"/transactions/{ref}/case", json={"review_status": "bogus"}).status_code == 422
    assert client.patch(API + f"/transactions/{ref}/case", json={"review_status": None}).status_code == 422
    assert client.patch(API + f"/transactions/{ref}/case", json={"note": ""}).status_code == 422
    assert client.patch(API + f"/transactions/{ref}/case", json={"Class": 1, "note": "x"}).status_code == 422
    assert client.patch(API + "/transactions/TXN-999999/case", json={"note": "x"}).status_code == 404
    r = client.patch(API + f"/transactions/{ref}/case", json={"review_status": "closed"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "ASSESSMENT_REQUIRED_TO_CLOSE"
    assert client.get(API + f"/transactions/{ref}/case").json()["persisted"] is False  # failed patch left nothing behind
    ok = client.patch(API + f"/transactions/{ref}/case", json={"analyst_assessment": "inconclusive"}).json()
    cleared = client.patch(API + f"/transactions/{ref}/case", json={"analyst_assessment": None}).json()
    assert ok["analyst_assessment"] == "inconclusive" and cleared["analyst_assessment"] is None and cleared["assessed_at"] is None


def test_database_is_wal_and_survives_reopen(tmp_path):
    db = Database(tmp_path / "d.sqlite3")
    db.update_case("TXN-000001", model_version="m", policy_version="p", score=0.5, action="review", note="n")
    db2 = Database(tmp_path / "d.sqlite3")
    rec = db2.get_case("TXN-000001")
    assert rec["notes"][0]["note"] == "n" and rec["case"]["model_version"] == "m"
    assert db2.ping()
