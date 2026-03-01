from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Generator
from uuid import uuid4

import bcrypt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from .db import get_session_factory
from .models import UserModel


class Permission(str, Enum):
    SUPPLIER_VIEW = "SUPPLIER_VIEW"
    SUPPLIER_CREATE = "SUPPLIER_CREATE"
    SUPPLIER_UPDATE = "SUPPLIER_UPDATE"
    SUPPLIER_ACTIVATE = "SUPPLIER_ACTIVATE"
    SUPPLIER_DELETE = "SUPPLIER_DELETE"

    PURCHASE_ORDER_VIEW = "PURCHASE_ORDER_VIEW"
    PURCHASE_ORDER_CREATE = "PURCHASE_ORDER_CREATE"
    PURCHASE_ORDER_SUBMIT = "PURCHASE_ORDER_SUBMIT"
    PURCHASE_ORDER_APPROVE = "PURCHASE_ORDER_APPROVE"
    PURCHASE_ORDER_REJECT = "PURCHASE_ORDER_REJECT"
    PURCHASE_ORDER_CERTIFY = "PURCHASE_ORDER_CERTIFY"
    PURCHASE_ORDER_RECEIVE = "PURCHASE_ORDER_RECEIVE"
    PURCHASE_ORDER_REMOVE_ITEM = "PURCHASE_ORDER_REMOVE_ITEM"
    PURCHASE_ORDER_STATUS_UPDATE = "PURCHASE_ORDER_STATUS_UPDATE"

    CATEGORY_VIEW = "CATEGORY_VIEW"
    CATEGORY_CREATE = "CATEGORY_CREATE"
    PRODUCT_MANAGE = "PRODUCT_MANAGE"
    PRICE_LIST_MANAGE = "PRICE_LIST_MANAGE"

    INVENTORY_VIEW = "INVENTORY_VIEW"
    INVENTORY_MANAGE = "INVENTORY_MANAGE"

    FINANCE_VIEW = "FINANCE_VIEW"
    FINANCE_MANAGE = "FINANCE_MANAGE"

    MONITORING_VIEW = "MONITORING_VIEW"
    AUDIT_VIEW = "AUDIT_VIEW"

    USER_MANAGE = "USER_MANAGE"
    SETTINGS_MANAGE = "SETTINGS_MANAGE"
    REPORT_VIEW = "REPORT_VIEW"

    INVOICE_VIEW = "INVOICE_VIEW"
    INVOICE_CREATE = "INVOICE_CREATE"
    PAYMENT_VIEW = "PAYMENT_VIEW"
    PAYMENT_CREATE = "PAYMENT_CREATE"


ALL_PERMISSIONS = {permission.value for permission in Permission}

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "superadmin": set(ALL_PERMISSIONS),
    "finanzas": {
        Permission.PURCHASE_ORDER_VIEW.value,
        Permission.FINANCE_VIEW.value,
        Permission.FINANCE_MANAGE.value,
        Permission.MONITORING_VIEW.value,
        Permission.AUDIT_VIEW.value,
        Permission.REPORT_VIEW.value,
        Permission.SUPPLIER_VIEW.value,
        Permission.INVOICE_VIEW.value,
        Permission.INVOICE_CREATE.value,
        Permission.PAYMENT_VIEW.value,
        Permission.PAYMENT_CREATE.value,
    },
    "procura": {
        Permission.SUPPLIER_VIEW.value,
        Permission.SUPPLIER_CREATE.value,
        Permission.SUPPLIER_UPDATE.value,
        Permission.CATEGORY_VIEW.value,
        Permission.CATEGORY_CREATE.value,
        Permission.PRODUCT_MANAGE.value,
        Permission.PRICE_LIST_MANAGE.value,
        Permission.PURCHASE_ORDER_VIEW.value,
        Permission.PURCHASE_ORDER_CREATE.value,
        Permission.PURCHASE_ORDER_SUBMIT.value,
        Permission.PURCHASE_ORDER_STATUS_UPDATE.value,
        Permission.PURCHASE_ORDER_CERTIFY.value,
        Permission.PURCHASE_ORDER_RECEIVE.value,
        Permission.INVENTORY_VIEW.value,
        Permission.INVENTORY_MANAGE.value,
        Permission.MONITORING_VIEW.value,
        Permission.REPORT_VIEW.value,
    },
}


@dataclass
class AuthenticatedUser:
    id: str
    email: str
    name: str
    role: str


_issued_tokens: dict[str, str] = {}


ROLE_ALIASES = {
    "admin": "superadmin",
    "superadmin": "superadmin",
    "gerente": "superadmin",
    "finance": "finanzas",
    "finanzas": "finanzas",
    "administradora": "finanzas",
    "procura": "procura",
    "viewer": "procura",
    "compras": "procura",
}


def normalize_role(value: str | None) -> str:
    if not value:
        return "procura"
    lowered = value.strip().lower()
    return ROLE_ALIASES.get(lowered, "procura")


def has_permission(role: str | None, permission: Permission | str) -> bool:
    normalized_role = normalize_role(role)
    permission_value = permission.value if isinstance(permission, Permission) else str(permission)
    return permission_value in ROLE_PERMISSIONS.get(normalized_role, set())


def issue_token(user_id: str) -> str:
    token = f"dev_{uuid4()}"
    _issued_tokens[token] = user_id
    return token


def revoke_token(token: str | None) -> None:
    if token:
        _issued_tokens.pop(token, None)


def resolve_user_id_from_token(token: str | None) -> str | None:
    if not token:
        return None
    return _issued_tokens.get(token)


def extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    prefix = "bearer "
    if authorization.lower().startswith(prefix):
        return authorization[len(prefix) :].strip()
    return None


def is_password_hash(value: str | None) -> bool:
    if not value:
        return False
    return value.startswith("$2a$") or value.startswith("$2b$") or value.startswith("$2y$")


def hash_secret(raw_value: str) -> str:
    return bcrypt.hashpw(raw_value.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_secret(raw_value: str, stored_value: str) -> bool:
    if not stored_value:
        return False
    if is_password_hash(stored_value):
        try:
            return bcrypt.checkpw(raw_value.encode("utf-8"), stored_value.encode("utf-8"))
        except ValueError:
            return False
    return raw_value == stored_value


def get_db() -> Generator[Session, None, None]:
    session_factory = get_session_factory()
    if session_factory is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database session factory is unavailable.",
        )
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


def get_current_user(
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_db),
) -> AuthenticatedUser:
    token = extract_bearer_token(authorization)
    if token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token.")

    user_id = resolve_user_id_from_token(token)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")

    user = session.get(UserModel, user_id)
    if user is None:
        revoke_token(token)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")

    return AuthenticatedUser(
        id=user.id,
        email=user.email,
        name=user.name,
        role=normalize_role(user.role),
    )


def require_permissions(*required_permissions: Permission):
    normalized = [permission.value for permission in required_permissions]

    def dependency(current_user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
        missing = [permission for permission in normalized if not has_permission(current_user.role, permission)]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Missing: {', '.join(missing)}",
            )
        return current_user

    return dependency
