from __future__ import annotations

import re
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..audit import log_audit_event
from ..models import SupplierCategoryLinkModel, SupplierModel
from ..schemas import (
    SupplierCreate,
    SupplierRead,
    SupplierUpdate,
    normalize_phone_e164,
    normalize_phone_number,
    validate_phone_e164,
)
from ..security import AuthenticatedUser, Permission, get_db, require_permissions

router = APIRouter(prefix="/suppliers", tags=["suppliers"])
_NON_DIGIT = re.compile(r"\D+")


def _normalize_category_ids(values: list[str] | tuple[str, ...] | set[str] | str | None) -> list[str]:
    if not values:
        return []
    if isinstance(values, str):
        values = [values]
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in values:
        category_id = str(raw).strip()
        if not category_id or category_id in seen:
            continue
        seen.add(category_id)
        normalized.append(category_id)
    return normalized


def _as_int(value: object | None, default: int = 0) -> int:
    try:
        return int(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _as_float(value: object | None, default: float = 0.0) -> float:
    try:
        return float(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _serialize_supplier(model: SupplierModel, category_ids: list[str] | None = None) -> SupplierRead:
    resolved_category_ids = _normalize_category_ids(category_ids if category_ids is not None else model.category_ids)
    phone_country_code = (model.phone_country_code or "+58").strip() or "+58"
    phone_number_digits = _NON_DIGIT.sub("", (model.phone_number or "").strip())

    phone_e164 = ""
    try:
        if model.phone_e164:
            phone_e164 = validate_phone_e164(
                normalize_phone_e164(phone_country_code, phone_number_digits, model.phone_e164)
            )
        elif phone_number_digits:
            phone_e164 = validate_phone_e164(normalize_phone_e164(phone_country_code, phone_number_digits))
    except ValueError:
        phone_e164 = ""

    if not phone_number_digits and phone_e164:
        all_digits = normalize_phone_number(phone_e164)
        country_digits = normalize_phone_number(phone_country_code)
        if all_digits.startswith(country_digits):
            phone_number_digits = all_digits[len(country_digits) :]
        else:
            phone_number_digits = all_digits

    return SupplierRead(
        id=model.id,
        name=model.name or "",
        rif=model.rif or "",
        email=(model.email or "").strip(),
        phoneCountryCode=phone_country_code,
        phoneNumber=phone_number_digits,
        phoneE164=phone_e164 or None,
        categoryIds=resolved_category_ids,
        responsible=model.responsible or "",
        isActive=bool(model.is_active),
        creditDays=_as_int(model.credit_days),
        balance=_as_float(model.balance),
        createdAt=model.created_at or datetime.utcnow(),
    )


def _supplier_links_available(session: Session) -> bool:
    cached = session.info.get("supplier_links_available")
    if isinstance(cached, bool):
        return cached

    try:
        session.execute(select(SupplierCategoryLinkModel.category_id).limit(1)).all()
        session.info["supplier_links_available"] = True
        return True
    except SQLAlchemyError:
        session.info["supplier_links_available"] = False
        return False


def _load_supplier_links(session: Session, supplier_id: str) -> list[str]:
    if not _supplier_links_available(session):
        return []
    try:
        rows = session.execute(
            select(SupplierCategoryLinkModel.category_id).where(SupplierCategoryLinkModel.supplier_id == supplier_id)
        ).scalars().all()
        return _normalize_category_ids([str(item) for item in rows])
    except SQLAlchemyError:
        # Compatibility guard for environments where supplier_category_links is unavailable.
        session.info["supplier_links_available"] = False
        return []


def _sync_supplier_links(session: Session, supplier_id: str, category_ids: list[str]) -> None:
    if not _supplier_links_available(session):
        return
    try:
        current = set(_load_supplier_links(session, supplier_id))
        desired = set(_normalize_category_ids(category_ids))

        to_remove = current - desired
        to_add = desired - current

        if to_remove:
            for category_id in to_remove:
                link = session.get(SupplierCategoryLinkModel, {"supplier_id": supplier_id, "category_id": category_id})
                if link is not None:
                    session.delete(link)

        for category_id in to_add:
            session.add(
                SupplierCategoryLinkModel(
                    supplier_id=supplier_id,
                    category_id=category_id,
                    created_at=datetime.utcnow(),
                )
            )
    except SQLAlchemyError:
        # Compatibility guard for environments where supplier_category_links is unavailable.
        session.info["supplier_links_available"] = False
        return


@router.get("")
def list_suppliers(
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.SUPPLIER_VIEW)),
    session: Session = Depends(get_db),
) -> dict:
    suppliers = session.execute(select(SupplierModel).order_by(SupplierModel.created_at.desc())).scalars().all()
    data = []
    for supplier in suppliers:
        linked_categories = _load_supplier_links(session, supplier.id)
        category_ids = linked_categories if linked_categories else _normalize_category_ids(supplier.category_ids)
        data.append(_serialize_supplier(supplier, category_ids))
    return {"data": data, "meta": {"source": "api"}}


