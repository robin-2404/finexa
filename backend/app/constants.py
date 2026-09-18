"""Shared constants: dataset schema, identifiers, and enumerations."""
from __future__ import annotations

import re

API_VERSION = "1.0.0"
POLICY_FAMILY = "policy-v1"

V_COLUMNS = [f"V{i}" for i in range(1, 29)]
FEATURE_COLUMNS = ["Time", *V_COLUMNS, "Amount"]  # the 30 model inputs, in model order
TARGET = "Class"
EXPECTED_COLUMNS = [*FEATURE_COLUMNS, TARGET]

# Columns that must never reach the model.
NON_FEATURE_COLUMNS = [TARGET, "transaction_ref", "row_position"]

# Time is dataset-relative; it is left out of similarity/clustering so that
# "similar" means similar in the anonymous features and amount, not in time.
SIMILARITY_EXCLUDED = ("Time",)

SPLITS = ("train", "validation", "test")

TXN_REF_RE = re.compile(r"^TXN-(\d{6,})$")


def make_ref(row_position: int) -> str:
    """Stable transaction reference derived from the 0-based source row position."""
    return f"TXN-{row_position:06d}"


def parse_ref(ref: str) -> int | None:
    m = TXN_REF_RE.match(ref)
    return int(m.group(1)) if m else None


def time_label(seconds: float) -> str:
    """Render dataset-relative seconds as T+HH:MM:SS (not a clock time)."""
    s = int(seconds)
    return f"T+{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"
