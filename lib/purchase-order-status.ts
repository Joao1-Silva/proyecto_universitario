import type { PurchaseOrder } from "@/lib/api-types"

export type PurchaseOrderStatus = PurchaseOrder["status"]

interface PurchaseOrderStatusVisual {
  label: string
  badgeClassName: string
  rowClassName: string
  detailClassName: string
}

const STATUS_DEFAULT: PurchaseOrderStatusVisual = {
  label: "Borrador",
  badgeClassName: "bg-slate-100 text-slate-700 border-slate-200",
  rowClassName: "bg-slate-50/40",
  detailClassName: "border-slate-200 bg-slate-50/60",
}

export const PURCHASE_ORDER_STATUS_CONFIG: Record<PurchaseOrderStatus, PurchaseOrderStatusVisual> = {
  draft: STATUS_DEFAULT,
  pending: {
    label: "Pendiente",
    badgeClassName: "bg-yellow-100 text-yellow-800 border-yellow-200",
    rowClassName: "bg-yellow-50/40",
    detailClassName: "border-yellow-200 bg-yellow-50/60",
  },
  approved: {
    label: "Aprobada",
    badgeClassName: "bg-blue-100 text-blue-700 border-blue-200",
    rowClassName: "bg-blue-50/35",
    detailClassName: "border-blue-200 bg-blue-50/60",
  },
  rejected: {
    label: "Rechazada",
    badgeClassName: "bg-red-100 text-red-700 border-red-200",
    rowClassName: "bg-red-50/35",
    detailClassName: "border-red-200 bg-red-50/60",
  },
  certified: {
    label: "Certificada",
    badgeClassName: "bg-indigo-100 text-indigo-700 border-indigo-200",
    rowClassName: "bg-indigo-50/35",
    detailClassName: "border-indigo-200 bg-indigo-50/60",
  },
  received: {
    label: "Recibida",
    badgeClassName: "bg-cyan-100 text-cyan-700 border-cyan-200",
    rowClassName: "bg-cyan-50/35",
    detailClassName: "border-cyan-200 bg-cyan-50/60",
  },
  // Legacy statuses kept for compatibility.
  sent: {
    label: "Enviada",
    badgeClassName: "bg-amber-100 text-amber-700 border-amber-200",
    rowClassName: "bg-amber-50/40",
    detailClassName: "border-amber-200 bg-amber-50/60",
  },
  paid: {
    label: "Pagada",
    badgeClassName: "bg-green-100 text-green-700 border-green-200",
    rowClassName: "bg-green-50/35",
    detailClassName: "border-green-200 bg-green-50/60",
  },
  overdue: {
    label: "Vencida",
    badgeClassName: "bg-red-100 text-red-700 border-red-200",
    rowClassName: "bg-red-50/35",
    detailClassName: "border-red-200 bg-red-50/60",
  },
  closed: {
    label: "Cerrada",
    badgeClassName: "bg-emerald-100 text-emerald-700 border-emerald-200",
    rowClassName: "bg-emerald-50/35",
    detailClassName: "border-emerald-200 bg-emerald-50/60",
  },
  canceled: {
    label: "Cancelada",
    badgeClassName: "bg-zinc-200 text-zinc-800 border-zinc-300",
    rowClassName: "bg-zinc-100/50",
    detailClassName: "border-zinc-300 bg-zinc-100/50",
  },
}

export const getPurchaseOrderStatusConfig = (status: string): PurchaseOrderStatusVisual => {
  return PURCHASE_ORDER_STATUS_CONFIG[status as PurchaseOrderStatus] ?? STATUS_DEFAULT
}
