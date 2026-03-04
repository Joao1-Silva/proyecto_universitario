from __future__ import annotations

import csv
import io
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..audit import log_audit_event
from ..models import PriceListItemModel, PriceListModel, ProductModel
from ..schemas import PriceListCreate, PriceListItemCreate, PriceListItemUpdate, PriceListUpdate
from ..security import AuthenticatedUser, Permission, get_db, require_permissions

router = APIRouter(prefix="/price-lists", tags=["price-lists"])


class PriceListCsvImportRequest(BaseModel):
    csvContent: str
    name: str = "Lista importada CSV"
    validFrom: datetime | str
    supplierId: str | None = None
    currency: str = "USD"


def _parse_datetime_input(raw: datetime | str, field_name: str) -> datetime:
    if isinstance(raw, datetime):
        return raw.replace(tzinfo=None)
    value = str(raw).strip()
    if not value:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{field_name} is required.")
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    return parsed


def _normalize_usd_currency(value: str | None) -> str:
    normalized = (value or "").strip().upper() or "USD"
    if normalized != "USD":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La moneda admitida es USD.",
        )
    return "USD"


def _serialize_price_list(model: PriceListModel, item_count: int | None = None) -> dict:
    payload = {
        "id": model.id,
        "name": model.name,
        "validFrom": model.valid_from,
        "validTo": model.valid_to,
        "supplierId": model.supplier_id,
        "currency": model.currency,
        "isActive": bool(model.is_active),
        "createdBy": model.created_by,
        "createdAt": model.created_at,
        "updatedAt": model.updated_at,
    }
    if item_count is not None:
        payload["itemCount"] = item_count
    return payload


def _serialize_price_list_item(model: PriceListItemModel) -> dict:
    return {
        "id": model.id,
        "priceListId": model.price_list_id,
        "productId": model.product_id,
        "unit": model.unit,
        "price": float(model.price),
        "createdAt": model.created_at,
        "updatedAt": model.updated_at,
    }


