"""FastAPI application factory.

    uvicorn app.main:app --port 8000
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings
from .constants import API_VERSION
from .errors import install_error_handlers
from .routers import auth, policies, simulation, system, transactions
from .services.state import AppState, load_state

log = logging.getLogger("finexa")


async def _ticker(app: FastAPI, interval: float) -> None:
    while True:
        await asyncio.sleep(interval)
        st: AppState = app.state.finexa
        if st.sim is None:
            continue
        try:
            await asyncio.to_thread(st.sim.tick)
        except Exception:  # keep the replay loop alive
            log.exception("simulation tick failed")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    logging.basicConfig(level=settings.log_level.upper())

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.finexa = await asyncio.to_thread(load_state, settings)
        st: AppState = app.state.finexa
        if st.ready:
            log.info("FINEXA ready: model %s, policy %s", st.model_version, st.policy.version)
        else:
            log.warning("FINEXA started NOT READY: %s", "; ".join(st.reasons))
        task = None
        if settings.sim_background_task:
            task = asyncio.create_task(_ticker(app, settings.sim_tick_seconds))
        try:
            yield
        finally:
            if task:
                task.cancel()

    app = FastAPI(
        title="FINEXA API",
        version=API_VERSION,
        description=(
            "Fraud detection and investigation backend for the anonymised credit-card dataset. "
            "Scores are uncalibrated model ranking scores; 'hold' is a simulated recommendation, not a payment block."
        ),
        lifespan=lifespan,
    )
    # Placeholder so /health works even if lifespan has not run (e.g. OpenAPI export).
    app.state.finexa = AppState(settings=settings, reasons=["not started"])
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Content-Type", "Accept", "X-CSRF-Token"],
        allow_credentials=True,  # session cookie; requires explicit (non-wildcard) origins in production
    )
    install_error_handlers(app)
    for r in (auth.router, system.router, transactions.router, simulation.router, policies.router):
        app.include_router(r, prefix="/api/v1")
    return app


app = create_app()
