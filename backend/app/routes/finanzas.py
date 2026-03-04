from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..audit import log_audit_event
from ..models import (
    FinanceInstallmentModel,
    FinanceLateFeeModel,
    FinancePaymentModel,
    PurchaseOrderModel,
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


def _sum_installments_by_order(session: Session) -> dict[str, float]:
    rows = session.execute(
        select(
            FinanceInstallmentModel.purchase_order_id,
            func.coalesce(func.sum(FinanceInstallmentModel.amount), 0.0),
        ).group_by(FinanceInstallmentModel.purchase_order_id)
    ).all()
    return {str(order_id): round(float(total), 2) for order_id, total in rows}


def _build_order_balance_summary(order: PurchaseOrderModel, paid_amount: float) -> dict:
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
    }


def _build_finance_summaries(session: Session, purchase_order_id: str | None = None) -> list[dict]:
    query = select(PurchaseOrderModel).order_by(PurchaseOrderModel.date.desc())
    if purchase_order_id:
        query = query.where(PurchaseOrderModel.id == purchase_order_id)

    orders = session.execute(query).scalars().all()
    if not orders:
        return []

    paid_by_order = _sum_installments_by_order(session)
    return [_build_order_balance_summary(order, paid_by_order.get(order.id, 0.0)) for order in orders]


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
    if payload.amount <= 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="El monto debe ser mayor a 0.")

    _ensure_purchase_order(session, payload.purchaseOrderId)
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

    model = FinancePaymentModel(
        id=f"fpay_{uuid4()}",
        purchase_order_id=payload.purchaseOrderId,
        amount=round(float(payload.amount), 2),
        currency=_normalize_usd_currency(payload.currency),
        payment_type=payment_type,
        payment_mode=payment_mode,
        reference=payload.reference,
        concept=payload.concept,
        created_by=current_user.id,
        created_at=datetime.utcnow(),
    )
    session.add(model)

    log_audit_event(
        session,
        action="finance_payment_create",
        entity_type="finance_payment",
        entity_id=model.id,
        metadata={"purchaseOrderId": model.purchase_order_id, "amount": model.amount, "paymentType": model.payment_type},
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(model)

    return {"data": _serialize_payment(model), "meta": {"source": "api"}}


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
    if payload.financePaymentId:
        payment = session.get(FinancePaymentModel, payload.financePaymentId)
        if payment is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pago financiero no encontrado.")

    paid_by_order = _sum_installments_by_order(session)
    current_paid = paid_by_order.get(purchase_order.id, 0.0)
    current_balance = _build_order_balance_summary(purchase_order, current_paid)

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

    log_audit_event(
        session,
        action="finance_installment_create",
        entity_type="finance_installment",
        entity_id=model.id,
        metadata={"purchaseOrderId": model.purchase_order_id, "amount": model.amount},
        request=request,
        user=current_user,
    )
    session.commit()
    session.refresh(model)

    updated_balance = _build_order_balance_summary(purchase_order, current_paid + amount)
    payload_data = _serialize_installment(model)
    payload_data["balance"] = updated_balance

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
