"""Test fixtures. A small synthetic dataset with the real schema is trained once per session,
so tests never depend on the real (git-ignored) data or artifacts."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("FINEXA_AUTH_REQUIRED", "false")  # auth has its own tests (test_auth.py)

from app.config import Settings  # noqa: E402
from app.constants import EXPECTED_COLUMNS, V_COLUMNS  # noqa: E402
from app.main import create_app  # noqa: E402
from app.ml.train import run_training  # noqa: E402


def make_synthetic(n: int = 6000, fraud_rate: float = 0.015, seed: int = 7, dup_pairs: int = 15) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    y = (rng.random(n) < fraud_rate).astype(int)
    X = rng.normal(size=(n, 28))
    X[y == 1, 2] -= 3.0
    X[y == 1, 9] -= 2.5
    X[y == 1, 13] -= 3.5
    df = pd.DataFrame(X, columns=V_COLUMNS)
    df.insert(0, "Time", np.sort(rng.uniform(0, 172_800, n)).round(0))
    df["Amount"] = np.round(rng.lognormal(3.0, 1.2, n), 2)
    df["Class"] = y
    dup = df.sample(dup_pairs, random_state=1)  # exact duplicate records appended at the end
    conflict = dup.iloc[[0]].copy()
    conflict["Class"] = 1 - conflict["Class"]  # same features, opposite label
    return pd.concat([df, dup, conflict], ignore_index=True)[EXPECTED_COLUMNS]


@pytest.fixture(scope="session")
def synthetic_df() -> pd.DataFrame:
    return make_synthetic()


@pytest.fixture(scope="session")
def trained(tmp_path_factory, synthetic_df):
    root = tmp_path_factory.mktemp("trained")
    csv = root / "creditcard.csv"
    synthetic_df.to_csv(csv, index=False)
    art = root / "artifacts"
    meta = run_training(csv, art, seed=42, importance_repeats=1, kmeans_k=4, log=lambda *_: None)
    return {"csv": csv, "artifacts": art, "meta": meta, "df": synthetic_df}


@pytest.fixture()
def settings(trained, tmp_path) -> Settings:
    return Settings(
        data_path=trained["csv"],
        artifacts_dir=trained["artifacts"],
        database_path=tmp_path / "test.sqlite3",
        sim_background_task=False,
        cors_origins=["http://localhost:3000"],
    )


@pytest.fixture()
def client(settings):
    with TestClient(create_app(settings)) as c:
        yield c


@pytest.fixture()
def state(client):
    return client.app.state.finexa


API = "/api/v1"
