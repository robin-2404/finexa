"""Sign up, log in, log out, and session restore (HttpOnly session cookie + CSRF token)."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Request, Response

from .. import schemas as S
from ..errors import ApiError
from ..services import auth as authlib
from ..services.state import AppState
from .common import check_origin, current_user, get_state

router = APIRouter(prefix="/auth", tags=["auth"])
ERR = {401: {"model": S.ErrorResponse}, 422: {"model": S.ErrorResponse}}


def _db(st: AppState):
    if st.db is None:
        raise ApiError(503, "SERVICE_UNAVAILABLE", "The database is unavailable.")
    return st.db


def _client_key(request: Request, email: str) -> str:
    return f"{email}|{request.client.host if request.client else '-'}"


def _issue_session(st: AppState, response: Response, user: dict) -> S.AuthSession:
    token, csrf = authlib.new_token(), authlib.new_token()
    expires = authlib.expiry_iso(st.settings.session_hours)
    _db(st).create_session(authlib.token_hash(token), user["id"], csrf, expires)
    response.set_cookie(
        authlib.SESSION_COOKIE, token, max_age=max(1, int(st.settings.session_hours * 3600)), httponly=True,
        secure=st.settings.cookie_secure, samesite=st.settings.cookie_samesite, path="/",
    )
    return S.AuthSession(
        user=S.AuthUser(id=user["id"], email=user["email"], created_at=datetime.fromisoformat(user["created_at"])),
        csrf_token=csrf, expires_at=datetime.fromisoformat(expires),
    )


@router.post("/signup", response_model=S.AuthSession, status_code=201, responses={**ERR, 409: {"model": S.ErrorResponse}}, summary="Create an account and start a session")
def signup(body: S.SignupRequest, request: Request, response: Response, st: AppState = Depends(get_state)):
    check_origin(request, st.settings)
    user = _db(st).create_user(body.email, authlib.hash_password(body.password))
    if user is None:
        raise ApiError(409, "EMAIL_ALREADY_REGISTERED", "An account with this email already exists. Try logging in.")
    return _issue_session(st, response, user)


@router.post("/login", response_model=S.AuthSession, responses={**ERR, 429: {"model": S.ErrorResponse}}, summary="Start a session")
def login(body: S.LoginRequest, request: Request, response: Response, st: AppState = Depends(get_state)):
    check_origin(request, st.settings)
    email = authlib.normalize_email(body.email)
    key = _client_key(request, email)
    throttle = st.throttle
    wait = throttle.retry_after(key)
    if wait:
        raise ApiError(429, "TOO_MANY_ATTEMPTS", f"Too many failed attempts. Try again in {wait} seconds.")
    user = _db(st).get_user_by_email(email)
    if not authlib.verify_password(body.password, user["password_hash"] if user else None):
        throttle.record_failure(key)
        raise ApiError(401, "INVALID_CREDENTIALS", "Incorrect email or password.")
    throttle.reset(key)
    return _issue_session(st, response, user)


@router.post("/logout", response_model=S.OkResponse, summary="End the session (idempotent)")
def logout(request: Request, response: Response, st: AppState = Depends(get_state)):
    check_origin(request, st.settings)
    token = request.cookies.get(authlib.SESSION_COOKIE)
    if token and st.db is not None:
        st.db.delete_session(authlib.token_hash(token))
    response.delete_cookie(authlib.SESSION_COOKIE, path="/")
    return S.OkResponse()


@router.get("/me", response_model=S.AuthSession, responses=ERR, summary="Current session (restores login on page load)")
def me(sess: dict | None = Depends(current_user)):
    if sess is None:  # auth disabled (tests only)
        raise ApiError(401, "UNAUTHENTICATED", "Authentication is disabled on this server.")
    return S.AuthSession(
        user=S.AuthUser(id=sess["user_id"], email=sess["email"], created_at=datetime.fromisoformat(sess["user_created_at"])),
        csrf_token=sess["csrf_token"], expires_at=datetime.fromisoformat(sess["expires_at"]),
    )
