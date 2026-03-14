from __future__ import annotations

from datetime import date, datetime, time
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..audit import log_audit_event
from ..models import (
    InventoryItemModel,
    InventoryMovementModel,
    ProductModel,
    PurchaseOrderItemModel,
    PurchaseOrderModel,
    SupplierModel,
)
from ..schemas import (
    PurchaseOrderApproveRequest,
    PurchaseOrderCreate,
    PurchaseOrderRead,
    PurchaseOrderRejectRequest,
    PurchaseOrderRemoveItemRequest,
)
from ..security import AuthenticatedUser, Permission, get_db, require_permissions

router = APIRouter(prefix="/purchase-orders", tags=["purchase-orders"])

VAT_RATE = 0.16
ALLOWED_STATUSES = {"draft", "pending", "approved", "rejected", "certified", "received"}


def _normalize_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _parse_datetime_input(raw: datetime | date | str, field_name: str) -> datetime:
    if isinstance(raw, datetime):
        return raw.replace(tzinfo=None)
    if isinstance(raw, date):
        return datetime.combine(raw, time(hour=12, minute=0))
    if not isinstance(raw, str):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{field_name} has an invalid value.")

    value = raw.strip()
    if not value:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{field_name} is required.")

    if len(value) == 10:
        parsed_date = date.fromisoformat(value)
        return datetime.combine(parsed_date, time(hour=12, minute=0))

    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    return parsed


def _ensure_not_past(order_date: datetime) -> None:
    today = datetime.utcnow().date()
    if order_date.date() < today:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La fecha de la orden no puede ser anterior a la fecha actual.",
        )


def _next_order_number(session: Session, year: int) -> str:
    prefix = f"OC-{year}-"
    rows = session.execute(select(PurchaseOrderModel.order_number).where(PurchaseOrderModel.order_number.like(f"{prefix}%"))).scalars().all()
    sequence = 0
    for value in rows:
        suffix = str(value)[len(prefix) :]
        try:
            sequence = max(sequence, int(suffix))
        except ValueError:
            continue
    return f"{prefix}{str(sequence + 1).zfill(4)}"


def _normalize_item(raw: dict, index: int) -> dict:
    description = str(raw.get("description", "")).strip()
    if not description:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"items[{index}].description is required.",
        )

    try:
        quantity = float(raw.get("quantity", 0))
        unit_price = float(raw.get("unitPrice", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"items[{index}] has invalid numeric values.")

    if quantity <= 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"items[{index}].quantity must be greater than zero.")
    if unit_price < 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"items[{index}].unitPrice must be >= 0.")

    return {
        "id": str(raw.get("id") or f"poi_{uuid4()}"),
        "productId": _normalize_text(str(raw.get("productId") or "")),
        "description": description,
        "quantity": quantity,
        "unit": _normalize_text(str(raw.get("unit") or "")),
        "unitPrice": round(unit_price, 2),
        "total": round(quantity * unit_price, 2),
        "categoryId": _normalize_text(str(raw.get("categoryId") or "")),
        "removedBySuperadmin": False,
        "removedBySuperadminReason": None,
    }


def _normalize_items(items: list[dict]) -> list[dict]:
    if not items:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="At least one item is required.")
    return [_normalize_item(item, index) for index, item in enumerate(items)]


def _calculate_totals(items: list[dict]) -> tuple[float, float, float]:
    active_items = [item for item in items if not bool(item.get("removedBySuperadmin"))]
    subtotal = round(sum(float(item["total"]) for item in active_items), 2)
    tax = round(sum(float(item["total"]) * VAT_RATE for item in active_items), 2)
    total = round(subtotal + tax, 2)
    return subtotal, tax, total


def _load_order_items(session: Session, purchase_order_id: str) -> list[dict]:
    rows = session.execute(
        select(PurchaseOrderItemModel)
        .where(PurchaseOrderItemModel.purchase_order_id == purchase_order_id)
        .order_by(PurchaseOrderItemModel.created_at.asc())
    ).scalars().all()

    return [
        {
            "id": row.id,
            "productId": row.product_id,
            "description": row.description,
            "quantity": float(row.quantity),
            "unit": row.unit,
            "unitPrice": float(row.unit_price),
            "total": float(row.total),
            "categoryId": row.category_id,
            "removedBySuperadmin": bool(row.removed_by_superadmin),
            "removedBySuperadminReason": row.removed_by_superadmin_reason,
        }
        for row in rows
    ]


