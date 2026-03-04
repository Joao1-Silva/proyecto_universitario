from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..audit import log_audit_event
from ..models import DepartmentModel, InventoryItemModel, InventoryMovementModel, ProductModel
from ..schemas import InventoryOutRequest
from ..security import AuthenticatedUser, Permission, get_db, require_permissions

router = APIRouter(tags=["inventory", "departments"])


class InventoryInRequest(BaseModel):
    productId: str
    qty: float
    reason: str | None = None
    purchaseOrderId: str | None = None


class DepartmentUpdateRequest(BaseModel):
    name: str | None = None
    isActive: bool | None = None


def _serialize_inventory_item(model: InventoryItemModel) -> dict:
    return {
        "id": model.id,
        "productId": model.product_id,
        "stock": float(model.stock),
        "location": model.location,
        "assetType": model.asset_type,
        "updatedAt": model.updated_at,
    }


def _serialize_inventory_movement(model: InventoryMovementModel) -> dict:
    return {
        "id": model.id,
        "type": model.type,
        "productId": model.product_id,
        "qty": float(model.qty),
        "departmentId": model.department_id,
        "reason": model.reason,
        "purchaseOrderId": model.purchase_order_id,
        "createdBy": model.created_by,
        "createdAt": model.created_at,
    }


def _serialize_department(model: DepartmentModel) -> dict:
    return {
        "id": model.id,
        "name": model.name,
        "isActive": bool(model.is_active),
        "createdAt": model.created_at,
        "updatedAt": model.updated_at,
    }


def _ensure_product_exists(session: Session, product_id: str) -> None:
    product = session.get(ProductModel, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found.")


def _get_or_create_inventory_item(session: Session, product_id: str) -> InventoryItemModel:
    inventory_item = session.execute(
        select(InventoryItemModel).where(InventoryItemModel.product_id == product_id)
    ).scalar_one_or_none()
    if inventory_item is not None:
        return inventory_item

    product = session.get(ProductModel, product_id)
    asset_type = product.category_id if product is not None else "industrial"
    inventory_item = InventoryItemModel(
        id=f"inv_{uuid4()}",
        product_id=product_id,
        stock=0,
        location="Almacén principal",
        asset_type=asset_type,
        updated_at=datetime.utcnow(),
    )
    session.add(inventory_item)
    session.flush()
    return inventory_item


@router.get("/inventory/items")
def list_inventory_items(
    q: str | None = Query(default=None),
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.INVENTORY_VIEW)),
    session: Session = Depends(get_db),
) -> dict:
    items = session.execute(select(InventoryItemModel).order_by(InventoryItemModel.updated_at.desc())).scalars().all()

    if q:
        term = q.strip().lower()
        product_ids = {
            product.id
            for product in session.execute(select(ProductModel)).scalars().all()
            if term in product.name.lower()
        }
        items = [item for item in items if term in item.product_id.lower() or item.product_id in product_ids]

    return {"data": [_serialize_inventory_item(item) for item in items], "meta": {"source": "api"}}


@router.get("/inventory/movements")
def list_inventory_movements(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    productId: str | None = Query(default=None),
    movementType: str | None = Query(default=None),
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.INVENTORY_VIEW)),
    session: Session = Depends(get_db),
) -> dict:
    query = select(InventoryMovementModel)
    if productId:
        query = query.where(InventoryMovementModel.product_id == productId.strip())
    if movementType:
        query = query.where(func.lower(InventoryMovementModel.type) == movementType.strip().lower())

    rows = session.execute(query.order_by(InventoryMovementModel.created_at.desc())).scalars().all()
    total = len(rows)
    start = (page - 1) * page_size
    stop = start + page_size
    page_rows = rows[start:stop]

    return {
        "data": [_serialize_inventory_movement(item) for item in page_rows],
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "total": total,
            "totalPages": max((total + page_size - 1) // page_size, 1),
        },
        "meta": {"source": "api"},
    }


