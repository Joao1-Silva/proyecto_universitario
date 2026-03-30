from __future__ import annotations

from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..audit import log_audit_event
from ..inventory_services import record_inventory_entry_for_purchase_order
from ..models import (
    FinanceInstallmentModel,
    FinanceLateFeeModel,
    FinancePaymentModel,
    PurchaseOrderModel,
    SupplierModel,
)
from ..schemas import (
    FinanceInstallmentCreate,
    FinanceLateFeeCreate,
    FinancePaymentCreate,
)
from ..security import AuthenticatedUser, Permission, get_db, require_permissions

router = APIRouter(prefix="/finanzas", tags=["finanzas"])


def _normalize_usd_currency(raw_value: str | None) -> str:
    normalized = (raw_value or "").strip().upper() or "USD"
    if normalized != "USD":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La moneda admitida es USD.",
        )
    return "USD"


def _serialize_payment(model: FinancePaymentModel) -> dict:
    return {
        "id": model.id,
        "purchaseOrderId": model.purchase_order_id,
        "amount": float(model.amount),
        "currency": model.currency,
        "paymentType": model.payment_type,
        "paymentMode": model.payment_mode,
        "reference": model.reference,
        "concept": model.concept,
        "createdBy": model.created_by,
        "createdAt": model.created_at,
    }


def _serialize_installment(model: FinanceInstallmentModel) -> dict:
    return {
        "id": model.id,
        "purchaseOrderId": model.purchase_order_id,
        "financePaymentId": model.finance_payment_id,
        "amount": float(model.amount),
        "currency": model.currency,
        "concept": model.concept,
        "createdBy": model.created_by,
        "createdAt": model.created_at,
    }


def _serialize_late_fee(model: FinanceLateFeeModel) -> dict:
    return {
        "id": model.id,
        "purchaseOrderId": model.purchase_order_id,
        "mode": model.mode,
        "percentageMonthly": model.percentage_monthly,
        "fixedAmount": model.fixed_amount,
        "calculatedAmount": float(model.calculated_amount),
        "concept": model.concept,
        "createdBy": model.created_by,
        "createdAt": model.created_at,
    }


def _ensure_purchase_order(session: Session, purchase_order_id: str) -> PurchaseOrderModel:
    purchase_order = session.get(PurchaseOrderModel, purchase_order_id)
    if purchase_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Orden de compra no encontrada.")
    return purchase_order


def _ensure_supplier(session: Session, supplier_id: str) -> SupplierModel:
    supplier = session.get(SupplierModel, supplier_id)
    if supplier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proveedor no encontrado.")
    return supplier


def _ensure_finance_order_status(order: PurchaseOrderModel) -> None:
    if order.status not in {"approved", "certified", "received"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Solo se pueden registrar pagos o abonos para órdenes aprobadas, certificadas o recibidas.",
        )


def _sum_installments_by_order(session: Session) -> dict[str, float]:
    rows = session.execute(
        select(
            FinanceInstallmentModel.purchase_order_id,
            func.coalesce(func.sum(FinanceInstallmentModel.amount), 0.0),
        ).group_by(FinanceInstallmentModel.purchase_order_id)
    ).all()
    return {str(order_id): round(float(total), 2) for order_id, total in rows}


def _build_credit_due_fields(
    order: PurchaseOrderModel,
    supplier: SupplierModel | None,
    remaining_amount: float,
    *,
    today: datetime | None = None,
) -> dict:
    credit_days = max(int(supplier.credit_days if supplier is not None else 0), 0)
    if credit_days <= 0:
        return {
            "creditDays": 0,
            "creditDueDate": None,
            "daysUntilCreditDue": None,
            "isDueToday": False,
            "isOverdue": False,
        }

    base_date = order.approved_at or order.date
    due_date = (base_date + timedelta(days=credit_days)).date()
    today_date = (today or datetime.utcnow()).date()
    days_until_due = (due_date - today_date).days
    has_pending_balance = remaining_amount > 0

    return {
        "creditDays": credit_days,
        "creditDueDate": due_date.isoformat(),
        "daysUntilCreditDue": days_until_due,
        "isDueToday": has_pending_balance and days_until_due == 0,
        "isOverdue": has_pending_balance and days_until_due < 0,
    }


