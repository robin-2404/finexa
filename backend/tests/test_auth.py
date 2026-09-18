import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.auth import LoginThrottle, hash_password, validate_password, verify_password

from .conftest import API

CRED = {"email": "Ana@Example.com", "password": "correct horse 42"}


def make_settings(trained, db, **kw):
    return Settings(data_path=kw.pop("data", trained["csv"]), artifacts_dir=trained["artifacts"], database_path=db,
                    sim_background_task=False, auth_required=True, cors_origins=["http://localhost:5173"], **kw)


@pytest.fixture()
def secured(trained, tmp_path):
    with TestClient(create_app(make_settings(trained, tmp_path / "auth.sqlite3"))) as c:
        yield c


def _signup(c, **over):
    return c.post(API + "/auth/signup", json={**CRED, **over})


def test_data_endpoints_require_a_session(secured):
    assert secured.get(API + "/health").status_code == 200  # public
    for path in ("/transactions", "/dataset", "/simulation", "/patterns", "/metrics", "/overview/activity"):
        r = secured.get(API + path)
        assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED", path
    assert secured.post(API + "/analyze", json={"transaction_ref": "TXN-000001"}).status_code == 401
    assert secured.get(API + "/auth/me").json()["error"]["code"] == "UNAUTHENTICATED"


def test_signup_sets_httponly_cookie_and_restores_via_me(secured):
    r = _signup(secured)
    assert r.status_code == 201
    body = r.json()
    assert body["user"]["email"] == "ana@example.com" and body["csrf_token"] and body["expires_at"].endswith("Z")
    cookie = r.headers["set-cookie"].lower()
    assert "finexa_session=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert "password" not in r.text.lower()
    me = secured.get(API + "/auth/me")
    assert me.status_code == 200 and me.json()["csrf_token"] == body["csrf_token"]
    assert secured.get(API + "/transactions?page_size=1").status_code == 200


def test_duplicate_email_and_case_insensitive_login(secured):
    _signup(secured)
    assert _signup(secured, email="ANA@example.com").json()["error"]["code"] == "EMAIL_ALREADY_REGISTERED"
    secured.cookies.clear()
    ok = secured.post(API + "/auth/login", json={"email": " ANA@example.com ", "password": CRED["password"]})
    assert ok.status_code == 200


@pytest.mark.parametrize(
    "over,loc",
    [({"email": "nope"}, "email"), ({"password": "short1"}, "password"), ({"password": "onlyletterslong"}, "password"),
     ({"password": "12345678901"}, "password"), ({"password": "x1" * 70}, "password")],
)
def test_signup_validation(secured, over, loc):
    r = _signup(secured, **over)
    assert r.status_code == 422
    assert any(loc in d["location"] for d in r.json()["error"]["details"])
    assert not any("Value error" in d["message"] for d in r.json()["error"]["details"])


def test_invalid_login_is_generic_and_throttled(secured):
    _signup(secured)
    secured.cookies.clear()
    for _ in range(5):
        r = secured.post(API + "/auth/login", json={"email": CRED["email"], "password": "wrong-password-1"})
        assert r.status_code == 401 and r.json()["error"]["code"] == "INVALID_CREDENTIALS"
    other = secured.post(API + "/auth/login", json={"email": "who@example.com", "password": "wrong-password-1"})
    assert other.json()["error"]["message"] == r.json()["error"]["message"]  # same message for unknown accounts
    blocked = secured.post(API + "/auth/login", json={"email": CRED["email"], "password": CRED["password"]})
    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "TOO_MANY_ATTEMPTS"


def test_csrf_required_for_unsafe_methods(secured):
    csrf = _signup(secured).json()["csrf_token"]
    url = API + "/transactions/TXN-000003/case"
    missing = secured.patch(url, json={"note": "x"})
    assert missing.status_code == 403 and missing.json()["error"]["code"] == "CSRF_FAILED"
    assert secured.patch(url, json={"note": "x"}, headers={"X-CSRF-Token": "wrong"}).status_code == 403
    ok = secured.patch(url, json={"note": "hello"}, headers={"X-CSRF-Token": csrf})
    assert ok.status_code == 200 and ok.json()["notes"][0]["author"] == "ana@example.com"  # author from the session
    assert secured.post(API + "/analyze", json={"transaction_ref": "TXN-000003"}).status_code == 403
    assert secured.post(API + "/analyze", json={"transaction_ref": "TXN-000003"}, headers={"X-CSRF-Token": csrf}).status_code == 200


