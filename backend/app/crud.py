from datetime import datetime
from uuid import uuid4

from sqlalchemy import delete, select

from .db import get_session_factory
from .models import SupplierCategoryLinkModel, SupplierModel
from .schemas import SupplierCreate, SupplierRead, SupplierUpdate, normalize_phone_e164, normalize_phone_number, normalize_rif_value

_memory_suppliers: dict[str, SupplierRead] = {}


def _generate_supplier_id() -> str:
    return f"supplier_{uuid4()}"


def _normalize_category_ids(values: list[str] | None) -> list[str]:
    if not values:
        return []
    deduped: list[str] = []
    seen: set[str] = set()
    for raw in values:
        category_id = str(raw).strip()
        if not category_id or category_id in seen:
            continue
        seen.add(category_id)
        deduped.append(category_id)
    return deduped


def _replace_supplier_category_links(session, supplier_id: str, category_ids: list[str]) -> None:
    session.execute(delete(SupplierCategoryLinkModel).where(SupplierCategoryLinkModel.supplier_id == supplier_id))
    for category_id in category_ids:
        session.add(
            SupplierCategoryLinkModel(
                supplier_id=supplier_id,
                category_id=category_id,
                created_at=datetime.utcnow(),
            )
        )


def _to_supplier_read(model: SupplierModel, category_ids: list[str] | None = None) -> SupplierRead:
    resolved_category_ids = _normalize_category_ids(category_ids if category_ids is not None else model.category_ids)
    phone_country_code = model.phone_country_code or "+58"
    phone_number = normalize_phone_number(model.phone_number or model.phone or "")
    phone_e164 = normalize_phone_e164(phone_country_code, phone_number, model.phone_e164)

    return SupplierRead(
        id=model.id,
        name=model.name,
        rif=normalize_rif_value(model.rif or model.rfc or ""),
        email=(model.email or "").strip(),
        phoneCountryCode=phone_country_code,
        phoneNumber=phone_number,
        phoneE164=phone_e164,
        categoryIds=resolved_category_ids,
        responsible=model.responsible,
        isActive=bool(model.is_active),
        creditDays=model.credit_days,
        balance=model.balance,
        createdAt=model.created_at,
    )


def list_suppliers() -> list[SupplierRead]:
    session_factory = get_session_factory()
    if session_factory is None:
        return sorted(_memory_suppliers.values(), key=lambda item: item.createdAt, reverse=True)

    with session_factory() as session:
        records = session.execute(select(SupplierModel).order_by(SupplierModel.created_at.desc())).scalars().all()
        link_rows = session.execute(
            select(SupplierCategoryLinkModel.supplier_id, SupplierCategoryLinkModel.category_id)
        ).all()
        categories_by_supplier: dict[str, list[str]] = {}
        for supplier_id, category_id in link_rows:
            categories_by_supplier.setdefault(supplier_id, []).append(str(category_id))
        return [_to_supplier_read(item, categories_by_supplier.get(item.id)) for item in records]


def get_supplier_by_id(supplier_id: str) -> SupplierRead | None:
    session_factory = get_session_factory()
    if session_factory is None:
        return _memory_suppliers.get(supplier_id)

    with session_factory() as session:
        supplier = session.get(SupplierModel, supplier_id)
        if supplier is None:
            return None
        category_ids = session.execute(
            select(SupplierCategoryLinkModel.category_id).where(SupplierCategoryLinkModel.supplier_id == supplier_id)
        ).scalars().all()
        return _to_supplier_read(supplier, [str(item) for item in category_ids])