def _build_order_balance_summary(
    order: PurchaseOrderModel,
    supplier: SupplierModel | None,
    paid_amount: float,
    *,
    today: datetime | None = None,
) -> dict:
    total_amount = round(float(order.total), 2)
    paid_amount = round(float(paid_amount), 2)
    remaining_amount = round(max(total_amount - paid_amount, 0.0), 2)

    status_value = "pending"
    if remaining_amount <= 0:
        status_value = "paid"
    elif paid_amount > 0:
        status_value = "partial"

    return {
        "purchaseOrderId": order.id,
        "orderNumber": order.order_number,
        "supplierName": order.supplier_name,
        "totalAmount": total_amount,
        "paidAmount": paid_amount,
        "remainingAmount": remaining_amount,
        "status": status_value,
        "currency": "USD",
        **_build_credit_due_fields(order, supplier, remaining_amount, today=today),
    }


def _build_finance_summaries(session: Session, purchase_order_id: str | None = None) -> list[dict]:
    query = select(PurchaseOrderModel).order_by(PurchaseOrderModel.date.desc())
    if purchase_order_id:
        query = query.where(PurchaseOrderModel.id == purchase_order_id)

    orders = session.execute(query).scalars().all()
    if not orders:
        return []

    paid_by_order = _sum_installments_by_order(session)
    supplier_ids = {order.supplier_id for order in orders}
    suppliers = (
        session.execute(select(SupplierModel).where(SupplierModel.id.in_(supplier_ids))).scalars().all()
        if supplier_ids
        else []
    )
    supplier_by_id = {supplier.id: supplier for supplier in suppliers}
    return [
        _build_order_balance_summary(order, supplier_by_id.get(order.supplier_id), paid_by_order.get(order.id, 0.0))
        for order in orders
    ]


def _build_current_balance(session: Session, order: PurchaseOrderModel, supplier: SupplierModel | None = None) -> dict:
    paid_by_order = _sum_installments_by_order(session)
    supplier_model = supplier or _ensure_supplier(session, order.supplier_id)
    return _build_order_balance_summary(order, supplier_model, paid_by_order.get(order.id, 0.0))


@router.get("/resumen")
def list_finance_summaries(
    purchaseOrderId: str | None = Query(default=None),
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.FINANCE_VIEW)),
    session: Session = Depends(get_db),
) -> dict:
    if purchaseOrderId:
        _ensure_purchase_order(session, purchaseOrderId)
    summaries = _build_finance_summaries(session, purchaseOrderId)
    return {"data": summaries, "meta": {"source": "api"}}


@router.get("/pagos")
def list_payments(
    purchaseOrderId: str | None = Query(default=None),
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.FINANCE_VIEW)),
    session: Session = Depends(get_db),
) -> dict:
    query = select(FinancePaymentModel).order_by(FinancePaymentModel.created_at.desc())
    if purchaseOrderId:
        query = query.where(FinancePaymentModel.purchase_order_id == purchaseOrderId)
    records = session.execute(query).scalars().all()
    return {"data": [_serialize_payment(item) for item in records], "meta": {"source": "api"}}


