from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..reporting import build_report_payload, report_pdf_base64
from ..security import AuthenticatedUser, Permission, get_current_user, get_db, has_permission

router = APIRouter(prefix="/reports", tags=["reports"])

SUPPORTED_REPORT_TYPES = {
    "movement-history",
    "finanzas",
    "purchase-orders",
    "inventory-movements",
    # Backward-compatible aliases:
    "audit-log",
    "payments",
}


def _ensure_report_permission(current_user: AuthenticatedUser, report_type: str) -> None:
    normalized = report_type.strip().lower()

    if normalized in {"movement-history", "audit-log"}:
        if not has_permission(current_user.role, Permission.MONITORING_VIEW.value):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions for monitoring report.")
        return

    if normalized == "inventory-movements":
        if not has_permission(current_user.role, Permission.INVENTORY_VIEW.value):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions for inventory report.")
        return

    if normalized in {"finanzas", "payments"}:
        if not has_permission(current_user.role, Permission.FINANCE_VIEW.value):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions for finance report.")
        return

    if not has_permission(current_user.role, Permission.REPORT_VIEW.value):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions for reports.")


def _filters_from_query(
    *,
    startDate: date | None,
    endDate: date | None,
    userId: str | None,
    supplierId: str | None,
    status_value: str | None,
    method: str | None,
    entity: str | None,
    createdBy: str | None,
    action: str | None,
) -> dict:
    return {
        "startDate": startDate.isoformat() if startDate else None,
        "endDate": endDate.isoformat() if endDate else None,
        "userId": userId,
        "supplierId": supplierId,
        "status": status_value,
        "method": method,
        "entity": entity,
        "createdBy": createdBy,
        "action": action,
    }


@router.get("/{report_type}")
def get_report_data(
    report_type: str,
    startDate: date | None = Query(default=None),
    endDate: date | None = Query(default=None),
    userId: str | None = Query(default=None),
    supplierId: str | None = Query(default=None),
    status_value: str | None = Query(default=None, alias="status"),
    method: str | None = Query(default=None),
    entity: str | None = Query(default=None),
    createdBy: str | None = Query(default=None),
    action: str | None = Query(default=None),
    current_user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> dict:
    normalized_type = report_type.strip().lower()
    if normalized_type not in SUPPORTED_REPORT_TYPES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")

    _ensure_report_permission(current_user, normalized_type)

    filters = _filters_from_query(
        startDate=startDate,
        endDate=endDate,
        userId=userId,
        supplierId=supplierId,
        status_value=status_value,
        method=method,
        entity=entity,
        createdBy=createdBy,
        action=action,
    )

    payload = build_report_payload(session, normalized_type, filters)
    return {
        "data": {
            "title": payload.title,
            "reportType": payload.report_type,
            "columns": [{"key": column.key, "label": column.label} for column in payload.columns],
            "rows": payload.rows,
            "totals": payload.totals,
            "filters": payload.filters,
        },
        "meta": {"source": "api"},
    }


@router.post("/{report_type}/pdf")
def download_report_pdf(
    report_type: str,
    payload: dict | None = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
    session: Session = Depends(get_db),
) -> dict:
    normalized_type = report_type.strip().lower()
    if normalized_type not in SUPPORTED_REPORT_TYPES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")

    _ensure_report_permission(current_user, normalized_type)

    filters = dict(payload or {})
    report, content_base64 = report_pdf_base64(session, normalized_type, filters)
    filename = f"{normalized_type}_{date.today().isoformat()}.pdf"

    return {
        "data": {
            "filename": filename,
            "mimeType": "application/pdf",
            "contentBase64": content_base64,
            "rowCount": len(report.rows),
            "totals": report.totals,
            "title": report.title,
        },
        "meta": {"source": "api"},
    }