def _sync_order_items(session: Session, purchase_order_id: str, items: list[dict]) -> None:
    existing_rows = session.execute(
        select(PurchaseOrderItemModel).where(PurchaseOrderItemModel.purchase_order_id == purchase_order_id)
    ).scalars().all()
    existing_by_id = {item.id: item for item in existing_rows}

    incoming_ids = {str(item["id"]) for item in items}
    for existing in existing_rows:
        if existing.id not in incoming_ids:
            session.delete(existing)

    now = datetime.utcnow()
    for item in items:
        model = existing_by_id.get(str(item["id"]))
        if model is None:
            session.add(
                PurchaseOrderItemModel(
                    id=str(item["id"]),
                    purchase_order_id=purchase_order_id,
                    product_id=item.get("productId"),
                    description=str(item["description"]),
                    quantity=float(item["quantity"]),
                    unit=item.get("unit"),
                    unit_price=float(item["unitPrice"]),
                    total=float(item["total"]),
                    category_id=item.get("categoryId"),
                    removed_by_superadmin=bool(item.get("removedBySuperadmin")),
                    removed_by_superadmin_reason=item.get("removedBySuperadminReason"),
                    removed_by=item.get("removedBy"),
                    removed_at=item.get("removedAt"),
                    created_at=now,
                    updated_at=now,
                )
            )
            continue

        model.product_id = item.get("productId")
        model.description = str(item["description"])
        model.quantity = float(item["quantity"])
        model.unit = item.get("unit")
        model.unit_price = float(item["unitPrice"])
        model.total = float(item["total"])
        model.category_id = item.get("categoryId")
        model.removed_by_superadmin = bool(item.get("removedBySuperadmin"))
        model.removed_by_superadmin_reason = item.get("removedBySuperadminReason")
        model.removed_by = item.get("removedBy")
        model.removed_at = item.get("removedAt")
        model.updated_at = now


def _serialize_order(model: PurchaseOrderModel, items: list[dict]) -> PurchaseOrderRead:
    return PurchaseOrderRead(
        id=model.id,
        orderNumber=model.order_number,
        supplierId=model.supplier_id,
        supplierName=model.supplier_name,
        date=model.date,
        status=model.status,
        items=items,
        subtotal=float(model.subtotal),
        tax=float(model.tax),
        total=float(model.total),
        reason=model.reason,
        rejectionReason=model.rejection_reason,
        approvedBy=model.approved_by,
        approvedAt=model.approved_at,
        rejectedBy=model.rejected_by,
        rejectedAt=model.rejected_at,
        submittedAt=model.submitted_at,
        certifiedAt=model.certified_at,
        receivedAt=model.received_at,
        createdBy=model.created_by,
        createdAt=model.created_at,
    )


def _record_inventory_entry_for_po(
    session: Session,
    order: PurchaseOrderModel,
    *,
    created_by: str,
    reason: str,
) -> int:
    items = _load_order_items(session, order.id)
    applied = 0
    now = datetime.utcnow()

    for item in items:
        if item.get("removedBySuperadmin"):
            continue
        product_id = item.get("productId")
        if not product_id:
            continue

        existing_movement = session.execute(
            select(InventoryMovementModel).where(
                InventoryMovementModel.type == "IN",
                InventoryMovementModel.purchase_order_id == order.id,
                InventoryMovementModel.product_id == product_id,
            )
        ).scalars().first()
        if existing_movement is not None:
            continue

        qty = float(item["quantity"])
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
                location="Almacén principal",
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