@router.post("/pagos", status_code=status.HTTP_201_CREATED)
def create_payment(
    payload: FinancePaymentCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.FINANCE_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    amount = round(float(payload.amount), 2)
    if amount <= 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="El monto debe ser mayor a 0.")

    purchase_order = _ensure_purchase_order(session, payload.purchaseOrderId)
    _ensure_finance_order_status(purchase_order)
    supplier = _ensure_supplier(session, purchase_order.supplier_id)
    current_balance = _build_current_balance(session, purchase_order, supplier)
    remaining_amount = float(current_balance["remainingAmount"])
    if remaining_amount <= 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="La orden ya está pagada.")

    payment_type = payload.paymentType.strip().lower()
    if payment_type not in {"contado", "credito"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El tipo de pago debe ser contado o crédito.",
        )

    payment_mode = payload.paymentMode.strip()
    if payment_type == "contado" and not payment_mode:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El modo de pago es obligatorio para pagos de contado.",
        )

    if amount > remaining_amount:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El pago no puede superar el saldo restante.",
        )

    if payment_type == "contado" and round(amount, 2) != round(remaining_amount, 2):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Los pagos de contado deben registrar el saldo completo de la orden.",
        )

    if supplier.credit_days <= 0:
        if payment_type != "contado":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="El proveedor no tiene días de crédito. Solo se admite pago de contado.",
            )

    now = datetime.utcnow()
    model = FinancePaymentModel(
        id=f"fpay_{uuid4()}",
        purchase_order_id=payload.purchaseOrderId,
        amount=amount,
        currency=_normalize_usd_currency(payload.currency),
        payment_type=payment_type,
        payment_mode=payment_mode,
        reference=payload.reference,
        concept=payload.concept,
        created_by=current_user.id,
        created_at=now,
    )
    installment = FinanceInstallmentModel(
        id=f"fins_{uuid4()}",
        purchase_order_id=payload.purchaseOrderId,
        finance_payment_id=model.id,
        amount=amount,
        currency=model.currency,
        concept=payload.concept,
        created_by=current_user.id,
        created_at=now,
    )
    session.add(model)
    session.add(installment)
    moved_items = record_inventory_entry_for_purchase_order(
        session,
        purchase_order,
        created_by=current_user.id,
        reason="FINANCE_PAYMENT",
    )

    log_audit_event(
        session,
        action="finance_payment_create",
        entity_type="finance_payment",
        entity_id=model.id,
        metadata={
            "purchaseOrderId": model.purchase_order_id,
            "amount": model.amount,
            "paymentType": model.payment_type,
            "generatedInstallmentId": installment.id,
            "inventoryEntries": moved_items,
        },
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(model)

    payment_payload = _serialize_payment(model)
    payment_payload["balance"] = _build_order_balance_summary(
        purchase_order,
        supplier,
        float(current_balance["paidAmount"]) + amount,
    )
    payment_payload["generatedInstallmentId"] = installment.id
    payment_payload["inventoryEntries"] = moved_items
    return {"data": payment_payload, "meta": {"source": "api"}}


@router.get("/abonos")
def list_installments(
    purchaseOrderId: str | None = Query(default=None),
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.FINANCE_VIEW)),
    session: Session = Depends(get_db),
) -> dict:
    query = select(FinanceInstallmentModel).order_by(FinanceInstallmentModel.created_at.desc())
    if purchaseOrderId:
        query = query.where(FinanceInstallmentModel.purchase_order_id == purchaseOrderId)
    rows = session.execute(query).scalars().all()
    return {"data": [_serialize_installment(row) for row in rows], "meta": {"source": "api"}}