@router.get("")
def list_price_lists(
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.PRICE_LIST_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    lists = session.execute(select(PriceListModel).order_by(PriceListModel.created_at.desc())).scalars().all()

    counts = session.execute(
        select(PriceListItemModel.price_list_id, func.count())
        .group_by(PriceListItemModel.price_list_id)
    ).all()
    count_by_id = {str(row[0]): int(row[1]) for row in counts}

    return {
        "data": [_serialize_price_list(item, count_by_id.get(item.id, 0)) for item in lists],
        "meta": {"source": "api"},
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_price_list(
    payload: PriceListCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.PRICE_LIST_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    model = PriceListModel(
        id=f"plist_{uuid4()}",
        name=payload.name.strip(),
        valid_from=_parse_datetime_input(payload.validFrom, "validFrom"),
        valid_to=_parse_datetime_input(payload.validTo, "validTo") if payload.validTo else None,
        supplier_id=payload.supplierId,
        currency=_normalize_usd_currency(payload.currency),
        is_active=bool(payload.isActive),
        created_by=current_user.id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(model)

    log_audit_event(
        session,
        action="price_list_create",
        entity_type="price_list",
        entity_id=model.id,
        metadata={"name": model.name},
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(model)
    return {"data": _serialize_price_list(model), "meta": {"source": "api"}}


@router.put("/{price_list_id}")
def update_price_list(
    price_list_id: str,
    payload: PriceListUpdate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.PRICE_LIST_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    model = session.get(PriceListModel, price_list_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Price list not found.")

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates:
        model.name = str(updates["name"]).strip()
    if "validFrom" in updates and updates["validFrom"] is not None:
        model.valid_from = _parse_datetime_input(updates["validFrom"], "validFrom")
    if "validTo" in updates:
        model.valid_to = _parse_datetime_input(updates["validTo"], "validTo") if updates["validTo"] else None
    if "supplierId" in updates:
        model.supplier_id = updates["supplierId"]
    if "currency" in updates:
        model.currency = _normalize_usd_currency(str(updates["currency"]))
    if "isActive" in updates:
        model.is_active = bool(updates["isActive"])
    model.updated_at = datetime.utcnow()

    log_audit_event(
        session,
        action="price_list_update",
        entity_type="price_list",
        entity_id=model.id,
        metadata=updates,
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(model)
    return {"data": _serialize_price_list(model), "meta": {"source": "api"}}


@router.get("/{price_list_id}/items")
def list_price_list_items(
    price_list_id: str,
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.PRICE_LIST_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    model = session.get(PriceListModel, price_list_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Price list not found.")

    items = session.execute(
        select(PriceListItemModel)
        .where(PriceListItemModel.price_list_id == price_list_id)
        .order_by(PriceListItemModel.created_at.desc())
    ).scalars().all()
    return {"data": [_serialize_price_list_item(item) for item in items], "meta": {"source": "api"}}


@router.post("/{price_list_id}/items", status_code=status.HTTP_201_CREATED)
def create_price_list_item(
    price_list_id: str,
    payload: PriceListItemCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.PRICE_LIST_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    model = session.get(PriceListModel, price_list_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Price list not found.")

    product = session.get(ProductModel, payload.productId)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found.")

    item = session.execute(
        select(PriceListItemModel).where(
            PriceListItemModel.price_list_id == price_list_id,
            PriceListItemModel.product_id == payload.productId,
        )
    ).scalar_one_or_none()

    now = datetime.utcnow()
    if item is None:
        item = PriceListItemModel(
            id=f"plitem_{uuid4()}",
            price_list_id=price_list_id,
            product_id=payload.productId,
            unit=payload.unit.strip(),
            price=round(float(payload.price), 2),
            created_at=now,
            updated_at=now,
        )
        session.add(item)
        action = "price_list_item_create"
    else:
        item.unit = payload.unit.strip()
        item.price = round(float(payload.price), 2)
        item.updated_at = now
        action = "price_list_item_update"

    log_audit_event(
        session,
        action=action,
        entity_type="price_list_item",
        entity_id=item.id,
        metadata={"priceListId": price_list_id, "productId": payload.productId, "price": item.price},
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(item)
    return {"data": _serialize_price_list_item(item), "meta": {"source": "api"}}


@router.put("/{price_list_id}/items/{item_id}")
def update_price_list_item(
    price_list_id: str,
    item_id: str,
    payload: PriceListItemUpdate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.PRICE_LIST_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    item = session.execute(
        select(PriceListItemModel).where(
            PriceListItemModel.id == item_id,
            PriceListItemModel.price_list_id == price_list_id,
        )
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Price list item not found.")

    updates = payload.model_dump(exclude_unset=True)
    if "unit" in updates:
        item.unit = str(updates["unit"]).strip()
    if "price" in updates:
        item.price = round(float(updates["price"]), 2)
    item.updated_at = datetime.utcnow()

    log_audit_event(
        session,
        action="price_list_item_update",
        entity_type="price_list_item",
        entity_id=item.id,
        metadata=updates,
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(item)
    return {"data": _serialize_price_list_item(item), "meta": {"source": "api"}}


@router.post("/import-csv")
def import_price_list_csv(
    payload: PriceListCsvImportRequest,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.PRICE_LIST_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    text_content = payload.csvContent.strip()
    if not text_content:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="CSV file is empty.")

    reader = csv.DictReader(io.StringIO(text_content))
    required = {"product_id", "product_name", "category_id", "unit", "price"}
    headers = {header.strip().lower() for header in (reader.fieldnames or [])}
    if not required.issubset(headers):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="CSV headers must include: product_id, product_name, category_id, unit, price",
        )

    price_list = PriceListModel(
        id=f"plist_{uuid4()}",
        name=payload.name.strip() or "Lista importada CSV",
        valid_from=_parse_datetime_input(payload.validFrom, "validFrom"),
        valid_to=None,
        supplier_id=payload.supplierId,
        currency=_normalize_usd_currency(payload.currency),
        is_active=True,
        created_by=current_user.id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(price_list)
    session.flush()

    imported = 0
    now = datetime.utcnow()

    for row in reader:
        product_id = str(row.get("product_id") or "").strip()
        product_name = str(row.get("product_name") or "").strip()
        category_id = str(row.get("category_id") or "").strip()
        unit = str(row.get("unit") or "").strip()
        price_raw = str(row.get("price") or "").strip()
        if not product_name or not category_id or not unit or not price_raw:
            continue

        try:
            price_value = round(float(price_raw), 2)
        except ValueError:
            continue
        if price_value < 0:
            continue

        if not product_id:
            normalized_name = product_name.lower().replace(" ", "_")
            product_id = f"prd_csv_{category_id}_{normalized_name}"[:64]

        product = session.get(ProductModel, product_id)
        if product is None:
            product = ProductModel(
                id=product_id,
                category_id=category_id,
                name=product_name,
                description=None,
                unit=unit,
                is_typical=True,
                is_active=True,
                created_by=current_user.id,
                created_at=now,
                updated_at=now,
            )
            session.add(product)

        item = PriceListItemModel(
            id=f"plitem_{uuid4()}",
            price_list_id=price_list.id,
            product_id=product.id,
            unit=unit,
            price=price_value,
            created_at=now,
            updated_at=now,
        )
        session.add(item)
        imported += 1

    log_audit_event(
        session,
        action="price_list_import_csv",
        entity_type="price_list",
        entity_id=price_list.id,
        metadata={"name": price_list.name, "itemsImported": imported},
        request=request,
        user=current_user,
    )
    session.commit()

    return {
        "data": {
            "priceList": _serialize_price_list(price_list, imported),
            "itemsImported": imported,
        },
        "meta": {"source": "api"},
    }