@router.get("/{supplier_id}")
def get_supplier(
    supplier_id: str,
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.SUPPLIER_VIEW)),
    session: Session = Depends(get_db),
) -> dict:
    supplier = session.get(SupplierModel, supplier_id)
    if supplier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proveedor no encontrado.")

    linked_categories = _load_supplier_links(session, supplier_id)
    payload = _serialize_supplier(supplier, linked_categories if linked_categories else supplier.category_ids)
    return {"data": payload, "meta": {"source": "api"}}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_supplier(
    payload: SupplierCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.SUPPLIER_CREATE)),
    session: Session = Depends(get_db),
) -> dict:
    next_email = payload.email.strip().lower() if payload.email else ""
    if next_email:
        existing_email = session.execute(
            select(SupplierModel).where(func.lower(SupplierModel.email) == next_email)
        ).scalar_one_or_none()
        if existing_email is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El email ya existe.")

    existing_rif = session.execute(
        select(SupplierModel).where(func.lower(SupplierModel.rif) == payload.rif.strip().lower())
    ).scalar_one_or_none()
    if existing_rif is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El RIF ya existe.")

    category_ids = _normalize_category_ids(payload.categoryIds)
    model = SupplierModel(
        id=f"supplier_{uuid4()}",
        name=payload.name.strip(),
        rfc=payload.rif,
        rif=payload.rif,
        email=next_email,
        phone=f"{payload.phoneCountryCode} {payload.phoneNumber}".strip(),
        phone_country_code=payload.phoneCountryCode,
        phone_number=payload.phoneNumber,
        phone_e164=payload.phoneE164,
        category_ids=category_ids,
        responsible=payload.responsible.strip(),
        status="active" if payload.isActive else "inactive",
        is_active=bool(payload.isActive),
        credit_days=int(payload.creditDays),
        balance=float(payload.balance),
        created_at=datetime.utcnow(),
    )
    session.add(model)
    session.flush()

    _sync_supplier_links(session, model.id, category_ids)

    log_audit_event(
        session,
        action="supplier_create",
        entity_type="supplier",
        entity_id=model.id,
        metadata={"name": model.name, "rif": model.rif, "isActive": model.is_active},
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(model)
    return {"data": _serialize_supplier(model, category_ids), "meta": {"source": "api"}}


@router.put("/{supplier_id}")
def update_supplier(
    supplier_id: str,
    payload: SupplierUpdate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.SUPPLIER_UPDATE)),
    session: Session = Depends(get_db),
) -> dict:
    supplier = session.get(SupplierModel, supplier_id)
    if supplier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proveedor no encontrado.")

    updates = payload.model_dump(exclude_unset=True)

    if "email" in updates:
        next_email = str(updates["email"] or "").strip().lower()
        if next_email:
            existing = session.execute(
                select(SupplierModel).where(func.lower(SupplierModel.email) == next_email)
            ).scalar_one_or_none()
            if existing is not None and existing.id != supplier_id:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El email ya existe.")
        supplier.email = next_email

    if "rif" in updates:
        next_rif = str(updates["rif"]).strip().upper()
        existing = session.execute(
            select(SupplierModel).where(func.lower(SupplierModel.rif) == next_rif.lower())
        ).scalar_one_or_none()
        if existing is not None and existing.id != supplier_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="El RIF ya existe.")
        supplier.rif = next_rif
        supplier.rfc = next_rif

    if "name" in updates:
        supplier.name = str(updates["name"]).strip()
    if "phoneCountryCode" in updates:
        value = updates["phoneCountryCode"]
        supplier.phone_country_code = str(value).strip() if value is not None else None
    if "phoneNumber" in updates:
        value = updates["phoneNumber"]
        supplier.phone_number = normalize_phone_number(str(value).strip()) if value is not None else None
    if "phoneE164" in updates:
        value = updates["phoneE164"]
        candidate = str(value).strip() if value is not None else ""
        supplier.phone_e164 = validate_phone_e164(candidate) if candidate else None

    if "phoneCountryCode" in updates or "phoneNumber" in updates or "phoneE164" in updates:
        country_code = (supplier.phone_country_code or "+58").strip()
        phone_number = normalize_phone_number(supplier.phone_number or "")
        normalized_e164 = normalize_phone_e164(country_code, phone_number, supplier.phone_e164)
        if normalized_e164:
            supplier.phone_e164 = validate_phone_e164(normalized_e164)
            supplier.phone = supplier.phone_e164
        else:
            supplier.phone_e164 = None
            supplier.phone = ""

    if "responsible" in updates:
        supplier.responsible = str(updates["responsible"]).strip()
    if "creditDays" in updates:
        supplier.credit_days = int(updates["creditDays"])
    if "balance" in updates:
        supplier.balance = float(updates["balance"])
    if "isActive" in updates:
        supplier.is_active = bool(updates["isActive"])
        supplier.status = "active" if supplier.is_active else "inactive"

    final_email = (supplier.email or "").strip()
    final_phone = (supplier.phone_e164 or "").strip()
    if not final_email and not final_phone:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Debes registrar al menos un medio de contacto: teléfono o email.",
        )

    category_ids = _normalize_category_ids(updates.get("categoryIds", supplier.category_ids))
    supplier.category_ids = category_ids
    _sync_supplier_links(session, supplier_id, category_ids)

    log_audit_event(
        session,
        action="supplier_update",
        entity_type="supplier",
        entity_id=supplier_id,
        metadata=updates,
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(supplier)
    return {"data": _serialize_supplier(supplier, category_ids), "meta": {"source": "api"}}


@router.post("/{supplier_id}/activate")
def activate_supplier(
    supplier_id: str,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.SUPPLIER_ACTIVATE)),
    session: Session = Depends(get_db),
) -> dict:
    supplier = session.get(SupplierModel, supplier_id)
    if supplier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proveedor no encontrado.")

    supplier.is_active = True
    supplier.status = "active"

    log_audit_event(
        session,
        action="supplier_activate",
        entity_type="supplier",
        entity_id=supplier_id,
        metadata={"isActive": True},
        request=request,
        user=current_user,
    )
    session.commit()
    return {"data": _serialize_supplier(supplier, _load_supplier_links(session, supplier_id)), "meta": {"source": "api"}}


