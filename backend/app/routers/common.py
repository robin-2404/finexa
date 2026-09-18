"""Shared dependencies and helpers for routers."""
from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime

import pandas as pd
from fastapi import Depends, Request

from ..constants import FEATURE_COLUMNS
from ..errors import ApiError
from ..ml import explain as ex
from ..services import auth as authlib
from ..services.db import utcnow_iso
from ..services.policy import Policy, PolicyError
from ..services.state import AppState


def get_state(request: Request) -> AppState:
    return request.app.state.finexa


SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def check_origin(request: Request, settings) -> None:
    """Reject cross-site state-changing requests from origins that are not allow-listed."""
    origin = request.headers.get("origin")
    if origin is None:
        return
    allowed = set(settings.cors_origins)
    if "*" in allowed or origin in allowed or origin == f"{request.url.scheme}://{request.headers.get('host', '')}":
        return
    raise ApiError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.")


def current_user(request: Request, st: AppState = Depends(get_state)) -> dict | None:
    """Session-cookie authentication. Unsafe methods must also carry the session's CSRF token."""
    if not st.settings.auth_required:
        return None
    if st.db is None:
        raise ApiError(503, "SERVICE_UNAVAILABLE", "The database is unavailable.")
    token = request.cookies.get(authlib.SESSION_COOKIE)
    if not token:
        raise ApiError(401, "UNAUTHENTICATED", "Sign in to continue.")
    sess = st.db.get_session(authlib.token_hash(token))
    if sess is None:
        raise ApiError(401, "SESSION_EXPIRED", "Your session has expired. Sign in again.")
    if request.method not in SAFE_METHODS:
        check_origin(request, st.settings)
        sent = request.headers.get("x-csrf-token", "")
        if not hmac.compare_digest(sent.encode(), sess["csrf_token"].encode()):
            raise ApiError(403, "CSRF_FAILED", "Missing or invalid CSRF token.")
    return sess


def require_ready(user: dict | None = Depends(current_user), st: AppState = Depends(get_state)) -> AppState:
    if not st.ready:
        raise ApiError(
            503,
            "MODEL_NOT_READY",
            "The service is not ready: " + ("; ".join(st.reasons) or "artifacts not loaded"),
        )
    return st


def parse_dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def resolve_policy(st: AppState, review: float | None, hold: float | None) -> Policy:
    r = st.policy.review_threshold if review is None else review
    h = st.policy.hold_threshold if hold is None else hold
    if review is None and hold is None:
        return st.policy
    try:
        return Policy(r, h)
    except PolicyError as exc:
        raise ApiError(422, "INVALID_THRESHOLDS", str(exc))


def explain_frame(st: AppState, frame: pd.DataFrame, top_n: int) -> dict:
    """Explanation that degrades to an explicit 'unavailable' status; prediction is never blocked."""
    if not st.settings.explanations_enabled:
        return ex.unavailable("explanations are disabled by configuration (FINEXA_EXPLANATIONS_ENABLED=false)")
    try:
        return st.explainer.explain(frame, top_n=top_n)
    except Exception as exc:
        return ex.unavailable(f"explanation computation failed ({type(exc).__name__})")


def adhoc_ref(frame: pd.DataFrame) -> str:
    payload = json.dumps([float(v) for v in frame[FEATURE_COLUMNS].iloc[0]])
    return "ADHOC-" + hashlib.sha256(payload.encode()).hexdigest()[:12]


def now_iso() -> str:
    return utcnow_iso()
