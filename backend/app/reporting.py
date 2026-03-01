from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import date, datetime, time
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (
    CompanySettingsModel,
    FinanceInstallmentModel,
    FinanceLateFeeModel,
    FinancePaymentModel,
    InventoryMovementModel,
    MovementHistoryModel,
    PurchaseOrderModel,
)


@dataclass
class ReportColumn:
    key: str
    label: str


@dataclass
class ReportPayload:
    title: str
    report_type: str
    columns: list[ReportColumn]
    rows: list[dict]
    totals: dict
    filters: dict


def _normalize_text(value: object | None) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _parse_datetime(value: object | None, *, end_of_day: bool) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time.max if end_of_day else time.min)

    raw = _normalize_text(value)
    if not raw:
        return None
    if len(raw) == 10:
        parsed_date = date.fromisoformat(raw)
        return datetime.combine(parsed_date, time.max if end_of_day else time.min)
    normalized = raw.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    return parsed


def _coalesce_filters(filters: dict | None) -> dict:
    return dict(filters or {})


def _build_movement_history_report(session: Session, filters: dict) -> ReportPayload:
    query = select(MovementHistoryModel).order_by(MovementHistoryModel.created_at.desc())

    start = _parse_datetime(filters.get("startDate"), end_of_day=False)
    end = _parse_datetime(filters.get("endDate"), end_of_day=True)
    if start:
        query = query.where(MovementHistoryModel.created_at >= start)
    if end:
        query = query.where(MovementHistoryModel.created_at <= end)

    if filters.get("userId"):
        query = query.where(MovementHistoryModel.user_id == _normalize_text(filters.get("userId")))
    if filters.get("entity"):
        query = query.where(MovementHistoryModel.entity_type == _normalize_text(filters.get("entity")).lower())
    if filters.get("action"):
        query = query.where(MovementHistoryModel.action == _normalize_text(filters.get("action")).lower())

    records = session.execute(query).scalars().all()
    rows = [
        {
            "timestamp": item.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            "user": item.user_name,
            "role": item.role,
            "action": item.action,
            "entity": item.entity_type,
            "entityId": item.entity_id,
            "result": item.result,
            "detail": json.dumps(item.detail_json or {}, ensure_ascii=False, default=str),
        }
        for item in records
    ]

    return ReportPayload(
        title="Historico de movimientos",
        report_type="movement-history",
        columns=[
            ReportColumn("timestamp", "Fecha/Hora"),
            ReportColumn("user", "Usuario"),
            ReportColumn("role", "Rol"),
            ReportColumn("action", "Accion"),
            ReportColumn("entity", "Entidad"),
            ReportColumn("entityId", "ID"),
            ReportColumn("result", "Resultado"),
            ReportColumn("detail", "Detalle"),
        ],
        rows=rows,
        totals={"registros": len(rows)},
        filters=filters,
    )


