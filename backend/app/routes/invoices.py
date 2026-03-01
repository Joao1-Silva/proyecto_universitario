from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select

from ..audit import log_audit_event
from ..db import get_session_factory
from ..finance_crud import create_invoice, get_invoice, list_invoices
from ..models import PaymentModel
from ..schemas import InvoiceCreate
from ..security import AuthenticatedUser, Permission, require_permissions

router = APIRouter(prefix="/invoices", tags=["invoices"])


def _get_session_factory():
    session_factory = get_session_factory()
    if session_factory is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database session factory is unavailable.",
        )
    return session_factory


@router.get("")
def list_invoices_route(
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=20, ge=1, le=100),
    q: str | None = Query(default=None),
    supplierId: str | None = Query(default=None),
    status_value: str | None = Query(default=None, alias="status"),
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.INVOICE_VIEW)),
) -> dict:
    session_factory = _get_session_factory()
    with session_factory() as session:
        paged = list_invoices(
            session,
            page=page,
            page_size=pageSize,
            search=q,
            supplier_id=supplierId,
            status=status_value,
        )
        return {
            "data": paged.data,
            "pagination": {
                "page": paged.pagination.page,
                "pageSize": paged.pagination.page_size,
                "total": paged.pagination.total,
                "totalPages": paged.pagination.total_pages,
            },
            "meta": {"source": "api"},
        }


@router.get("/{invoice_id}")
def get_invoice_route(
    invoice_id: str,
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.INVOICE_VIEW)),
) -> dict:
    session_factory = _get_session_factory()
    with session_factory() as session:
        invoice = get_invoice(session, invoice_id)
        if invoice is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found.")

        payment_rows = session.execute(
            select(PaymentModel).where(PaymentModel.invoice_id == invoice_id).order_by(PaymentModel.date.asc())
        ).scalars().all()
        payments = [
            {
                "id": payment.id,
                "paymentNumber": payment.payment_number,
                "date": payment.date,
                "amount": payment.amount,
                "method": payment.method,
                "reference": payment.reference,
                "reason": payment.notes,
                "createdBy": payment.created_by,
            }
            for payment in payment_rows
        ]

        return {"data": {**invoice, "payments": payments}, "meta": {"source": "api"}}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_invoice_route(
    payload: InvoiceCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.INVOICE_CREATE)),
) -> dict:
    session_factory = _get_session_factory()
    with session_factory() as session:
        try:
            invoice = create_invoice(session, payload, created_by=current_user.name)
        except ValueError as error:
            message = str(error)
            if "not found" in message.lower():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message) from error
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=message) from error
        log_audit_event(
            session,
            action="invoice_create",
            entity_type="invoice",
            entity_id=invoice["id"],
            metadata={"invoiceNumber": invoice["invoiceNumber"], "amount": invoice["amount"]},
            request=request,
            user=current_user,
        )
        session.commit()
        return {"data": invoice, "meta": {"source": "api"}}