def test_cross_origin_state_change_from_unlisted_origin_is_blocked(secured):
    r = secured.post(API + "/auth/login", json=CRED, headers={"Origin": "http://evil.example"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "ORIGIN_NOT_ALLOWED"
    ok = secured.post(API + "/auth/signup", json=CRED, headers={"Origin": "http://localhost:5173"})
    assert ok.status_code == 201


def test_logout_invalidates_session_and_is_idempotent(secured):
    _signup(secured)
    assert secured.post(API + "/auth/logout").json() == {"ok": True}
    assert secured.get(API + "/auth/me").status_code == 401
    assert secured.post(API + "/auth/logout").status_code == 200


def test_expired_session_reports_session_expired(trained, tmp_path):
    with TestClient(create_app(make_settings(trained, tmp_path / "e.sqlite3"))) as c:
        c.post(API + "/auth/signup", json=CRED)
        assert c.get(API + "/transactions?page_size=1").status_code == 200
        with c.app.state.finexa.db._conn() as conn:  # expire the session server-side
            conn.execute("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'")
        r = c.get(API + "/transactions")
        assert r.status_code == 401 and r.json()["error"]["code"] == "SESSION_EXPIRED"
        assert c.get(API + "/auth/me").json()["error"]["code"] == "SESSION_EXPIRED"


def test_session_survives_restart_and_auth_precedes_readiness(trained, tmp_path):
    db = tmp_path / "r.sqlite3"
    with TestClient(create_app(make_settings(trained, db))) as c:
        c.post(API + "/auth/signup", json=CRED)
        cookie = c.cookies.get("finexa_session")
    with TestClient(create_app(make_settings(trained, db, data=tmp_path / "missing.csv"))) as c2:  # model not ready
        assert c2.get(API + "/transactions").json()["error"]["code"] == "UNAUTHENTICATED"
        c2.cookies.set("finexa_session", cookie)
        assert c2.get(API + "/auth/me").status_code == 200
        assert c2.get(API + "/transactions").json()["error"]["code"] == "MODEL_NOT_READY"


def test_password_hashing_and_throttle_unit():
    h = hash_password("abc12345678")
    assert h.startswith("scrypt$") and "abc12345678" not in h and h != hash_password("abc12345678")
    assert verify_password("abc12345678", h) and not verify_password("abc12345679", h) and not verify_password("x", None)
    with pytest.raises(ValueError):
        validate_password("short")
    t = [0.0]
    th = LoginThrottle(2, 60, clock=lambda: t[0])
    th.record_failure("k")
    th.record_failure("k")
    assert th.retry_after("k") > 0
    t[0] = 100
    assert th.retry_after("k") == 0


def test_activity_endpoint(client, state):
    r = client.get(API + "/overview/activity?split=test&bucket_seconds=7200").json()
    assert r["scope"] == "historical_dataset" and r["labels_revealed"] is False
    assert sum(b["transactions"] for b in r["buckets"]) == r["totals"]["transactions"] == int((state.splits == "test").sum())
    assert all(b["known_fraud"] is None for b in r["buckets"]) and r["totals"]["known_fraud"] is None
    t = r["totals"]
    assert sum(t["by_risk_band"].values()) == t["transactions"] == sum(t["by_action"].values())
    assert t["model_flagged"] == t["by_action"]["review"] + t["by_action"]["hold"]
    rv = client.get(API + "/overview/activity?split=test&reveal_outcome=true").json()
    assert rv["totals"]["known_fraud"] == int(state.labels[state.splits == "test"].sum())
    assert sum(b["known_fraud"] for b in rv["buckets"]) == rv["totals"]["known_fraud"]
    assert client.get(API + "/overview/activity?split=train").json()["labels_revealed"] is True
    assert client.get(API + "/overview/activity?bucket_seconds=5").status_code == 422
    hi = client.get(API + "/overview/activity?risk_band=high").json()["totals"]
    assert hi["by_risk_band"]["low"] == 0 and hi["by_risk_band"]["high"] == hi["transactions"]
