from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from ..audit import log_audit_event
from ..db import get_session_factory
from ..finance_crud import create_payment, get_payment, list_payments
from ..schemas import PaymentCreate
from ..security import AuthenticatedUser, Permission, require_permissions

router = APIRouter(prefix="/payments", tags=["payments"])


def _get_session_factory():
    session_factory = get_session_factory()
    if session_factory is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database session factory is unavailable.",
        )
    return session_factory


@router.get("")
def list_payments_route(
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=20, ge=1, le=100),
    q: str | None = Query(default=None),
    invoice: str | None = Query(default=None),
    supplier: str | None = Query(default=None),
    supplierId: str | None = Query(default=None),
    status_value: str | None = Query(default=None, alias="status"),
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.PAYMENT_VIEW)),
) -> dict:
    session_factory = _get_session_factory()
    with session_factory() as session:
        paged = list_payments(
            session,
            page=page,
            page_size=pageSize,
            search=q,
            invoice_query=invoice,
            supplier_query=supplier,
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


@router.get("/{payment_id}")
def get_payment_route(
    payment_id: str,
    _current_user: AuthenticatedUser = Depends(require_permissions(Permission.PAYMENT_VIEW)),
) -> dict:
    session_factory = _get_session_factory()
    with session_factory() as session:
        payment = get_payment(session, payment_id)
        if payment is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found.")
        return {"data": payment, "meta": {"source": "api"}}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_payment_route(
    payload: PaymentCreate,
    request: Request,
    current_user: AuthenticatedUser = Depends(require_permissions(Permission.PAYMENT_CREATE)),
) -> dict:
    session_factory = _get_session_factory()
    with session_factory() as session:
        try:
            normalized_payload = payload.model_copy(update={"createdBy": current_user.name})
            payment = create_payment(session, normalized_payload)
        except ValueError as error:
            message = str(error)
            if "not found" in message.lower():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message) from error
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=message) from error
        log_audit_event(
            session,
            action="payment_create",
            entity_type="payment",
            entity_id=payment["id"],
            metadata={"paymentNumber": payment["paymentNumber"], "amount": payment["amount"]},
            request=request,
            user=current_user,
        )
        session.commit()
        return {"data": payment, "meta": {"source": "api"}}
