"""Runtime settings, read from FINEXA_* environment variables or backend/.env."""
from __future__ import annotations

from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FINEXA_", env_file=".env", extra="ignore")

    data_path: Path = ROOT / "data" / "raw" / "creditcard.csv"
    artifacts_dir: Path = ROOT / "artifacts"
    database_path: Path = ROOT / "data" / "finexa.sqlite3"

    # Comma-separated list (or "*"). Example: http://localhost:3000,http://localhost:5173
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]

    # Optional overrides of the thresholds saved with the model (validation-selected).
    review_threshold: float | None = Field(default=None, ge=0, le=1)
    hold_threshold: float | None = Field(default=None, ge=0, le=1)

    explanations_enabled: bool = True

    # Replay settings.
    sim_split: Literal["test", "validation", "holdout"] = "test"
    sim_base_events_per_second: float = Field(default=5.0, gt=0, le=1000)
    sim_background_task: bool = True
    sim_tick_seconds: float = Field(default=0.2, gt=0, le=5)

    # Authentication (session cookie + CSRF). auth_required=false is for automated tests only.
    auth_required: bool = True
    session_hours: float = Field(default=8.0, gt=0, le=720)
    cookie_secure: bool = False  # set true when served over HTTPS
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"

    log_level: str = "INFO"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v):
        if isinstance(v, str):
            s = v.strip()
            if s.startswith("["):
                import json

                return json.loads(s)
            return [o.strip() for o in s.split(",") if o.strip()]
        return v

    @model_validator(mode="after")
    def _both_thresholds_ordered(self):
        r, h = self.review_threshold, self.hold_threshold
        if r is not None and h is not None and not (0 <= r < h <= 1):
            raise ValueError("review_threshold must be < hold_threshold (0 <= review < hold <= 1)")
        return self