def create_supplier(payload: SupplierCreate) -> SupplierRead:
    now = datetime.utcnow()
    session_factory = get_session_factory()
    category_ids = _normalize_category_ids(payload.categoryIds)

    if session_factory is None:
        supplier = SupplierRead(
            id=_generate_supplier_id(),
            name=payload.name,
            rif=payload.rif,
            email=(payload.email or "").strip(),
            phoneCountryCode=payload.phoneCountryCode,
            phoneNumber=payload.phoneNumber,
            phoneE164=payload.phoneE164,
            categoryIds=category_ids,
            responsible=payload.responsible,
            isActive=payload.isActive,
            creditDays=payload.creditDays,
            balance=payload.balance,
            createdAt=now,
        )
        _memory_suppliers[supplier.id] = supplier
        return supplier

    with session_factory() as session:
        supplier = SupplierModel(
            id=_generate_supplier_id(),
            name=payload.name,
            rfc=payload.rif,
            rif=payload.rif,
            email=(payload.email or "").strip(),
            phone=f"{payload.phoneCountryCode} {payload.phoneNumber}",
            phone_country_code=payload.phoneCountryCode,
            phone_number=payload.phoneNumber,
            phone_e164=payload.phoneE164,
            category_ids=category_ids,
            responsible=payload.responsible,
            status="active" if payload.isActive else "inactive",
            is_active=payload.isActive,
            credit_days=payload.creditDays,
            balance=payload.balance,
            created_at=now,
        )
        session.add(supplier)
        session.flush()
        _replace_supplier_category_links(session, supplier.id, category_ids)
        session.commit()
        session.refresh(supplier)
        return _to_supplier_read(supplier, category_ids)


def update_supplier(supplier_id: str, payload: SupplierUpdate) -> SupplierRead | None:
    updates = payload.model_dump(exclude_unset=True)
    if "categoryIds" in updates:
        updates["categoryIds"] = _normalize_category_ids(updates["categoryIds"])
    session_factory = get_session_factory()

    if session_factory is None:
        current = _memory_suppliers.get(supplier_id)
        if current is None:
            return None
        next_data = current.model_dump()
        next_data.update(updates)
        updated = SupplierRead(**next_data)
        _memory_suppliers[supplier_id] = updated
        return updated

    with session_factory() as session:
        supplier = session.get(SupplierModel, supplier_id)
        if supplier is None:
            return None

        if "name" in updates:
            supplier.name = updates["name"]
        if "rif" in updates:
            supplier.rif = normalize_rif_value(updates["rif"])
            supplier.rfc = supplier.rif
        if "email" in updates:
            supplier.email = (updates["email"] or "").strip()
        if "phoneCountryCode" in updates:
            supplier.phone_country_code = updates["phoneCountryCode"]
        if "phoneNumber" in updates:
            supplier.phone_number = normalize_phone_number(updates["phoneNumber"])
        if "phoneE164" in updates:
            supplier.phone_e164 = updates["phoneE164"]

        supplier.phone = f"{supplier.phone_country_code or '+58'} {supplier.phone_number or ''}".strip()

        if "responsible" in updates:
            supplier.responsible = updates["responsible"]
        if "isActive" in updates:
            supplier.is_active = bool(updates["isActive"])
            supplier.status = "active" if supplier.is_active else "inactive"
        if "creditDays" in updates:
            supplier.credit_days = updates["creditDays"]
        if "balance" in updates:
            supplier.balance = updates["balance"]

        if "categoryIds" in updates:
            supplier.category_ids = updates["categoryIds"]
            _replace_supplier_category_links(session, supplier_id, updates["categoryIds"])

        session.commit()
        session.refresh(supplier)
        category_ids = session.execute(
            select(SupplierCategoryLinkModel.category_id).where(SupplierCategoryLinkModel.supplier_id == supplier_id)
        ).scalars().all()
        return _to_supplier_read(supplier, [str(item) for item in category_ids])


def delete_supplier(supplier_id: str) -> bool:
    session_factory = get_session_factory()

    if session_factory is None:
        return _memory_suppliers.pop(supplier_id, None) is not None

    with session_factory() as session:
        supplier = session.get(SupplierModel, supplier_id)
        if supplier is None:
            return False
        session.execute(delete(SupplierCategoryLinkModel).where(SupplierCategoryLinkModel.supplier_id == supplier_id))
        session.delete(supplier)
        session.commit()
        return True