def _build_finance_report(session: Session, filters: dict) -> ReportPayload:
    query = select(FinancePaymentModel).order_by(FinancePaymentModel.created_at.desc())

    start = _parse_datetime(filters.get("startDate"), end_of_day=False)
    end = _parse_datetime(filters.get("endDate"), end_of_day=True)
    if start:
        query = query.where(FinancePaymentModel.created_at >= start)
    if end:
        query = query.where(FinancePaymentModel.created_at <= end)
    if filters.get("supplierId"):
        # finance entries are PO-bound; supplier filter must resolve from PO table.
        supplier_id = _normalize_text(filters.get("supplierId"))
        po_ids = [
            po.id
            for po in session.execute(
                select(PurchaseOrderModel).where(PurchaseOrderModel.supplier_id == supplier_id)
            ).scalars().all()
        ]
        if not po_ids:
            rows: list[dict] = []
            return ReportPayload(
                title="Reporte de Finanzas",
                report_type="finanzas",
                columns=[
                    ReportColumn("type", "Tipo"),
                    ReportColumn("number", "Numero"),
                    ReportColumn("purchaseOrder", "OC"),
                    ReportColumn("amount", "Monto"),
                    ReportColumn("currency", "Moneda"),
                    ReportColumn("date", "Fecha"),
                    ReportColumn("user", "Usuario"),
                ],
                rows=rows,
                totals={"registros": 0, "montoTotal": 0},
                filters=filters,
            )
        query = query.where(FinancePaymentModel.purchase_order_id.in_(po_ids))

    payments = session.execute(query).scalars().all()
    installments = session.execute(select(FinanceInstallmentModel)).scalars().all()
    late_fees = session.execute(select(FinanceLateFeeModel)).scalars().all()

    rows: list[dict] = []
    for payment in payments:
        rows.append(
            {
                "type": "Pago",
                "number": payment.id,
                "purchaseOrder": payment.purchase_order_id,
                "amount": round(float(payment.amount), 2),
                "currency": payment.currency,
                "date": payment.created_at.strftime("%Y-%m-%d"),
                "user": payment.created_by,
            }
        )
    for installment in installments:
        rows.append(
            {
                "type": "Abono",
                "number": installment.id,
                "purchaseOrder": installment.purchase_order_id,
                "amount": round(float(installment.amount), 2),
                "currency": installment.currency,
                "date": installment.created_at.strftime("%Y-%m-%d"),
                "user": installment.created_by,
            }
        )
    for late_fee in late_fees:
        rows.append(
            {
                "type": "Mora",
                "number": late_fee.id,
                "purchaseOrder": late_fee.purchase_order_id,
                "amount": round(float(late_fee.calculated_amount), 2),
                "currency": "VES",
                "date": late_fee.created_at.strftime("%Y-%m-%d"),
                "user": late_fee.created_by,
            }
        )
    rows.sort(key=lambda item: item["date"], reverse=True)
    total_amount = round(sum(float(item["amount"]) for item in rows), 2)

    return ReportPayload(
        title="Reporte de Finanzas",
        report_type="finanzas",
        columns=[
            ReportColumn("type", "Tipo"),
            ReportColumn("number", "Numero"),
            ReportColumn("purchaseOrder", "OC"),
            ReportColumn("amount", "Monto"),
            ReportColumn("currency", "Moneda"),
            ReportColumn("date", "Fecha"),
            ReportColumn("user", "Usuario"),
        ],
        rows=rows,
        totals={"registros": len(rows), "montoTotal": total_amount},
        filters=filters,
    )


def _build_purchase_orders_report(session: Session, filters: dict) -> ReportPayload:
    query = select(PurchaseOrderModel).order_by(PurchaseOrderModel.date.desc())

    start = _parse_datetime(filters.get("startDate"), end_of_day=False)
    end = _parse_datetime(filters.get("endDate"), end_of_day=True)
    if start:
        query = query.where(PurchaseOrderModel.date >= start)
    if end:
        query = query.where(PurchaseOrderModel.date <= end)
    if filters.get("supplierId"):
        query = query.where(PurchaseOrderModel.supplier_id == _normalize_text(filters.get("supplierId")))
    if filters.get("status"):
        query = query.where(PurchaseOrderModel.status == _normalize_text(filters.get("status")).lower())

    records = session.execute(query).scalars().all()
    rows = [
        {
            "orderNumber": item.order_number,
            "date": item.date.strftime("%Y-%m-%d"),
            "supplier": item.supplier_name,
            "status": item.status,
            "total": round(float(item.total), 2),
            "user": item.created_by,
        }
        for item in records
    ]

    return ReportPayload(
        title="Reporte de Ordenes de Compra",
        report_type="purchase-orders",
        columns=[
            ReportColumn("orderNumber", "OC"),
            ReportColumn("date", "Fecha"),
            ReportColumn("supplier", "Proveedor"),
            ReportColumn("status", "Estatus"),
            ReportColumn("total", "Total"),
            ReportColumn("user", "Usuario"),
        ],
        rows=rows,
        totals={"registros": len(rows), "totalOrdenes": round(sum(item["total"] for item in rows), 2)},
        filters=filters,
    )


def _build_inventory_movements_report(session: Session, filters: dict) -> ReportPayload:
    query = select(InventoryMovementModel).order_by(InventoryMovementModel.created_at.desc())

    start = _parse_datetime(filters.get("startDate"), end_of_day=False)
    end = _parse_datetime(filters.get("endDate"), end_of_day=True)
    if start:
        query = query.where(InventoryMovementModel.created_at >= start)
    if end:
        query = query.where(InventoryMovementModel.created_at <= end)

    records = session.execute(query).scalars().all()
    rows = [
        {
            "date": item.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            "type": item.type,
            "productId": item.product_id,
            "qty": float(item.qty),
            "departmentId": item.department_id,
            "purchaseOrderId": item.purchase_order_id,
            "reason": item.reason or "",
            "user": item.created_by,
        }
        for item in records
    ]

    return ReportPayload(
        title="Reporte de Movimientos de Inventario",
        report_type="inventory-movements",
        columns=[
            ReportColumn("date", "Fecha"),
            ReportColumn("type", "Tipo"),
            ReportColumn("productId", "Producto"),
            ReportColumn("qty", "Cantidad"),
            ReportColumn("departmentId", "Departamento"),
            ReportColumn("purchaseOrderId", "OC"),
            ReportColumn("reason", "Motivo"),
            ReportColumn("user", "Usuario"),
        ],
        rows=rows,
        totals={"registros": len(rows), "cantidadTotal": round(sum(item["qty"] for item in rows), 2)},
        filters=filters,
    )


