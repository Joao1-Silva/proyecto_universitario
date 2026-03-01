from __future__ import annotations

from datetime import date, datetime, time

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import MovementHistoryModel
from ..security import AuthenticatedUser, Permission, get_db, require_permissions

router = APIRouter(prefix="/monitoring", tags=["monitoring"])


def _serialize_movement(model: MovementHistoryModel) -> dict:
    result = "OK" if str(model.result).strip().lower() == "ok" else "Error"
    return {
        "id": model.id,
        "createdAt": model.created_at,
        "userId": model.user_id,
        "userName": model.user_name,
        "role": model.role,
        "eventType": model.event_type,
        "action": model.action,
        "entityType": model.entity_type,
        "entityId": model.entity_id,
        "detail": model.detail_json or {},
        "result": result,
        "errorMessage": model.error_message,
    }


@router.get("/movements")
def list_movements(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    event_type: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    entity_id: str | None = Query(default=None),
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.MONITORING_VIEW)),
    session: Session = Depends(get_db),
) -> dict:
    query = select(MovementHistoryModel)

    if date_from:
        query = query.where(MovementHistoryModel.created_at >= datetime.combine(date_from, time.min))
    if date_to:
        query = query.where(MovementHistoryModel.created_at <= datetime.combine(date_to, time.max))
    if event_type:
        query = query.where(func.lower(MovementHistoryModel.event_type) == event_type.strip().lower())
    if user_id:
        query = query.where(MovementHistoryModel.user_id == user_id.strip())
    if entity_type:
        query = query.where(func.lower(MovementHistoryModel.entity_type) == entity_type.strip().lower())
    if entity_id:
        query = query.where(MovementHistoryModel.entity_id == entity_id.strip())

    query = query.order_by(MovementHistoryModel.created_at.desc())
    rows = session.execute(query).scalars().all()

    total = len(rows)
    start = (page - 1) * page_size
    stop = start + page_size
    page_rows = rows[start:stop]

    return {
        "data": [_serialize_movement(item) for item in page_rows],
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "total": total,
            "totalPages": max((total + page_size - 1) // page_size, 1),
        },
        "meta": {"source": "api"},
    }