@router.post("/abonos", status_code=status.HTTP_201_CREATED)
def create_installment(
    payload: FinanceInstallmentCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.FINANCE_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    amount = round(float(payload.amount), 2)
    if amount <= 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="El abono debe ser mayor a 0.")

    purchase_order = _ensure_purchase_order(session, payload.purchaseOrderId)
    _ensure_finance_order_status(purchase_order)
    supplier = _ensure_supplier(session, purchase_order.supplier_id)
    if supplier.credit_days <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El proveedor no tiene días de crédito. Debe registrar un pago completo, no abonos.",
        )

    if payload.financePaymentId:
        payment = session.get(FinancePaymentModel, payload.financePaymentId)
        if payment is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pago financiero no encontrado.")

    current_balance = _build_current_balance(session, purchase_order, supplier)
    current_paid = float(current_balance["paidAmount"])

    if current_balance["remainingAmount"] <= 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="La orden ya está pagada.")

    if amount > float(current_balance["remainingAmount"]):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El abono no puede superar el saldo restante.",
        )

    model = FinanceInstallmentModel(
        id=f"fins_{uuid4()}",
        purchase_order_id=payload.purchaseOrderId,
        finance_payment_id=payload.financePaymentId,
        amount=amount,
        currency=_normalize_usd_currency(payload.currency),
        concept=payload.concept,
        created_by=current_user.id,
        created_at=datetime.utcnow(),
    )
    session.add(model)
    moved_items = record_inventory_entry_for_purchase_order(
        session,
        purchase_order,
        created_by=current_user.id,
        reason="FINANCE_INSTALLMENT",
    )

    log_audit_event(
        session,
        action="finance_installment_create",
        entity_type="finance_installment",
        entity_id=model.id,
        metadata={"purchaseOrderId": model.purchase_order_id, "amount": model.amount, "inventoryEntries": moved_items},
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(model)

    updated_balance = _build_order_balance_summary(purchase_order, supplier, current_paid + amount)
    payload_data = _serialize_installment(model)
    payload_data["balance"] = updated_balance
    payload_data["inventoryEntries"] = moved_items

    return {"data": payload_data, "meta": {"source": "api"}}


@router.get("/moras")
def list_late_fees(
    purchaseOrderId: str | None = Query(default=None),
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.FINANCE_VIEW)),
    session: Session = Depends(get_db),
) -> dict:
    query = select(FinanceLateFeeModel).order_by(FinanceLateFeeModel.created_at.desc())
    if purchaseOrderId:
        query = query.where(FinanceLateFeeModel.purchase_order_id == purchaseOrderId)
    rows = session.execute(query).scalars().all()
    return {"data": [_serialize_late_fee(row) for row in rows], "meta": {"source": "api"}}


@router.post("/moras", status_code=status.HTTP_201_CREATED)
def create_late_fee(
    payload: FinanceLateFeeCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.FINANCE_MANAGE)),
    session: Session = Depends(get_db),
) -> dict:
    purchase_order = _ensure_purchase_order(session, payload.purchaseOrderId)

    mode = payload.mode.strip().lower()
    if mode not in {"percentage", "fixed"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El tipo de mora debe ser percentage o fixed.",
        )

    percentage_monthly = payload.percentageMonthly
    fixed_amount = payload.fixedAmount

    if mode == "percentage":
        if percentage_monthly is None or percentage_monthly <= 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="percentageMonthly debe ser mayor a cero para el modo percentage.",
            )
        calculated_amount = round(float(purchase_order.total) * float(percentage_monthly) / 100.0, 2)
        fixed_amount = None
    else:
        if fixed_amount is None or fixed_amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="fixedAmount debe ser mayor a cero para el modo fixed.",
            )
        calculated_amount = round(float(fixed_amount), 2)
        percentage_monthly = None

    model = FinanceLateFeeModel(
        id=f"flate_{uuid4()}",
        purchase_order_id=payload.purchaseOrderId,
        mode=mode,
        percentage_monthly=percentage_monthly,
        fixed_amount=fixed_amount,
        calculated_amount=calculated_amount,
        concept=payload.concept,
        created_by=current_user.id,
        created_at=datetime.utcnow(),
    )
    session.add(model)

    log_audit_event(
        session,
        action="finance_late_fee_create",
        entity_type="finance_late_fee",
        entity_id=model.id,
        metadata={"purchaseOrderId": model.purchase_order_id, "calculatedAmount": model.calculated_amount, "mode": mode},
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(model)

    return {"data": _serialize_late_fee(model), "meta": {"source": "api"}}
