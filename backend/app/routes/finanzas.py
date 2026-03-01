from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found.")
    return purchase_order


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
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="amount must be > 0.")

    _ensure_purchase_order(session, payload.purchaseOrderId)
    payment_type = payload.paymentType.strip().lower()
    if payment_type not in {"contado", "credito"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="paymentType must be contado or credito.")

    payment_mode = payload.paymentMode.strip()
    if payment_type == "contado" and not payment_mode:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="paymentMode is required for contado payments.")

    model = FinancePaymentModel(
        id=f"fpay_{uuid4()}",
        purchase_order_id=payload.purchaseOrderId,
        amount=round(float(payload.amount), 2),
        currency=payload.currency.strip().upper() or "VES",
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
    if payload.amount <= 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="amount must be > 0.")

    _ensure_purchase_order(session, payload.purchaseOrderId)
    if payload.financePaymentId:
        payment = session.get(FinancePaymentModel, payload.financePaymentId)
        if payment is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="financePaymentId not found.")

    model = FinanceInstallmentModel(
        id=f"fins_{uuid4()}",
        purchase_order_id=payload.purchaseOrderId,
        finance_payment_id=payload.financePaymentId,
        amount=round(float(payload.amount), 2),
        currency=payload.currency.strip().upper() or "VES",
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

    return {"data": _serialize_installment(model), "meta": {"source": "api"}}


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
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="mode must be percentage or fixed.")

    percentage_monthly = payload.percentageMonthly
    fixed_amount = payload.fixedAmount

    if mode == "percentage":
        if percentage_monthly is None or percentage_monthly <= 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="percentageMonthly must be greater than zero for percentage mode.",
            )
        calculated_amount = round(float(purchase_order.total) * float(percentage_monthly) / 100.0, 2)
        fixed_amount = None
    else:
        if fixed_amount is None or fixed_amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="fixedAmount must be greater than zero for fixed mode.",
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
