from __future__ import annotations

import json
from datetime import datetime
from uuid import uuid4

from fastapi import Request
from sqlalchemy.orm import Session

from .models import AuditLogModel, MovementHistoryModel
from .security import AuthenticatedUser, normalize_role


def _to_serializable_metadata(value: object | None) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        candidate = value
    else:
        candidate = {"value": value}

    encoded = json.dumps(candidate, default=str)
    decoded = json.loads(encoded)
    return decoded if isinstance(decoded, dict) else {"value": decoded}


def resolve_request_ip(request: Request | None) -> str:
    if request is None:
        return "unknown"
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def log_audit_event(
    session: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    metadata: object | None = None,
    request: Request | None = None,
    user: AuthenticatedUser | None = None,
    user_id: str | None = None,
    user_name: str | None = None,
    role: str | None = None,
) -> AuditLogModel:
    resolved_user_id = user.id if user else (user_id or "system")
    resolved_user_name = user.name if user else (user_name or "Sistema")
    resolved_role = normalize_role(user.role if user else role or "system")

    normalized_action = action.strip().lower()
    normalized_entity = entity_type.strip().lower()

    log = AuditLogModel(
        id=f"audit_{uuid4()}",
        user_id=resolved_user_id,
        user_name=resolved_user_name,
        role=resolved_role,
        action=normalized_action,
        entity=normalized_entity,
        entity_id=entity_id.strip() or "unknown",
        changes=_to_serializable_metadata(metadata),
        timestamp=datetime.utcnow(),
        ip_address=resolve_request_ip(request),
    )
    session.add(log)

    session.add(
        MovementHistoryModel(
            id=f"mov_{uuid4()}",
            created_at=log.timestamp,
            user_id=resolved_user_id,
            user_name=resolved_user_name,
            role=resolved_role,
            event_type=normalized_action,
            action=normalized_action,
            entity_type=normalized_entity,
            entity_id=log.entity_id,
            detail_json=_to_serializable_metadata(metadata),
            result="OK",
            error_message=None,
        )
    )
    return log
