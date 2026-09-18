"""SQLite persistence for analyst cases. Analyst assessments live here and are never
mixed with, or fed back into, the dataset's verified Class labels."""
from __future__ import annotations

import sqlite3
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS cases (
    transaction_ref   TEXT PRIMARY KEY,
    review_status     TEXT NOT NULL DEFAULT 'unreviewed',
    analyst_assessment TEXT,
    assessed_at       TEXT,
    closed_at         TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    model_version     TEXT NOT NULL,
    policy_version    TEXT NOT NULL,
    score_at_update   REAL,
    action_at_update  TEXT
);
CREATE TABLE IF NOT EXISTS case_notes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_ref TEXT NOT NULL,
    note            TEXT NOT NULL,
    author          TEXT,
    created_at      TEXT NOT NULL,
    model_version   TEXT NOT NULL,
    policy_version  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS case_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_ref TEXT NOT NULL,
    field           TEXT NOT NULL,
    old_value       TEXT,
    new_value       TEXT,
    changed_at      TEXT NOT NULL,
    model_version   TEXT NOT NULL,
    policy_version  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    csrf_token TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_ref ON case_notes(transaction_ref);
CREATE INDEX IF NOT EXISTS idx_history_ref ON case_history(transaction_ref);
"""


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def ping(self) -> bool:
        try:
            with self._conn() as c:
                c.execute("SELECT 1").fetchone()
            return True
        except sqlite3.Error:
            return False

    # ---- users & sessions -------------------------------------------------------------
    def create_user(self, email: str, password_hash: str) -> dict | None:
        """Returns the new user, or None if the email is already registered."""
        try:
            with self._conn() as c:
                cur = c.execute(
                    "INSERT INTO users(email, password_hash, created_at) VALUES (?,?,?)", (email, password_hash, utcnow_iso())
                )
                row = c.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()
            return dict(row)
        except sqlite3.IntegrityError:
            return None

    def get_user_by_email(self, email: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        return dict(row) if row else None

    def create_session(self, token_hash: str, user_id: int, csrf_token: str, expires_at: str) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM sessions WHERE expires_at < ?", (utcnow_iso(),))
            c.execute(
                "INSERT INTO sessions(token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?,?,?,?,?)",
                (token_hash, user_id, csrf_token, utcnow_iso(), expires_at),
            )

    def get_session(self, token_hash: str) -> dict | None:
        """Session joined with its user, or None when unknown or expired."""
        with self._conn() as c:
            row = c.execute(
                "SELECT s.csrf_token, s.expires_at, u.id AS user_id, u.email, u.created_at AS user_created_at"
                " FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash=? AND s.expires_at > ?",
                (token_hash, utcnow_iso()),
            ).fetchone()
        return dict(row) if row else None

    def delete_session(self, token_hash: str) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))

    def get_case(self, ref: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM cases WHERE transaction_ref=?", (ref,)).fetchone()
            if row is None:
                return None
            notes = c.execute("SELECT * FROM case_notes WHERE transaction_ref=? ORDER BY id", (ref,)).fetchall()
            hist = c.execute("SELECT * FROM case_history WHERE transaction_ref=? ORDER BY id", (ref,)).fetchall()
        return {"case": dict(row), "notes": [dict(n) for n in notes], "history": [dict(h) for h in hist]}

    def statuses(self, status: str) -> set[str]:
        with self._conn() as c:
            rows = c.execute("SELECT transaction_ref FROM cases WHERE review_status=?", (status,)).fetchall()
        return {r[0] for r in rows}

    def status_for(self, refs: list[str]) -> dict[str, tuple[str, str | None]]:
        if not refs:
            return {}
        q = ",".join("?" * len(refs))
        with self._conn() as c:
            rows = c.execute(
                f"SELECT transaction_ref, review_status, analyst_assessment FROM cases WHERE transaction_ref IN ({q})", refs
            ).fetchall()
        return {r[0]: (r[1], r[2]) for r in rows}

    def update_case(
        self,
        ref: str,
        *,
        model_version: str,
        policy_version: str,
        score: float,
        action: str,
        review_status: str | None = None,
        set_assessment: bool = False,
        analyst_assessment: str | None = None,
        note: str | None = None,
        author: str | None = None,
    ) -> None:
        """Apply a partial update atomically, recording notes and an audit trail."""
        now = utcnow_iso()
        with self._conn() as c:
            c.execute("BEGIN IMMEDIATE")
            row = c.execute("SELECT * FROM cases WHERE transaction_ref=?", (ref,)).fetchone()
            if row is None:
                c.execute(
                    "INSERT INTO cases(transaction_ref, review_status, created_at, updated_at, model_version, policy_version,"
                    " score_at_update, action_at_update) VALUES (?, 'unreviewed', ?, ?, ?, ?, ?, ?)",
                    (ref, now, now, model_version, policy_version, score, action),
                )
                row = c.execute("SELECT * FROM cases WHERE transaction_ref=?", (ref,)).fetchone()

            def log(field, old, new):
                c.execute(
                    "INSERT INTO case_history(transaction_ref, field, old_value, new_value, changed_at, model_version, policy_version)"
                    " VALUES (?,?,?,?,?,?,?)",
                    (ref, field, old, new, now, model_version, policy_version),
                )

            sets: dict[str, object] = {}
            if review_status is not None and review_status != row["review_status"]:
                log("review_status", row["review_status"], review_status)
                sets["review_status"] = review_status
                sets["closed_at"] = now if review_status == "closed" else None
            if set_assessment and analyst_assessment != row["analyst_assessment"]:
                log("analyst_assessment", row["analyst_assessment"], analyst_assessment)
                sets["analyst_assessment"] = analyst_assessment
                sets["assessed_at"] = now if analyst_assessment is not None else None
            if note:
                c.execute(
                    "INSERT INTO case_notes(transaction_ref, note, author, created_at, model_version, policy_version)"
                    " VALUES (?,?,?,?,?,?)",
                    (ref, note, author, now, model_version, policy_version),
                )
                log("note_added", None, None)
            sets.update(
                updated_at=now, model_version=model_version, policy_version=policy_version,
                score_at_update=score, action_at_update=action,
            )
            cols = ", ".join(f"{k}=?" for k in sets)
            c.execute(f"UPDATE cases SET {cols} WHERE transaction_ref=?", (*sets.values(), ref))