@router.post("/inventory/movements/in", status_code=status.HTTP_201_CREATED)
def register_inventory_in(
    payload: InventoryInRequest,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.INVENTORY_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    if payload.qty <= 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="qty must be greater than zero.")

    _ensure_product_exists(session, payload.productId)
    inventory_item = _get_or_create_inventory_item(session, payload.productId)
    inventory_item.stock = float(inventory_item.stock) + float(payload.qty)
    inventory_item.updated_at = datetime.utcnow()

    movement = InventoryMovementModel(
        id=f"invm_{uuid4()}",
        type="IN",
        product_id=payload.productId,
        qty=float(payload.qty),
        department_id=None,
        reason=payload.reason,
        purchase_order_id=payload.purchaseOrderId,
        created_by=current_user.id,
        created_at=datetime.utcnow(),
    )
    session.add(movement)

    log_audit_event(
        session,
        action="inventory_in",
        entity_type="inventory",
        entity_id=movement.id,
        metadata={
            "productId": payload.productId,
            "qty": payload.qty,
            "purchaseOrderId": payload.purchaseOrderId,
            "stock": inventory_item.stock,
        },
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(movement)

    return {"data": _serialize_inventory_movement(movement), "meta": {"source": "api"}}


@router.post("/inventory/movements/out", status_code=status.HTTP_201_CREATED)
def register_inventory_out(
    payload: InventoryOutRequest,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.INVENTORY_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    if payload.qty <= 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="qty must be greater than zero.")

    _ensure_product_exists(session, payload.productId)
    department = session.get(DepartmentModel, payload.departmentId)
    if department is None or not department.is_active:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="departmentId is invalid or inactive.")

    inventory_item = _get_or_create_inventory_item(session, payload.productId)
    if float(inventory_item.stock) < float(payload.qty):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Insufficient stock.")

    inventory_item.stock = float(inventory_item.stock) - float(payload.qty)
    inventory_item.updated_at = datetime.utcnow()

    movement = InventoryMovementModel(
        id=f"invm_{uuid4()}",
        type="OUT",
        product_id=payload.productId,
        qty=float(payload.qty),
        department_id=payload.departmentId,
        reason=payload.reason,
        purchase_order_id=None,
        created_by=current_user.id,
        created_at=datetime.utcnow(),
    )
    session.add(movement)

    log_audit_event(
        session,
        action="inventory_out",
        entity_type="inventory",
        entity_id=movement.id,
        metadata={"productId": payload.productId, "qty": payload.qty, "departmentId": payload.departmentId, "stock": inventory_item.stock},
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(movement)

    return {"data": _serialize_inventory_movement(movement), "meta": {"source": "api"}}


@router.get("/departments")
def list_departments(
    only_active: bool = Query(default=False),
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.INVENTORY_VIEW)),
    session: Session = Depends(get_db),
) -> dict:
    query = select(DepartmentModel)
    if only_active:
        query = query.where(DepartmentModel.is_active.is_(True))
    departments = session.execute(query.order_by(func.lower(DepartmentModel.name))).scalars().all()
    return {"data": [_serialize_department(dep) for dep in departments], "meta": {"source": "api"}}


@router.post("/departments", status_code=status.HTTP_201_CREATED)
def create_department(
    payload: dict,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.INVENTORY_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="name is required.")

    existing = session.execute(select(DepartmentModel).where(func.lower(DepartmentModel.name) == name.lower())).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Department already exists.")

    is_active = bool(payload.get("isActive", True))
    model = DepartmentModel(
        id=f"dept_{uuid4()}",
        name=name,
        is_active=is_active,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(model)

    log_audit_event(
        session,
        action="department_create",
        entity_type="department",
        entity_id=model.id,
        metadata={"name": model.name, "isActive": model.is_active},
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(model)
    return {"data": _serialize_department(model), "meta": {"source": "api"}}


@router.put("/departments/{department_id}")
def update_department(
    department_id: str,
    payload: DepartmentUpdateRequest,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.INVENTORY_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    model = session.get(DepartmentModel, department_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found.")

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"] is not None:
        next_name = str(updates["name"]).strip()
        if not next_name:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="name cannot be empty.")
        existing = session.execute(
            select(DepartmentModel).where(func.lower(DepartmentModel.name) == next_name.lower())
        ).scalar_one_or_none()
        if existing is not None and existing.id != department_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Department already exists.")
        model.name = next_name

    if "isActive" in updates and updates["isActive"] is not None:
        model.is_active = bool(updates["isActive"])

    model.updated_at = datetime.utcnow()

    log_audit_event(
        session,
        action="department_update",
        entity_type="department",
        entity_id=model.id,
        metadata=updates,
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(model)
    return {"data": _serialize_department(model), "meta": {"source": "api"}}