@router.post("/{supplier_id}/deactivate")
def deactivate_supplier(
    supplier_id: str,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.SUPPLIER_ACTIVATE)),
    session: Session = Depends(get_db),
) -> dict:
    supplier = session.get(SupplierModel, supplier_id)
    if supplier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proveedor no encontrado.")

    supplier.is_active = False
    supplier.status = "inactive"

    log_audit_event(
        session,
        action="supplier_deactivate",
        entity_type="supplier",
        entity_id=supplier_id,
        metadata={"isActive": False},
        request=request,
        user=current_user,
    )
    session.commit()
    return {"data": _serialize_supplier(supplier, _load_supplier_links(session, supplier_id)), "meta": {"source": "api"}}


@router.delete("/{supplier_id}")
def delete_supplier(
    supplier_id: str,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.SUPPLIER_ACTIVATE)),
    session: Session = Depends(get_db),
) -> dict:
    supplier = session.get(SupplierModel, supplier_id)
    if supplier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proveedor no encontrado.")

    supplier.is_active = False
    supplier.status = "inactive"
    log_audit_event(
        session,
        action="supplier_soft_delete",
        entity_type="supplier",
        entity_id=supplier_id,
        metadata={"isActive": False},
        request=request,
        user=current_user,
    )
    session.commit()
    return {"ok": True, "id": supplier_id}
