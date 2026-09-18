"""Historical replay controls and polling."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import schemas as S
from ..errors import ApiError
from ..services.simulation import TransitionError
from ..services.state import AppState
from .common import require_ready

router = APIRouter()
ERR = {503: {"model": S.ErrorResponse}, 409: {"model": S.ErrorResponse}, 422: {"model": S.ErrorResponse}}


def _state(st: AppState, reveal: bool) -> S.SimulationState:
    snap = st.sim.snapshot()
    return S.SimulationState(
        replay_split=st.settings.sim_split, **snap, **st.sim.action_counts(),
        retrospective=st.sim.retrospective() if reveal else None,
    )


@router.get("/simulation", response_model=S.SimulationState, responses=ERR, tags=["simulation"], summary="Replay status and running totals")
def get_simulation(
    reveal_outcome: bool = Query(False, description="Add a retrospective action-by-outcome table (reveals held-out labels)."),
    st: AppState = Depends(require_ready),
):
    return _state(st, reveal_outcome)


@router.post("/simulation/control", response_model=S.SimulationState, responses=ERR, tags=["simulation"], summary="start | pause | resume | reset | set_speed")
def control(body: S.SimulationControl, st: AppState = Depends(require_ready)):
    """State machine: idle -start-> running <-pause/resume-> paused; running -> completed at the end;
    reset returns to idle (new run_id) from any state. Invalid transitions return 409."""
    sim = st.sim
    try:
        if body.action == S.SimAction.start:
            sim.start(body.speed)
        elif body.action == S.SimAction.pause:
            sim.pause()
        elif body.action == S.SimAction.resume:
            sim.resume(body.speed)
        elif body.action == S.SimAction.reset:
            sim.reset()
        else:
            sim.set_speed(body.speed)
    except TransitionError as exc:
        raise ApiError(409, "INVALID_STATE_TRANSITION", str(exc))
    except ValueError as exc:
        raise ApiError(422, "INVALID_SPEED", str(exc))
    return _state(st, False)


@router.get("/simulation/events", response_model=S.SimulationEvents, responses=ERR, tags=["simulation"], summary="Poll replay events after a cursor")
def get_events(
    cursor: int = Query(0, ge=0, description="`next_cursor` from the previous response (0 to start)."),
    limit: int = Query(100, ge=1, le=1000),
    run_id: str | None = Query(None, description="Pass the run_id you are following; a reset run yields 409 SIMULATION_RESET."),
    reveal_outcome: bool = Query(False, description="Retrospective view: include held-out labels."),
    st: AppState = Depends(require_ready),
):
    try:
        res = st.sim.events_after(cursor, limit, run_id, reveal_outcome)
    except LookupError:
        raise ApiError(409, "SIMULATION_RESET", "The simulation was reset; restart polling from cursor 0 with the new run_id.")
    except ValueError as exc:
        raise ApiError(422, "INVALID_CURSOR", str(exc))
    events = []
    for e in res["events"]:
        e = dict(e)
        e["recommended_action"] = e.pop("action")
        events.append(e)
    return S.SimulationEvents(**{**res, "events": events})
