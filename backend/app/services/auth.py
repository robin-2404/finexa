"""Password hashing, session tokens, and login throttling (stdlib only)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

SESSION_COOKIE = "finexa_session"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PASSWORD_MIN, PASSWORD_MAX = 10, 128
PASSWORD_RULES = f"{PASSWORD_MIN}-{PASSWORD_MAX} characters, with at least one letter and one number."

_N, _R, _P = 2**14, 8, 1
_DUMMY_SALT = b"finexa-dummy-salt"


def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_email(email: str) -> str:
    e = normalize_email(email)
    if len(e) > 254 or not EMAIL_RE.match(e):
        raise ValueError("Enter a valid email address.")
    return e


def validate_password(pw: str, email: str | None = None) -> str:
    if not (PASSWORD_MIN <= len(pw) <= PASSWORD_MAX):
        raise ValueError(f"Password must be {PASSWORD_MIN}-{PASSWORD_MAX} characters.")
    if not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        raise ValueError("Password must include at least one letter and one number.")
    if email and pw.lower() == normalize_email(email):
        raise ValueError("Password must not be the same as your email.")
    return pw


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${base64.b64encode(salt).decode()}${base64.b64encode(h).decode()}"


def verify_password(pw: str, stored: str | None) -> bool:
    """Constant-ish time; verifies against a dummy hash when the user does not exist."""
    if stored is None:
        hashlib.scrypt(pw.encode(), salt=_DUMMY_SALT, n=_N, r=_R, p=_P, dklen=32)
        return False
    try:
        _, n, r, p, salt, h = stored.split("$")
        calc = hashlib.scrypt(pw.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(calc, base64.b64decode(h))
    except Exception:
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def expiry_iso(hours: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class LoginThrottle:
    """In-memory limiter: too many failed logins for an (email, client) pair block further attempts briefly."""

    def __init__(self, max_failures: int = 5, window_seconds: float = 600.0, clock=time.monotonic):
        self.max, self.window, self.clock = max_failures, window_seconds, clock
        self._fails: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, key: str) -> list[float]:
        cutoff = self.clock() - self.window
        fails = [t for t in self._fails.get(key, []) if t > cutoff]
        self._fails[key] = fails
        return fails

    def retry_after(self, key: str) -> int:
        """Seconds until another attempt is allowed (0 = allowed now)."""
        with self._lock:
            fails = self._prune(key)
            if len(fails) < self.max:
                return 0
            return max(1, int(fails[0] + self.window - self.clock()) + 1)

    def record_failure(self, key: str) -> None:
        with self._lock:
            self._prune(key).append(self.clock())

    def reset(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key, None)
