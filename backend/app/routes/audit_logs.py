from __future__ import annotations

from datetime import date, datetime, time

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import AuditLogModel
from ..security import AuthenticatedUser, Permission, get_db, require_permissions

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])


def _serialize_log(model: AuditLogModel) -> dict:
    return {
        "id": model.id,
        "userId": model.user_id,
        "userName": model.user_name,
        "role": model.role,
        "action": model.action,
        "entity": model.entity,
        "entityId": model.entity_id,
        "changes": model.changes or {},
        "timestamp": model.timestamp,
        "ipAddress": model.ip_address,
    }


@router.get("")
def list_audit_logs(
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=20, ge=1, le=200),
    userId: str | None = Query(default=None),
    userName: str | None = Query(default=None),
    action: str | None = Query(default=None),
    entity: str | None = Query(default=None),
    startDate: date | None = Query(default=None),
    endDate: date | None = Query(default=None),
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.AUDIT_VIEW)),
    session: Session = Depends(get_db),
) -> dict:
    query = select(AuditLogModel)
    if userId:
        query = query.where(AuditLogModel.user_id == userId.strip())
    if userName:
        lowered = f"%{userName.strip().lower()}%"
        query = query.where(func.lower(AuditLogModel.user_name).like(lowered))
    if action:
        query = query.where(func.lower(AuditLogModel.action) == action.strip().lower())
    if entity:
        query = query.where(func.lower(AuditLogModel.entity) == entity.strip().lower())
    if startDate:
        query = query.where(AuditLogModel.timestamp >= datetime.combine(startDate, time.min))
    if endDate:
        query = query.where(AuditLogModel.timestamp <= datetime.combine(endDate, time.max))

    query = query.order_by(AuditLogModel.timestamp.desc())
    records = session.execute(query).scalars().all()
    total = len(records)
    start = (page - 1) * pageSize
    stop = start + pageSize
    paged = records[start:stop]

    return {
        "data": [_serialize_log(record) for record in paged],
        "pagination": {
            "page": page,
            "pageSize": pageSize,
            "total": total,
            "totalPages": max((total + pageSize - 1) // pageSize, 1),
        },
        "meta": {"source": "api"},
    }
