from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from typing import Literal
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import InvoiceModel, PaymentModel, PurchaseOrderModel, SupplierCategoryLinkModel, SupplierModel
from .schemas import InvoiceCreate, PaymentCreate, PurchaseOrderCreate

VAT_RATE = 0.16
PURCHASE_ORDER_STATUSES = {
    "draft",
    "pending",
    "approved",
    "paid",
    "overdue",
    "sent",
    "received",
    "closed",
    "canceled",
}


@dataclass
class Pagination:
    page: int
    page_size: int
    total: int

    @property
    def total_pages(self) -> int:
        return max((self.total + self.page_size - 1) // self.page_size, 1)


@dataclass
class PagedResult:
    data: list[dict]
    pagination: Pagination


def _to_naive_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def parse_datetime_input(raw: datetime | date | str, field_name: str) -> datetime:
    if isinstance(raw, datetime):
        return _to_naive_datetime(raw)
    if isinstance(raw, date):
        return datetime.combine(raw, time(hour=12, minute=0))
    if not isinstance(raw, str):
        raise ValueError(f"{field_name} has an invalid value.")

    value = raw.strip()
    if not value:
        raise ValueError(f"{field_name} is required.")

    if len(value) == 10:
        # Date-only inputs are persisted at noon to avoid local timezone date shifts.
        parsed_date = date.fromisoformat(value)
        return datetime.combine(parsed_date, time(hour=12, minute=0))

    normalized = value.replace("Z", "+00:00")
    parsed_datetime = datetime.fromisoformat(normalized)
    return _to_naive_datetime(parsed_datetime)


def _normalize_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _next_sequence(
    session: Session,
    model: type[PurchaseOrderModel] | type[InvoiceModel] | type[PaymentModel],
    field: str,
    prefix: str,
    digits: int = 3,
) -> str:
    column = getattr(model, field)
    values = session.execute(select(column).where(column.like(f"{prefix}%"))).scalars().all()
    numbers: list[int] = []
    for value in values:
        text = str(value)
        if not text.startswith(prefix):
            continue
        suffix = text[len(prefix) :]
        try:
            numbers.append(int(suffix))
        except ValueError:
            continue
    next_number = (max(numbers) if numbers else 0) + 1
    return f"{prefix}{str(next_number).zfill(digits)}"


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


def _normalize_order_item(raw: dict, index: int) -> dict:
    description = str(raw.get("description", "")).strip()
    if not description:
        raise ValueError(f"items[{index}].description is required.")

    try:
        quantity = float(raw.get("quantity", 0))
    except (TypeError, ValueError):
        raise ValueError(f"items[{index}].quantity is invalid.")
    if quantity <= 0:
        raise ValueError(f"items[{index}].quantity must be greater than zero.")

    try:
        unit_price = float(raw.get("unitPrice", 0))
    except (TypeError, ValueError):
        raise ValueError(f"items[{index}].unitPrice is invalid.")
    if unit_price < 0:
        raise ValueError(f"items[{index}].unitPrice must be zero or greater.")

    raw_type = raw.get("typeItem")
    if raw_type is None:
        raw_type = raw.get("itemType")

    if raw_type not in {"product", "service", None}:
        raise ValueError(f"items[{index}].typeItem is invalid.")

    is_service = bool(raw.get("isService"))
    if raw_type in {"product", "service"}:
        is_service = raw_type == "service"

    applies_iva = raw.get("appliesIva")
    if applies_iva is None:
        applies_iva = is_service
    applies_iva = bool(applies_iva) if is_service else False

    total = round(quantity * unit_price, 2)
    category_id = _normalize_text(str(raw.get("categoryId", "") or ""))
    service_id = _normalize_text(str(raw.get("serviceId", "") or ""))

    return {
        "id": str(raw.get("id") or f"poi_{uuid4()}"),
        "description": description,
        "quantity": quantity,
        "unitPrice": unit_price,
        "total": total,
        "isService": is_service,
        "appliesIva": applies_iva,
        "serviceId": service_id,
        "categoryId": category_id,
        "typeItem": "service" if is_service else "product",
    }


def _normalize_order_items(items: list[dict]) -> list[dict]:
    normalized: list[dict] = []
    for index, item in enumerate(items):
        normalized.append(_normalize_order_item(item, index))
    return normalized


def calculate_purchase_order_totals(items: list[dict]) -> tuple[float, float, float]:
    subtotal = round(sum(float(item["total"]) for item in items), 2)
    tax = round(
        sum(float(item["total"]) * VAT_RATE for item in items if item.get("isService") and item.get("appliesIva")),
        2,
    )
    total = round(subtotal + tax, 2)
    return subtotal, tax, total


def _to_purchase_order_read(model: PurchaseOrderModel) -> dict:
    reason = _normalize_text(model.reason)
    items = _normalize_order_items(list(model.items or []))
    subtotal, tax, total = calculate_purchase_order_totals(items)

    # Keep persisted totals aligned even if legacy data was stale.
    if model.subtotal != subtotal or model.tax != tax or model.total != total:
        model.subtotal = subtotal
        model.tax = tax
        model.total = total

    return {
        "id": model.id,
        "orderNumber": model.order_number,
        "supplierId": model.supplier_id,
        "supplierName": model.supplier_name,
        "date": model.date,
        "status": model.status,
        "items": items,
        "subtotal": subtotal,
        "tax": tax,
        "total": total,
        "reason": reason,
        "createdBy": model.created_by,
        "createdAt": model.created_at,
    }


def _to_invoice_read(model: InvoiceModel) -> dict:
    return {
        "id": model.id,
        "invoiceNumber": model.invoice_number,
        "purchaseOrderId": model.purchase_order_id,
        "supplierId": model.supplier_id,
        "supplierName": model.supplier_name,
        "issueDate": model.issue_date,
        "dueDate": model.due_date,
        "status": model.status,
        "amount": round(model.amount, 2),
        "paidAmount": round(model.paid_amount, 2),
        "balance": round(model.balance, 2),
        "createdBy": model.created_by,
        "createdAt": model.created_at,
    }


def _to_payment_read(model: PaymentModel) -> dict:
    reason = _normalize_text(model.notes)
    return {
        "id": model.id,
        "paymentNumber": model.payment_number,
        "invoiceId": model.invoice_id,
        "invoiceNumber": model.invoice_number,
        "supplierId": model.supplier_id,
        "supplierName": model.supplier_name,
        "date": model.date,
        "amount": round(model.amount, 2),
        "method": model.method,
        "reference": model.reference,
        "status": model.status,
        "proofUrl": model.proof_url,
        "reason": reason,
        "notes": reason,
        "createdBy": model.created_by,
        "createdAt": model.created_at,
    }


def _get_supplier_category_maps(session: Session) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    link_rows = session.execute(
        select(SupplierCategoryLinkModel.supplier_id, SupplierCategoryLinkModel.category_id)
    ).all()
    links_by_supplier: dict[str, list[str]] = {}
    for supplier_id, category_id in link_rows:
        links_by_supplier.setdefault(str(supplier_id), []).append(str(category_id))

    legacy_rows = session.execute(select(SupplierModel.id, SupplierModel.category_ids)).all()
    legacy_by_supplier: dict[str, list[str]] = {}
    for supplier_id, category_ids in legacy_rows:
        legacy_by_supplier[str(supplier_id)] = _normalize_category_ids(category_ids)

    return (
        {key: _normalize_category_ids(values) for key, values in links_by_supplier.items()},
        legacy_by_supplier,
    )


def create_purchase_order(session: Session, payload: PurchaseOrderCreate) -> dict:
    raw_items = [item.model_dump(exclude_none=True) for item in payload.items]
    if not raw_items:
        raise ValueError("items must contain at least one line.")

    supplier = session.get(SupplierModel, payload.supplierId)
    if supplier is None:
        raise ValueError("Supplier not found.")

    order_date = parse_datetime_input(payload.date, "date")
    status = str(payload.status or "draft").strip().lower()
    if status not in PURCHASE_ORDER_STATUSES:
        status = "draft"

    items = _normalize_order_items(raw_items)
    subtotal, tax, total = calculate_purchase_order_totals(items)
    year = order_date.year
    order_number = _next_sequence(session, PurchaseOrderModel, "order_number", f"OC-{year}-")

    model = PurchaseOrderModel(
        id=f"po_{uuid4()}",
        order_number=order_number,
        supplier_id=supplier.id,
        supplier_name=supplier.name,
        date=order_date,
        status=status,
        items=items,
        subtotal=subtotal,
        tax=tax,
        total=total,
        reason=_normalize_text(payload.reason),
        created_by=_normalize_text(payload.createdBy) or "Sistema",
        created_at=datetime.utcnow(),
    )
    session.add(model)
    session.commit()
    session.refresh(model)
    return _to_purchase_order_read(model)


def get_purchase_order(session: Session, purchase_order_id: str) -> dict | None:
    model = session.get(PurchaseOrderModel, purchase_order_id)
    if model is None:
        return None
    result = _to_purchase_order_read(model)
    session.commit()
    return result


def list_purchase_orders(
    session: Session,
    *,
    page: int,
    page_size: int,
    search: str | None,
    status: str | None,
    supplier_id: str | None,
    category_id: str | None,
    date_from: date | None,
    date_to: date | None,
    date_field: Literal["date", "createdAt"],
) -> PagedResult:
    query = select(PurchaseOrderModel)

    if status:
        query = query.where(func.lower(PurchaseOrderModel.status) == status.strip().lower())
    if supplier_id:
        query = query.where(PurchaseOrderModel.supplier_id == supplier_id.strip())

    target_column = PurchaseOrderModel.date if date_field == "date" else PurchaseOrderModel.created_at
    if date_from:
        start_dt = datetime.combine(date_from, time.min)
        query = query.where(target_column >= start_dt)
    if date_to:
        end_dt = datetime.combine(date_to, time.max)
        query = query.where(target_column <= end_dt)

    query = query.order_by(PurchaseOrderModel.created_at.desc())
    records = session.execute(query).scalars().all()

    links_by_supplier, legacy_by_supplier = _get_supplier_category_maps(session)
    search_term = search.strip().lower() if search else ""
    filtered_records: list[PurchaseOrderModel] = []

    for model in records:
        serialized = _to_purchase_order_read(model)
        item_categories = _normalize_category_ids(
            [str(item.get("categoryId")) for item in serialized["items"] if item.get("categoryId")]
        )
        supplier_categories = links_by_supplier.get(model.supplier_id) or legacy_by_supplier.get(model.supplier_id, [])
        resolved_categories = item_categories if item_categories else supplier_categories

        if category_id and category_id not in resolved_categories:
            continue

        if search_term:
            core_hits = (
                search_term in model.order_number.lower()
                or search_term in model.supplier_name.lower()
                or search_term in (model.reason or "").lower()
            )
            item_hits = any(
                search_term in str(item.get("description", "")).lower()
                or search_term in str(item.get("categoryId", "")).lower()
                for item in serialized["items"]
            )
            category_hit = any(search_term in value.lower() for value in resolved_categories)
            if not core_hits and not item_hits and not category_hit:
                continue

        filtered_records.append(model)

    total = len(filtered_records)
    start = (page - 1) * page_size
    stop = start + page_size
    page_records = filtered_records[start:stop]

    data = [_to_purchase_order_read(model) for model in page_records]
    session.commit()
    return PagedResult(data=data, pagination=Pagination(page=page, page_size=page_size, total=total))


def create_invoice(session: Session, payload: InvoiceCreate, *, created_by: str | None = None) -> dict:
    purchase_order = session.get(PurchaseOrderModel, payload.purchaseOrderId)
    if purchase_order is None:
        raise ValueError("Purchase order not found.")

    issue_date = parse_datetime_input(payload.issueDate, "issueDate")
    due_date = parse_datetime_input(payload.dueDate, "dueDate")
    if due_date < issue_date:
        raise ValueError("dueDate must be greater than or equal to issueDate.")

    amount = round(float(payload.amount), 2)
    if amount <= 0:
        raise ValueError("amount must be greater than zero.")

    invoice_number = payload.invoiceNumber.strip()
    if not invoice_number:
        raise ValueError("invoiceNumber is required.")

    existing = session.execute(
        select(InvoiceModel).where(func.lower(InvoiceModel.invoice_number) == invoice_number.lower())
    ).scalar_one_or_none()
    if existing is not None:
        raise ValueError("invoiceNumber already exists.")

    model = InvoiceModel(
        id=f"inv_{uuid4()}",
        invoice_number=invoice_number,
        purchase_order_id=purchase_order.id,
        supplier_id=purchase_order.supplier_id,
        supplier_name=purchase_order.supplier_name,
        issue_date=issue_date,
        due_date=due_date,
        status="pending",
        amount=amount,
        paid_amount=0.0,
        balance=amount,
        created_by=_normalize_text(created_by) or "Sistema",
        created_at=datetime.utcnow(),
    )
    session.add(model)
    session.commit()
    session.refresh(model)
    return _to_invoice_read(model)


def get_invoice(session: Session, invoice_id: str) -> dict | None:
    model = session.get(InvoiceModel, invoice_id)
    if model is None:
        return None
    return _to_invoice_read(model)


def list_invoices(
    session: Session,
    *,
    page: int,
    page_size: int,
    search: str | None,
    supplier_id: str | None,
    status: str | None,
) -> PagedResult:
    query = select(InvoiceModel)

    if supplier_id:
        query = query.where(InvoiceModel.supplier_id == supplier_id.strip())
    if status:
        query = query.where(func.lower(InvoiceModel.status) == status.strip().lower())
    if search:
        lowered = f"%{search.strip().lower()}%"
        query = query.where(
            func.lower(InvoiceModel.invoice_number).like(lowered)
            | func.lower(InvoiceModel.supplier_name).like(lowered)
        )

    query = query.order_by(InvoiceModel.created_at.desc())
    records = session.execute(query).scalars().all()
    total = len(records)

    start = (page - 1) * page_size
    stop = start + page_size
    page_records = records[start:stop]
    data = [_to_invoice_read(model) for model in page_records]
    return PagedResult(data=data, pagination=Pagination(page=page, page_size=page_size, total=total))


def create_payment(session: Session, payload: PaymentCreate) -> dict:
    invoice = session.get(InvoiceModel, payload.invoiceId)
    if invoice is None:
        raise ValueError("Invoice not found.")

    payment_date = parse_datetime_input(payload.date, "date")
    amount = round(float(payload.amount), 2)
    if amount <= 0:
        raise ValueError("amount must be greater than zero.")
    if amount > round(invoice.balance, 2):
        raise ValueError("amount cannot be greater than invoice balance.")

    reference = payload.reference.strip()
    if not reference:
        raise ValueError("reference is required.")

    reason = _normalize_text(payload.reason) or _normalize_text(payload.notes)
    payment_number = _next_sequence(session, PaymentModel, "payment_number", f"PAG-{payment_date.year}-")

    next_paid_amount = round(invoice.paid_amount + amount, 2)
    next_balance = round(max(invoice.amount - next_paid_amount, 0.0), 2)
    invoice.paid_amount = next_paid_amount
    invoice.balance = next_balance
    invoice.status = "paid" if next_balance == 0 else "partial"

    model = PaymentModel(
        id=f"pay_{uuid4()}",
        payment_number=payment_number,
        invoice_id=invoice.id,
        invoice_number=invoice.invoice_number,
        supplier_id=invoice.supplier_id,
        supplier_name=invoice.supplier_name,
        date=payment_date,
        amount=amount,
        method=payload.method,
        reference=reference,
        status="completed",
        proof_url=payload.proofUrl,
        notes=reason,
        created_by=_normalize_text(payload.createdBy) or "Sistema",
        created_at=datetime.utcnow(),
    )
    session.add(model)
    session.commit()
    session.refresh(model)
    return _to_payment_read(model)


def get_payment(session: Session, payment_id: str) -> dict | None:
    model = session.get(PaymentModel, payment_id)
    if model is None:
        return None
    return _to_payment_read(model)


def list_payments(
    session: Session,
    *,
    page: int,
    page_size: int,
    search: str | None,
    invoice_query: str | None,
    supplier_query: str | None,
    supplier_id: str | None,
    status: str | None,
) -> PagedResult:
    query = select(PaymentModel)

    if supplier_id:
        query = query.where(PaymentModel.supplier_id == supplier_id.strip())
    if status:
        query = query.where(func.lower(PaymentModel.status) == status.strip().lower())
    if invoice_query:
        lowered = f"%{invoice_query.strip().lower()}%"
        query = query.where(func.lower(PaymentModel.invoice_number).like(lowered))
    if supplier_query:
        lowered_supplier = f"%{supplier_query.strip().lower()}%"
        query = query.where(func.lower(PaymentModel.supplier_name).like(lowered_supplier))
    if search:
        lowered_search = f"%{search.strip().lower()}%"
        query = query.where(
            func.lower(PaymentModel.payment_number).like(lowered_search)
            | func.lower(PaymentModel.invoice_number).like(lowered_search)
            | func.lower(PaymentModel.reference).like(lowered_search)
            | func.lower(PaymentModel.supplier_name).like(lowered_search)
            | func.lower(func.coalesce(PaymentModel.notes, "")).like(lowered_search)
        )

    query = query.order_by(PaymentModel.created_at.desc())
    records = session.execute(query).scalars().all()
    total = len(records)

    start = (page - 1) * page_size
    stop = start + page_size
    page_records = records[start:stop]
    data = [_to_payment_read(model) for model in page_records]
    return PagedResult(data=data, pagination=Pagination(page=page, page_size=page_size, total=total))


def update_purchase_order_status(
    session: Session,
    *,
    purchase_order_id: str,
    next_status: str,
    reason: str | None = None,
) -> dict:
    model = session.get(PurchaseOrderModel, purchase_order_id)
    if model is None:
        raise ValueError("Purchase order not found.")

    normalized_status = str(next_status or "").strip().lower()
    if normalized_status not in PURCHASE_ORDER_STATUSES:
        raise ValueError("status is invalid.")

    model.status = normalized_status
    if reason is not None:
        model.reason = _normalize_text(reason)
    session.commit()
    session.refresh(model)
    return _to_purchase_order_read(model)
