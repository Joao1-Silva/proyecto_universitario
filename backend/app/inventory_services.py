from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (
    DepartmentModel,
    InventoryItemModel,
    InventoryMovementModel,
    ProductModel,
    PurchaseOrderItemModel,
    PurchaseOrderModel,
)

DEFAULT_DEPARTMENTS: tuple[tuple[str, str], ...] = (
    ("dept_mantenimiento", "Mantenimiento"),
    ("dept_operaciones", "Operaciones"),
    ("dept_administracion", "Administracion"),
    ("dept_laborales", "Laborales"),
)

DEFAULT_DEPARTMENT_ORDER = {
    name.lower(): index for index, (_department_id, name) in enumerate(DEFAULT_DEPARTMENTS)
}


def ensure_default_departments(session: Session) -> list[DepartmentModel]:
    departments = session.execute(select(DepartmentModel)).scalars().all()
    departments_by_name = {department.name.strip().lower(): department for department in departments}
    now = datetime.utcnow()

    for department_id, department_name in DEFAULT_DEPARTMENTS:
        normalized_name = department_name.strip().lower()
        existing = departments_by_name.get(normalized_name)
        if existing is None:
            existing = DepartmentModel(
                id=department_id,
                name=department_name,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            session.add(existing)
            departments.append(existing)
            departments_by_name[normalized_name] = existing
            continue

        if not existing.is_active:
            existing.is_active = True
            existing.updated_at = now

    session.flush()
    return departments


def sort_departments_for_display(departments: list[DepartmentModel]) -> list[DepartmentModel]:
    fallback_order = len(DEFAULT_DEPARTMENT_ORDER)
    return sorted(
        departments,
        key=lambda department: (
            DEFAULT_DEPARTMENT_ORDER.get(department.name.strip().lower(), fallback_order),
            department.name.strip().lower(),
        ),
    )


def record_inventory_entry_for_purchase_order(
    session: Session,
    order: PurchaseOrderModel,
    *,
    created_by: str,
    reason: str,
) -> int:
    rows = session.execute(
        select(PurchaseOrderItemModel)
        .where(PurchaseOrderItemModel.purchase_order_id == order.id)
        .order_by(PurchaseOrderItemModel.created_at.asc())
    ).scalars().all()

    qty_by_product: dict[str, float] = {}
    for row in rows:
        if row.removed_by_superadmin or not row.product_id:
            continue
        qty_by_product[row.product_id] = round(qty_by_product.get(row.product_id, 0.0) + float(row.quantity), 2)

    applied = 0
    now = datetime.utcnow()

    for product_id, qty in qty_by_product.items():
        existing_movement = session.execute(
            select(InventoryMovementModel).where(
                InventoryMovementModel.type == "IN",
                InventoryMovementModel.purchase_order_id == order.id,
                InventoryMovementModel.product_id == product_id,
            )
        ).scalars().first()
        if existing_movement is not None:
            continue

        inventory_item = session.execute(
            select(InventoryItemModel).where(InventoryItemModel.product_id == product_id)
        ).scalar_one_or_none()
        if inventory_item is None:
            product = session.get(ProductModel, product_id)
            asset_type = "industrial" if product is None else (product.category_id or "industrial")
            inventory_item = InventoryItemModel(
                id=f"inv_{uuid4()}",
                product_id=product_id,
                stock=0,
                location="Almacen principal",
                asset_type=asset_type,
                updated_at=now,
            )
            session.add(inventory_item)
            session.flush()

        inventory_item.stock = float(inventory_item.stock) + qty
        inventory_item.updated_at = now

        session.add(
            InventoryMovementModel(
                id=f"invm_{uuid4()}",
                type="IN",
                product_id=product_id,
                qty=qty,
                department_id=None,
                reason=reason,
                purchase_order_id=order.id,
                created_by=created_by,
                created_at=now,
            )
        )
        applied += 1

    return applied