def _transition_status(order: PurchaseOrderModel, next_status: str, *, reason: str | None, actor_name: str) -> None:
    current = order.status

    allowed: dict[str, set[str]] = {
        "draft": {"pending"},
        "pending": {"approved", "rejected"},
        "approved": {"certified"},
        "rejected": set(),
        "certified": {"received"},
        "received": set(),
    }
    if next_status not in allowed.get(current, set()):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid status transition: {current} -> {next_status}.",
        )

    now = datetime.utcnow()
    order.status = next_status
    order.updated_at = now

    if next_status == "pending":
        order.submitted_at = now
    elif next_status == "approved":
        order.approved_at = now
        order.approved_by = actor_name
        order.rejection_reason = None
    elif next_status == "rejected":
        if not _normalize_text(reason):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="rejection reason is required.",
            )
        order.rejected_at = now
        order.rejected_by = actor_name
        order.rejection_reason = _normalize_text(reason)
    elif next_status == "certified":
        order.certified_at = now
    elif next_status == "received":
        order.received_at = now


@router.get("")
def list_purchase_orders_route(
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=20, ge=1, le=100),
    q: str | None = Query(default=None),
    status_value: str | None = Query(default=None, alias="status"),
    supplierId: str | None = Query(default=None),
    dateFrom: date | None = Query(default=None),
    dateTo: date | None = Query(default=None),
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.PURCHASE_ORDER_VIEW)),
    session: Session = Depends(get_db),
) -> dict:
    if dateFrom and dateTo and dateFrom > dateTo:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="dateFrom must be <= dateTo.")

    query = select(PurchaseOrderModel)

    if status_value:
        normalized_status = status_value.strip().lower()
        if normalized_status in ALLOWED_STATUSES:
            query = query.where(func.lower(PurchaseOrderModel.status) == normalized_status)
    if supplierId:
        query = query.where(PurchaseOrderModel.supplier_id == supplierId.strip())
    if dateFrom:
        query = query.where(PurchaseOrderModel.date >= datetime.combine(dateFrom, time.min))
    if dateTo:
        query = query.where(PurchaseOrderModel.date <= datetime.combine(dateTo, time.max))

    query = query.order_by(PurchaseOrderModel.created_at.desc())
    rows = session.execute(query).scalars().all()

    term = q.strip().lower() if q else ""
    filtered: list[PurchaseOrderModel] = []
    for row in rows:
        if not term:
            filtered.append(row)
            continue
        if (
            term in row.order_number.lower()
            or term in row.supplier_name.lower()
            or term in (row.reason or "").lower()
        ):
            filtered.append(row)

    total = len(filtered)
    start = (page - 1) * pageSize
    stop = start + pageSize
    page_rows = filtered[start:stop]

    data = []
    for row in page_rows:
        items = _load_order_items(session, row.id)
        data.append(_serialize_order(row, items))

    return {
        "data": data,
        "pagination": {
            "page": page,
            "pageSize": pageSize,
            "total": total,
            "totalPages": max((total + pageSize - 1) // pageSize, 1),
        },
        "meta": {"source": "api"},
    }


@router.get("/{purchase_order_id}")
def get_purchase_order_route(
    purchase_order_id: str,
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.PURCHASE_ORDER_VIEW)),
    session: Session = Depends(get_db),
) -> dict:
    order = session.get(PurchaseOrderModel, purchase_order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found.")

    items = _load_order_items(session, purchase_order_id)
    return {"data": _serialize_order(order, items), "meta": {"source": "api"}}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_purchase_order_route(
    payload: PurchaseOrderCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.PURCHASE_ORDER_CREATE)),
    session: Session = Depends(get_db),
) -> dict:
    supplier = session.get(SupplierModel, payload.supplierId)
    if supplier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Supplier not found.")

    order_date = _parse_datetime_input(payload.date, "date")
    _ensure_not_past(order_date)

    normalized_items = _normalize_items([item.model_dump(exclude_none=True) for item in payload.items])
    subtotal, tax, total = _calculate_totals(normalized_items)

    order = PurchaseOrderModel(
        id=f"po_{uuid4()}",
        order_number=_next_order_number(session, order_date.year),
        supplier_id=supplier.id,
        supplier_name=supplier.name,
        date=order_date,
        status="draft",
        items=normalized_items,
        subtotal=subtotal,
        tax=tax,
        total=total,
        reason=_normalize_text(payload.reason),
        created_by=current_user.name,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(order)
    session.flush()
    _sync_order_items(session, order.id, normalized_items)

    log_audit_event(
        session,
        action="purchase_order_create",
        entity_type="purchase_order",
        entity_id=order.id,
        metadata={"orderNumber": order.order_number, "status": order.status, "total": total},
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(order)

    return {"data": _serialize_order(order, _load_order_items(session, order.id)), "meta": {"source": "api"}}


@router.post("/{purchase_order_id}/submit")
def submit_purchase_order_route(
    purchase_order_id: str,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.PURCHASE_ORDER_SUBMIT)),
    session: Session = Depends(get_db),
) -> dict:
    order = session.get(PurchaseOrderModel, purchase_order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found.")

    _transition_status(order, "pending", reason=None, actor_name=current_user.name)

    log_audit_event(
        session,
        action="purchase_order_submit",
        entity_type="purchase_order",
        entity_id=order.id,
        metadata={"status": order.status},
        request=request,
        user=current_user,
    )
    session.commit()
    return {"data": _serialize_order(order, _load_order_items(session, order.id)), "meta": {"source": "api"}}


@router.post("/{purchase_order_id}/approve")
def approve_purchase_order_route(
    purchase_order_id: str,
    payload: PurchaseOrderApproveRequest,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.PURCHASE_ORDER_APPROVE)),
    session: Session = Depends(get_db),
) -> dict:
    order = session.get(PurchaseOrderModel, purchase_order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found.")

    _transition_status(order, "approved", reason=payload.reason, actor_name=current_user.name)

    log_audit_event(
        session,
        action="purchase_order_approve",
        entity_type="purchase_order",
        entity_id=order.id,
        metadata={"status": order.status, "reason": payload.reason},
        request=request,
        user=current_user,
    )
    session.commit()
    return {"data": _serialize_order(order, _load_order_items(session, order.id)), "meta": {"source": "api"}}


@router.post("/{purchase_order_id}/reject")
def reject_purchase_order_route(
    purchase_order_id: str,
    payload: PurchaseOrderRejectRequest,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.PURCHASE_ORDER_REJECT)),
    session: Session = Depends(get_db),
) -> dict:
    order = session.get(PurchaseOrderModel, purchase_order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found.")

    _transition_status(order, "rejected", reason=payload.reason, actor_name=current_user.name)

    log_audit_event(
        session,
        action="purchase_order_reject",
        entity_type="purchase_order",
        entity_id=order.id,
        metadata={"status": order.status, "reason": payload.reason},
        request=request,
        user=current_user,
    )
    session.commit()
    return {"data": _serialize_order(order, _load_order_items(session, order.id)), "meta": {"source": "api"}}


@router.post("/{purchase_order_id}/certify")
def certify_purchase_order_route(
    purchase_order_id: str,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.PURCHASE_ORDER_CERTIFY)),
    session: Session = Depends(get_db),
) -> dict:
    order = session.get(PurchaseOrderModel, purchase_order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found.")

    _transition_status(order, "certified", reason=None, actor_name=current_user.name)
    moved_items = _record_inventory_entry_for_po(session, order, created_by=current_user.id, reason="OC_CERTIFIED")

    log_audit_event(
        session,
        action="purchase_order_certify",
        entity_type="purchase_order",
        entity_id=order.id,
        metadata={"status": order.status, "inventoryEntries": moved_items},
        request=request,
        user=current_user,
    )
    session.commit()
    return {"data": _serialize_order(order, _load_order_items(session, order.id)), "meta": {"source": "api"}}


@router.post("/{purchase_order_id}/receive")
def receive_purchase_order_route(
    purchase_order_id: str,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.PURCHASE_ORDER_RECEIVE)),
    session: Session = Depends(get_db),
) -> dict:
    order = session.get(PurchaseOrderModel, purchase_order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found.")

    _transition_status(order, "received", reason=None, actor_name=current_user.name)
    moved_items = _record_inventory_entry_for_po(session, order, created_by=current_user.id, reason="OC_RECEIVED")

    log_audit_event(
        session,
        action="purchase_order_receive",
        entity_type="purchase_order",
        entity_id=order.id,
        metadata={"status": order.status, "inventoryEntries": moved_items},
        request=request,
        user=current_user,
    )
    session.commit()
    return {"data": _serialize_order(order, _load_order_items(session, order.id)), "meta": {"source": "api"}}


@router.post("/{purchase_order_id}/items/{item_id}/remove")
def remove_purchase_order_item_route(
    purchase_order_id: str,
    item_id: str,
    payload: PurchaseOrderRemoveItemRequest,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.PURCHASE_ORDER_REMOVE_ITEM)),
    session: Session = Depends(get_db),
) -> dict:
    order = session.get(PurchaseOrderModel, purchase_order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found.")

    if order.status not in {"pending", "approved"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Items can only be removed while order is pending or approved.",
        )

    reason = _normalize_text(payload.reason)
    if not reason:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="reason is required.")

    model_item = session.execute(
        select(PurchaseOrderItemModel).where(
            PurchaseOrderItemModel.id == item_id,
            PurchaseOrderItemModel.purchase_order_id == purchase_order_id,
        )
    ).scalar_one_or_none()
    if model_item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order item not found.")
    if model_item.removed_by_superadmin:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Item was already removed.")

    now = datetime.utcnow()
    model_item.removed_by_superadmin = True
    model_item.removed_by_superadmin_reason = reason
    model_item.removed_by = current_user.id
    model_item.removed_at = now
    model_item.updated_at = now

    items = _load_order_items(session, purchase_order_id)
    updated_items: list[dict] = []
    for item in items:
        if item["id"] != item_id:
            updated_items.append(item)
            continue
        updated_items.append(
            {
                **item,
                "removedBySuperadmin": True,
                "removedBySuperadminReason": reason,
            }
        )

    subtotal, tax, total = _calculate_totals(updated_items)
    order.items = updated_items
    order.subtotal = subtotal
    order.tax = tax
    order.total = total
    order.updated_at = now

    log_audit_event(
        session,
        action="purchase_order_remove_item",
        entity_type="purchase_order",
        entity_id=order.id,
        metadata={"itemId": item_id, "reason": reason, "status": order.status, "total": total},
        request=request,
        user=current_user,
    )
    session.commit()
    return {"data": _serialize_order(order, _load_order_items(session, order.id)), "meta": {"source": "api"}}