def build_report_payload(session: Session, report_type: str, filters: dict | None = None) -> ReportPayload:
    normalized_filters = _coalesce_filters(filters)
    report_key = report_type.strip().lower()

    if report_key in {"audit-log", "movement-history"}:
        return _build_movement_history_report(session, normalized_filters)
    if report_key in {"payments", "finanzas"}:
        return _build_finance_report(session, normalized_filters)
    if report_key == "purchase-orders":
        return _build_purchase_orders_report(session, normalized_filters)
    if report_key == "inventory-movements":
        return _build_inventory_movements_report(session, normalized_filters)

    raise ValueError("Unsupported report type.")


def _company_name(session: Session) -> str:
    settings = session.get(CompanySettingsModel, "default")
    if settings and settings.name.strip():
        return settings.name.strip()
    return "Sistema de Gestion Administrativa de activos industriales en Servicios y Mantenimientos AGUILERA21 C.A."


def build_report_pdf_bytes(session: Session, payload: ReportPayload) -> bytes:
    company = _company_name(session)
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    page_width, page_height = A4

    left_margin = 40
    right_margin = page_width - 40
    top_margin = page_height - 40
    bottom_margin = 40
    row_height = 16
    usable_width = right_margin - left_margin
    column_count = max(len(payload.columns), 1)
    column_width = usable_width / column_count

    def draw_page_header(page_number: int) -> float:
        y = top_margin
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawString(left_margin, y, company[:120])
        y -= 18
        pdf.setFont("Helvetica-Bold", 12)
        pdf.drawString(left_margin, y, payload.title)
        y -= 16
        pdf.setFont("Helvetica", 9)
        pdf.drawString(left_margin, y, f"Generado: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")
        pdf.drawRightString(right_margin, y, f"Pagina {page_number}")
        y -= 14
        filter_text = ", ".join(
            f"{key}={value}" for key, value in payload.filters.items() if _normalize_text(value)
        ) or "Sin filtros"
        pdf.drawString(left_margin, y, f"Filtros: {filter_text[:140]}")
        y -= 18
        pdf.setFont("Helvetica-Bold", 8)
        for index, column in enumerate(payload.columns):
            x = left_margin + (index * column_width)
            pdf.drawString(x + 1, y, column.label[:30])
        y -= 4
        pdf.line(left_margin, y, right_margin, y)
        return y - 10

    page_number = 1
    y = draw_page_header(page_number)

    pdf.setFont("Helvetica", 8)
    for row in payload.rows:
        if y <= bottom_margin + row_height:
            pdf.showPage()
            page_number += 1
            y = draw_page_header(page_number)
            pdf.setFont("Helvetica", 8)

        for index, column in enumerate(payload.columns):
            x = left_margin + (index * column_width)
            value = row.get(column.key, "")
            text_value = _normalize_text(value).replace("\n", " ")
            pdf.drawString(x + 1, y, text_value[:32])
        y -= row_height

    if y <= bottom_margin + 40:
        pdf.showPage()
        page_number += 1
        y = draw_page_header(page_number)
        pdf.setFont("Helvetica", 9)

    pdf.setFont("Helvetica-Bold", 9)
    pdf.line(left_margin, y, right_margin, y)
    y -= 14
    for key, value in payload.totals.items():
        pdf.drawString(left_margin, y, f"{key}: {_normalize_text(value)}")
        y -= 12

    pdf.save()
    return buffer.getvalue()


def report_pdf_base64(session: Session, report_type: str, filters: dict | None = None) -> tuple[ReportPayload, str]:
    payload = build_report_payload(session, report_type, filters)
    pdf_bytes = build_report_pdf_bytes(session, payload)
    encoded = base64.b64encode(pdf_bytes).decode("ascii")
    return payload, encoded
