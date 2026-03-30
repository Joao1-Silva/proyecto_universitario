from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from datetime import date, datetime, time
from io import BytesIO
from typing import Literal
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.pagesizes import landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
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
    width_weight: float = 1.0
    align: Literal["left", "center", "right"] = "left"


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
        title="Histórico de movimientos",
        report_type="movement-history",
        columns=[
            ReportColumn("timestamp", "Fecha/Hora", width_weight=1.1, align="center"),
            ReportColumn("user", "Usuario", width_weight=1.2),
            ReportColumn("role", "Rol", width_weight=0.8, align="center"),
            ReportColumn("action", "Acción", width_weight=1.15),
            ReportColumn("entity", "Entidad", width_weight=0.95),
            ReportColumn("entityId", "ID", width_weight=1.15),
            ReportColumn("result", "Resultado", width_weight=0.8, align="center"),
            ReportColumn("detail", "Detalle", width_weight=2.4),
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
                    ReportColumn("type", "Tipo", width_weight=0.8, align="center"),
                    ReportColumn("number", "Documento", width_weight=1.45),
                    ReportColumn("purchaseOrder", "OC", width_weight=1.15),
                    ReportColumn("amount", "Monto", width_weight=0.9, align="right"),
                    ReportColumn("currency", "Moneda", width_weight=0.65, align="center"),
                    ReportColumn("date", "Fecha", width_weight=0.9, align="center"),
                    ReportColumn("user", "Usuario", width_weight=1.45),
                ],
                rows=rows,
                totals={"registros": 0, "montoTotal": 0},
                filters=filters,
            )
        query = query.where(FinancePaymentModel.purchase_order_id.in_(po_ids))

    payments = session.execute(query).scalars().all()
    installments = session.execute(select(FinanceInstallmentModel)).scalars().all()
    late_fees = session.execute(select(FinanceLateFeeModel)).scalars().all()
    allowed_purchase_order_ids = set(po_ids) if filters.get("supplierId") else None

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
        if installment.finance_payment_id:
            continue
        if allowed_purchase_order_ids is not None and installment.purchase_order_id not in allowed_purchase_order_ids:
            continue
        if start and installment.created_at < start:
            continue
        if end and installment.created_at > end:
            continue
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
        if allowed_purchase_order_ids is not None and late_fee.purchase_order_id not in allowed_purchase_order_ids:
            continue
        if start and late_fee.created_at < start:
            continue
        if end and late_fee.created_at > end:
            continue
        rows.append(
            {
                "type": "Mora",
                "number": late_fee.id,
                "purchaseOrder": late_fee.purchase_order_id,
                "amount": round(float(late_fee.calculated_amount), 2),
                "currency": "USD",
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
            ReportColumn("type", "Tipo", width_weight=0.8, align="center"),
            ReportColumn("number", "Documento", width_weight=1.45),
            ReportColumn("purchaseOrder", "OC", width_weight=1.15),
            ReportColumn("amount", "Monto", width_weight=0.9, align="right"),
            ReportColumn("currency", "Moneda", width_weight=0.65, align="center"),
            ReportColumn("date", "Fecha", width_weight=0.9, align="center"),
            ReportColumn("user", "Usuario", width_weight=1.45),
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
        title="Reporte de Órdenes de Compra",
        report_type="purchase-orders",
        columns=[
            ReportColumn("orderNumber", "OC", width_weight=1.0),
            ReportColumn("date", "Fecha", width_weight=0.9, align="center"),
            ReportColumn("supplier", "Proveedor", width_weight=1.8),
            ReportColumn("status", "Estatus", width_weight=0.95, align="center"),
            ReportColumn("total", "Total", width_weight=0.95, align="right"),
            ReportColumn("user", "Usuario", width_weight=1.4),
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
            ReportColumn("date", "Fecha", width_weight=1.1, align="center"),
            ReportColumn("type", "Tipo", width_weight=0.7, align="center"),
            ReportColumn("productId", "Producto", width_weight=1.35),
            ReportColumn("qty", "Cantidad", width_weight=0.8, align="right"),
            ReportColumn("departmentId", "Departamento", width_weight=1.15),
            ReportColumn("purchaseOrderId", "OC", width_weight=1.1),
            ReportColumn("reason", "Motivo", width_weight=1.75),
            ReportColumn("user", "Usuario", width_weight=1.3),
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
    return "SYMBIOS"


def _humanize_key(value: str) -> str:
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", value.replace("_", " "))
    return spaced.strip().title()


def _format_number(value: object | None) -> str:
    try:
        return f"{float(value):,.2f}"
    except (TypeError, ValueError):
        return _normalize_text(value) or "—"


def _format_total_value(key: str, value: object | None) -> str:
    normalized_key = key.lower()
    if any(token in normalized_key for token in {"monto", "total"}):
        return f"USD {_format_number(value)}"
    if any(token in normalized_key for token in {"cantidad", "qty"}):
        return _format_number(value)
    return _normalize_text(value) or "—"


def _format_row_value(row: dict, column: ReportColumn) -> str:
    value = row.get(column.key, "")
    if column.key in {"amount", "total"}:
        currency = _normalize_text(row.get("currency")) or "USD"
        return f"{currency} {_format_number(value)}"
    if column.key == "qty":
        return _format_number(value)
    if column.key in {"status", "type", "result"}:
        return _normalize_text(value).title() or "—"
    return _normalize_text(value) or "—"


def _wrap_pdf_text(value: object | None) -> str:
    text = escape(_normalize_text(value).replace("\n", " "))
    if not text:
        return "—"
    for token in ("_", "-", "/", ".", "@", ":"):
        text = text.replace(token, f"{token}&#8203;")
    text = text.replace(", ", ",&#8203; ")
    return text


def _build_pdf_styles() -> dict[str, ParagraphStyle]:
    base_styles = getSampleStyleSheet()
    return {
        "section": ParagraphStyle(
            "ReportSection",
            parent=base_styles["Heading4"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=12,
            textColor=colors.HexColor("#0F172A"),
            spaceAfter=6,
        ),
        "meta": ParagraphStyle(
            "ReportMeta",
            parent=base_styles["BodyText"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=10,
            textColor=colors.HexColor("#475569"),
        ),
        "summaryLabel": ParagraphStyle(
            "SummaryLabel",
            parent=base_styles["BodyText"],
            fontName="Helvetica",
            fontSize=7.5,
            leading=9,
            textColor=colors.HexColor("#64748B"),
        ),
        "summaryValue": ParagraphStyle(
            "SummaryValue",
            parent=base_styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=13,
            textColor=colors.HexColor("#0F172A"),
        ),
        "tableHeader": ParagraphStyle(
            "TableHeader",
            parent=base_styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=7.5,
            leading=9,
            textColor=colors.white,
            alignment=TA_CENTER,
        ),
        "tableBodyLeft": ParagraphStyle(
            "TableBodyLeft",
            parent=base_styles["BodyText"],
            fontName="Helvetica",
            fontSize=7.5,
            leading=9,
            textColor=colors.HexColor("#0F172A"),
            alignment=TA_LEFT,
        ),
        "tableBodyCenter": ParagraphStyle(
            "TableBodyCenter",
            parent=base_styles["BodyText"],
            fontName="Helvetica",
            fontSize=7.5,
            leading=9,
            textColor=colors.HexColor("#0F172A"),
            alignment=TA_CENTER,
        ),
        "tableBodyRight": ParagraphStyle(
            "TableBodyRight",
            parent=base_styles["BodyText"],
            fontName="Helvetica",
            fontSize=7.5,
            leading=9,
            textColor=colors.HexColor("#0F172A"),
            alignment=TA_RIGHT,
        ),
        "tableEmpty": ParagraphStyle(
            "TableEmpty",
            parent=base_styles["BodyText"],
            fontName="Helvetica-Oblique",
            fontSize=8.5,
            leading=10,
            textColor=colors.HexColor("#64748B"),
            alignment=TA_CENTER,
        ),
    }


def _column_widths(payload: ReportPayload, available_width: float) -> list[float]:
    total_weight = sum(max(column.width_weight, 0.2) for column in payload.columns) or 1.0
    return [available_width * (max(column.width_weight, 0.2) / total_weight) for column in payload.columns]


def _page_size_for_payload(payload: ReportPayload) -> tuple[float, float]:
    if payload.report_type in {"movement-history", "finanzas", "purchase-orders", "inventory-movements"}:
        return landscape(A4)
    return A4


def build_report_pdf_bytes(session: Session, payload: ReportPayload) -> bytes:
    company = _company_name(session)
    buffer = BytesIO()
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
    page_size = _page_size_for_payload(payload)
    styles = _build_pdf_styles()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=page_size,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=34 * mm,
        bottomMargin=18 * mm,
        title=payload.title,
        author=company,
    )

    available_width = page_size[0] - doc.leftMargin - doc.rightMargin
    story: list = []

    story.append(Paragraph(f"Generado: <b>{escape(generated_at)}</b>", styles["meta"]))
    story.append(Spacer(1, 3 * mm))

    story.append(Paragraph("Filtros aplicados", styles["section"]))
    filter_items = [(key, value) for key, value in payload.filters.items() if _normalize_text(value)]
    if not filter_items:
        filter_rows = [[Paragraph("Sin filtros", styles["meta"])]]
        filter_table = Table(filter_rows, colWidths=[available_width])
        filter_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                    ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#CBD5E1")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
    else:
        filter_rows = [
            [
                Paragraph(escape(_humanize_key(key)), styles["summaryLabel"]),
                Paragraph(_wrap_pdf_text(value), styles["meta"]),
            ]
            for key, value in filter_items
        ]
        filter_table = Table(filter_rows, colWidths=[available_width * 0.26, available_width * 0.74])
        filter_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                    ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#CBD5E1")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
    story.append(filter_table)
    story.append(Spacer(1, 4 * mm))

    story.append(Paragraph("Resumen", styles["section"]))
    total_columns = min(max(len(payload.totals), 1), 3)
    summary_cells = []
    for key, value in payload.totals.items():
        summary_cells.append(
            Table(
                [
                    [Paragraph(escape(_humanize_key(key)), styles["summaryLabel"])],
                    [Paragraph(escape(_format_total_value(key, value)), styles["summaryValue"])],
                ],
                colWidths=[(available_width / total_columns) - 12],
            )
        )
    while len(summary_cells) % total_columns != 0:
        summary_cells.append("")
    summary_rows = [summary_cells[index : index + total_columns] for index in range(0, len(summary_cells), total_columns)]
    summary_table = Table(summary_rows, colWidths=[available_width / total_columns] * total_columns)
    summary_table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#CBD5E1")),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(summary_table)
    story.append(Spacer(1, 5 * mm))

    header_row = [Paragraph(escape(column.label.upper()), styles["tableHeader"]) for column in payload.columns]
    body_rows = []
    for row in payload.rows:
        cells = []
        for column in payload.columns:
            style_key = {
                "left": "tableBodyLeft",
                "center": "tableBodyCenter",
                "right": "tableBodyRight",
            }[column.align]
            cells.append(Paragraph(_wrap_pdf_text(_format_row_value(row, column)), styles[style_key]))
        body_rows.append(cells)
    if not body_rows:
        body_rows = [[Paragraph("Sin registros para los filtros seleccionados.", styles["tableEmpty"])] + [""] * (len(payload.columns) - 1)]

    data_table = Table(
        [header_row, *body_rows],
        colWidths=_column_widths(payload, available_width),
        repeatRows=1,
        hAlign="LEFT",
    )
    table_style = TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#CBD5E1")),
            ("INNERGRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#E2E8F0")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]
    )
    if not payload.rows:
        table_style.add("SPAN", (0, 1), (-1, 1))
        table_style.add("ALIGN", (0, 1), (-1, 1), "CENTER")
    data_table.setStyle(table_style)
    story.append(data_table)

    def draw_page_chrome(current_canvas, _doc) -> None:
        current_canvas.saveState()
        page_width, page_height = _doc.pagesize
        left_x = _doc.leftMargin
        right_x = page_width - _doc.rightMargin
        top_y = page_height - 12 * mm
        bottom_y = 8 * mm

        current_canvas.setFillColor(colors.HexColor("#0F172A"))
        current_canvas.setFont("Helvetica-Bold", 13)
        current_canvas.drawString(left_x, top_y, company[:120])
        current_canvas.setFont("Helvetica-Bold", 16)
        current_canvas.drawString(left_x, top_y - 6 * mm, payload.title)
        current_canvas.setFillColor(colors.HexColor("#475569"))
        current_canvas.setFont("Helvetica", 8.5)
        current_canvas.drawString(left_x, top_y - 11 * mm, f"Tipo: {payload.report_type}")
        current_canvas.drawRightString(right_x, top_y - 11 * mm, f"Página {current_canvas.getPageNumber()}")
        current_canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
        current_canvas.line(left_x, top_y - 13.5 * mm, right_x, top_y - 13.5 * mm)

        current_canvas.line(left_x, bottom_y + 4 * mm, right_x, bottom_y + 4 * mm)
        current_canvas.setFillColor(colors.HexColor("#64748B"))
        current_canvas.setFont("Helvetica", 7.5)
        current_canvas.drawString(left_x, bottom_y, f"Generado: {generated_at}")
        current_canvas.drawRightString(right_x, bottom_y, company[:60])
        current_canvas.restoreState()

    doc.build(story, onFirstPage=draw_page_chrome, onLaterPages=draw_page_chrome)
    return buffer.getvalue()


def report_pdf_base64(session: Session, report_type: str, filters: dict | None = None) -> tuple[ReportPayload, str]:
    payload = build_report_payload(session, report_type, filters)
    pdf_bytes = build_report_pdf_bytes(session, payload)
    encoded = base64.b64encode(pdf_bytes).decode("ascii")
    return payload, encoded