# Legacy compatibility endpoint retained for older frontend clients.
@router.put("/{purchase_order_id}/status")
def update_purchase_order_status_legacy(
    purchase_order_id: str,
    payload: dict,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.PURCHASE_ORDER_STATUS_UPDATE)),
    session: Session = Depends(get_db),
) -> dict:
    next_status = str(payload.get("status", "")).strip().lower()
    reason = _normalize_text(payload.get("reason"))

    dispatch: dict[str, tuple[str, Permission, Literal["pending", "approved", "rejected", "certified", "received"]]] = {
        "pending": ("purchase_order_submit", Permission.PURCHASE_ORDER_SUBMIT, "pending"),
        "approved": ("purchase_order_approve", Permission.PURCHASE_ORDER_APPROVE, "approved"),
        "rejected": ("purchase_order_reject", Permission.PURCHASE_ORDER_REJECT, "rejected"),
        "certified": ("purchase_order_certify", Permission.PURCHASE_ORDER_CERTIFY, "certified"),
        "received": ("purchase_order_receive", Permission.PURCHASE_ORDER_RECEIVE, "received"),
    }
    target = dispatch.get(next_status)
    if target is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unsupported status.")

    order = session.get(PurchaseOrderModel, purchase_order_id)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found.")

    _transition_status(order, target[2], reason=reason, actor_name=current_user.name)

    moved_items = 0
    if target[2] == "certified":
        moved_items = _record_inventory_entry_for_po(session, order, created_by=current_user.id, reason="OC_CERTIFIED")
    elif target[2] == "received":
        moved_items = _record_inventory_entry_for_po(session, order, created_by=current_user.id, reason="OC_RECEIVED")

    log_audit_event(
        session,
        action=target[0],
        entity_type="purchase_order",
        entity_id=order.id,
        metadata={"status": order.status, "reason": reason, "inventoryEntries": moved_items},
        request=request,
        user=current_user,
    )
    session.commit()
    return {"data": _serialize_order(order, _load_order_items(session, order.id)), "meta": {"source": "api"}}
