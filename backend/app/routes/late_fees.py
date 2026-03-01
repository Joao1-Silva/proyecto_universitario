from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..audit import log_audit_event
from ..db import get_session_factory
from ..models import LateFeeModel
from ..schemas import LateFeesRead, LateFeesUpdate
from ..security import AuthenticatedUser, Permission, require_permissions

router = APIRouter(tags=["late-fees"])


def _to_late_fees_read(model: LateFeeModel) -> LateFeesRead:
    return LateFeesRead(enabled=model.enabled, percentage=model.percentage, graceDays=model.grace_days)


def _get_session_factory():
    session_factory = get_session_factory()
    if session_factory is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database session factory is unavailable.",
        )
    return session_factory


def _ensure_late_fees(session) -> LateFeeModel:
    settings = session.get(LateFeeModel, "default")
    if settings is None:
        settings = LateFeeModel(id="default")
        session.add(settings)
        session.commit()
        session.refresh(settings)
    return settings


@router.get("/late-fees")
def get_late_fees(
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.SETTINGS_MANAGE)),
) -> dict:
    session_factory = _get_session_factory()
    with session_factory() as session:
        settings = _ensure_late_fees(session)
        return {"data": _to_late_fees_read(settings), "meta": {"source": "api"}}


@router.put("/late-fees")
def update_late_fees(
    payload: LateFeesUpdate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.SETTINGS_MANAGE)),
) -> dict:
    session_factory = _get_session_factory()
    with session_factory() as session:
        settings = _ensure_late_fees(session)
        settings.enabled = payload.enabled
        settings.percentage = payload.percentage
        settings.grace_days = payload.graceDays
        log_audit_event(
            session,
            action="late_fees_update",
            entity_type="settings",
            entity_id="late_fees",
            metadata=payload.model_dump(),
            request=request,
            user=current_user,
        )
        session.commit()
        session.refresh(settings)
        return {"data": _to_late_fees_read(settings), "meta": {"source": "api"}}
