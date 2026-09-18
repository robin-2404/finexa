"""Historical replay of held-out transactions in dataset-time order.

Every replayed row goes through the real scoring pipeline (validate -> saved preprocessing ->
model -> policy). Labels are held separately and only surfaced by explicit retrospective calls.
State machine: idle -> running <-> paused -> completed; reset returns to idle from anywhere.
"""
from __future__ import annotations

import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Callable

import numpy as np
import pandas as pd

from ..constants import FEATURE_COLUMNS, make_ref, time_label
from .policy import Policy
from .scoring import Scorer

IDLE, RUNNING, PAUSED, COMPLETED = "idle", "running", "paused", "completed"
MIN_SPEED, MAX_SPEED = 0.1, 1000.0
MAX_BATCH_PER_TICK = 2000


class TransitionError(Exception):
    pass


class SimulationEngine:
    def __init__(
        self,
        features: pd.DataFrame,          # replay rows, already in dataset-time order (FEATURE_COLUMNS only)
        positions: np.ndarray,           # source row positions for those rows
        labels: np.ndarray,              # kept private; only for retrospective views
        scorer: Scorer,
        policy_provider: Callable[[], Policy],
        model_version: str,
        base_rate: float,
        clock: Callable[[], float] = time.monotonic,
    ):
        assert list(features.columns) == FEATURE_COLUMNS
        self._features = features.reset_index(drop=True)
        self._positions = np.asarray(positions)
        self._labels = np.asarray(labels)
        self._scorer, self._policy_provider, self._model_version = scorer, policy_provider, model_version
        self.base_rate, self._clock = base_rate, clock
        self._lock = threading.RLock()
        self.total = len(self._positions)
        self._reset_state()

    # -- state -------------------------------------------------------------------------------
    def _reset_state(self) -> None:
        self.status = IDLE
        self.speed = 1.0
        self.run_id = uuid.uuid4().hex[:12]
        self._events: list[dict] = []
        self._carry = 0.0
        self._last_tick: float | None = None
        self.started_at: datetime | None = None
        self.updated_at = datetime.now(timezone.utc)

    @property
    def processed(self) -> int:
        return len(self._events)

    def _touch(self) -> None:
        self.updated_at = datetime.now(timezone.utc)

    @staticmethod
    def _check_speed(speed: float | None) -> None:
        if speed is not None and not (MIN_SPEED <= speed <= MAX_SPEED):
            raise ValueError(f"speed must be between {MIN_SPEED} and {MAX_SPEED}")

    # -- controls ----------------------------------------------------------------------------
    def start(self, speed: float | None = None) -> None:
        with self._lock:
            self._check_speed(speed)
            if self.status != IDLE:
                raise TransitionError(f"Cannot start from '{self.status}'; reset first." if self.status != PAUSED
                                      else "Simulation is paused; use resume.")
            if self.total == 0:
                raise TransitionError("No held-out transactions available to replay.")
            if speed is not None:
                self.speed = speed
            self.status, self.started_at = RUNNING, datetime.now(timezone.utc)
            self._last_tick, self._carry = self._clock(), 0.0
            self._touch()

    def pause(self) -> None:
        with self._lock:
            if self.status != RUNNING:
                raise TransitionError(f"Cannot pause from '{self.status}'.")
            self.tick()
            if self.status == RUNNING:
                self.status = PAUSED
            self._last_tick = None
            self._touch()

    def resume(self, speed: float | None = None) -> None:
        with self._lock:
            self._check_speed(speed)
            if self.status != PAUSED:
                raise TransitionError(f"Cannot resume from '{self.status}'.")
            if speed is not None:
                self.speed = speed
            self.status, self._last_tick = RUNNING, self._clock()
            self._touch()

    def set_speed(self, speed: float) -> None:
        with self._lock:
            self._check_speed(speed)
            if self.status == RUNNING:
                self.tick()  # account for elapsed time at the old speed first
            self.speed = speed
            self._touch()

    def reset(self) -> None:
        with self._lock:
            self._reset_state()

    # -- progress ----------------------------------------------------------------------------
    def tick(self) -> int:
        """Advance according to wall-clock time and current speed. Called by the background task."""
        with self._lock:
            if self.status != RUNNING:
                return 0
            now = self._clock()
            elapsed = max(0.0, now - (self._last_tick or now))
            self._last_tick = now
            self._carry += elapsed * self.base_rate * self.speed
            n = int(self._carry)
            self._carry -= n
            return self.advance(min(n, MAX_BATCH_PER_TICK)) if n else 0

    def advance(self, n: int) -> int:
        """Process the next `n` rows through the real pipeline. Returns the number processed."""
        with self._lock:
            start = self.processed
            stop = min(start + max(0, n), self.total)
            if stop <= start:
                if self.processed >= self.total and self.status == RUNNING:
                    self.status = COMPLETED
                return 0
            batch = self._features.iloc[start:stop]
            scores = self._scorer.score(batch)
            policy = self._policy_provider()
            now = datetime.now(timezone.utc)
            times = batch["Time"].to_numpy()
            amounts = batch["Amount"].to_numpy()
            for i, s in enumerate(scores):
                seq = start + i + 1
                band, action = policy.decide_one(float(s))
                pos = int(self._positions[start + i])
                self._events.append(
                    {
                        "event_id": f"evt-{seq:06d}",
                        "sequence": seq,
                        "run_id": self.run_id,
                        "transaction_ref": make_ref(pos),
                        "source_time_seconds": float(times[i]),
                        "source_time_label": time_label(times[i]),
                        "amount": float(amounts[i]),
                        "score": float(s),
                        "risk_band": band,
                        "action": action,
                        "model_version": self._model_version,
                        "policy_version": policy.version,
                        "processed_at": now,
                        "_index": start + i,
                    }
                )
            if self.processed >= self.total:
                self.status = COMPLETED
            self._touch()
            return stop - start

    # -- reads -------------------------------------------------------------------------------
    def snapshot(self) -> dict:
        with self._lock:
            return {
                "status": self.status,
                "run_id": self.run_id,
                "speed": self.speed,
                "base_events_per_second": self.base_rate,
                "effective_events_per_second": self.base_rate * self.speed,
                "total": self.total,
                "processed": self.processed,
                "remaining": self.total - self.processed,
                "cursor": self.processed,
                "started_at": self.started_at,
                "updated_at": self.updated_at,
                "last_source_time_seconds": self._events[-1]["source_time_seconds"] if self._events else None,
            }

    def events_after(self, cursor: int, limit: int, run_id: str | None, reveal_outcome: bool) -> dict:
        with self._lock:
            if run_id is not None and run_id != self.run_id:
                raise LookupError("run_id mismatch")
            if cursor < 0 or cursor > self.processed:
                raise ValueError(f"cursor {cursor} is outside 0..{self.processed}")
            chunk = self._events[cursor : cursor + limit]
            out = []
            for e in chunk:
                d = {k: v for k, v in e.items() if not k.startswith("_")}
                d["known_outcome"] = (
                    ("fraud" if self._labels[e["_index"]] == 1 else "legitimate") if reveal_outcome else None
                )
                out.append(d)
            next_cursor = cursor + len(chunk)
            return {
                "events": out,
                "next_cursor": next_cursor,
                "has_more": next_cursor < self.processed,
                "run_id": self.run_id,
                "status": self.status,
            }

    def retrospective(self) -> dict:
        """Action x known-outcome table for events processed so far (reveals held-out labels)."""
        with self._lock:
            table = {a: {"fraud": 0, "legitimate": 0} for a in ("allow", "review", "hold")}
            for e in self._events:
                table[e["action"]]["fraud" if self._labels[e["_index"]] == 1 else "legitimate"] += 1
            fraud = sum(v["fraud"] for v in table.values())
            return {
                "scope": "replay_retrospective",
                "note": "Uses held-out dataset labels revealed after the fact. Flagged fraud is not verified prevention or recovery.",
                "processed": self.processed,
                "known_fraud_processed": fraud,
                "action_by_known_outcome": table,
            }

    def action_counts(self) -> dict:
        with self._lock:
            c = {"allow": 0, "review": 0, "hold": 0}
            r = {"low": 0, "medium": 0, "high": 0}
            for e in self._events:
                c[e["action"]] += 1
                r[e["risk_band"]] += 1
            return {"by_action": c, "by_risk_band": r}
