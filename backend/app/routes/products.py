from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..audit import log_audit_event
from ..models import ProductModel
from ..schemas import ProductCreate, ProductUpdate
from ..security import AuthenticatedUser, Permission, get_db, require_permissions

router = APIRouter(prefix="/products", tags=["products"])


def _serialize_product(model: ProductModel) -> dict:
    return {
        "id": model.id,
        "categoryId": model.category_id,
        "name": model.name,
        "description": model.description,
        "unit": model.unit,
        "isTypical": bool(model.is_typical),
        "isActive": bool(model.is_active),
        "createdAt": model.created_at,
        "createdBy": model.created_by,
    }


@router.get("")
def list_products(
    q: str | None = Query(default=None),
    categoryId: str | None = Query(default=None),
    onlyActive: bool = Query(default=False),
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.PRODUCT_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    query = select(ProductModel)
    if categoryId:
        query = query.where(ProductModel.category_id == categoryId.strip())
    if onlyActive:
        query = query.where(ProductModel.is_active.is_(True))

    records = session.execute(query.order_by(func.lower(ProductModel.name))).scalars().all()
    if q:
        term = q.strip().lower()
        records = [record for record in records if term in record.name.lower() or term in (record.description or "").lower()]

    return {"data": [_serialize_product(record) for record in records], "meta": {"source": "api"}}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.PRODUCT_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    existing = session.execute(
        select(ProductModel).where(
            ProductModel.category_id == payload.categoryId,
            func.lower(ProductModel.name) == payload.name.strip().lower(),
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Product already exists for this category.")

    model = ProductModel(
        id=f"prd_{uuid4()}",
        category_id=payload.categoryId,
        name=payload.name.strip(),
        description=payload.description,
        unit=payload.unit.strip(),
        is_typical=bool(payload.isTypical),
        is_active=bool(payload.isActive),
        created_by=current_user.id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(model)

    log_audit_event(
        session,
        action="product_create",
        entity_type="product",
        entity_id=model.id,
        metadata={"name": model.name, "categoryId": model.category_id},
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(model)
    return {"data": _serialize_product(model), "meta": {"source": "api"}}


@router.put("/{product_id}")
def update_product(
    product_id: str,
    payload: ProductUpdate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.PRODUCT_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    model = session.get(ProductModel, product_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found.")

    updates = payload.model_dump(exclude_unset=True)
    if "categoryId" in updates:
        model.category_id = str(updates["categoryId"]).strip()
    if "name" in updates:
        model.name = str(updates["name"]).strip()
    if "description" in updates:
        model.description = updates["description"]
    if "unit" in updates:
        model.unit = str(updates["unit"]).strip()
    if "isTypical" in updates:
        model.is_typical = bool(updates["isTypical"])
    if "isActive" in updates:
        model.is_active = bool(updates["isActive"])
    model.updated_at = datetime.utcnow()

    log_audit_event(
        session,
        action="product_update",
        entity_type="product",
        entity_id=model.id,
        metadata=updates,
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(model)
    return {"data": _serialize_product(model), "meta": {"source": "api"}}
