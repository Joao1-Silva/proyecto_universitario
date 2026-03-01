import type { PurchaseOrder, PurchaseOrderItem, Supplier } from "@/lib/api-types"

export const PURCHASE_ORDER_VAT_RATE = 0.16

export type PurchaseOrderItemDraft = Omit<PurchaseOrderItem, "id"> & { id?: string }

export const normalizePurchaseOrderItem = <T extends PurchaseOrderItemDraft>(item: T): T => {
  const quantity = Number.isFinite(item.quantity) ? item.quantity : 0
  const unitPrice = Number.isFinite(item.unitPrice) ? item.unitPrice : 0
  const isService = item.typeItem ? item.typeItem === "service" : Boolean(item.isService)
  const appliesIva = isService ? item.appliesIva ?? true : false
  const total = quantity * unitPrice

  return {
    ...item,
    quantity,
    unitPrice,
    total,
    isService,
    appliesIva,
    typeItem: isService ? "service" : "product",
  } as T
}

export const calculatePurchaseOrderTotals = (items: PurchaseOrderItemDraft[]) => {
  const normalized = items.map(normalizePurchaseOrderItem)
  const subtotal = normalized.reduce((sum, item) => sum + item.total, 0)
  const tax = normalized.reduce((sum, item) => {
    if (!item.isService || !item.appliesIva) return sum
    return sum + item.total * PURCHASE_ORDER_VAT_RATE
  }, 0)
  const total = subtotal + tax
  return {
    subtotal,
    tax,
    total,
    normalizedItems: normalized,
  }
}

export const resolveOrderCategoryIds = (
  order: PurchaseOrder,
  supplier: Supplier | undefined,
): string[] => {
  const lineCategoryIds = order.items
    .map((item) => item.categoryId?.trim() ?? "")
    .filter((item): item is string => item.length > 0)

  if (lineCategoryIds.length > 0) {
    return Array.from(new Set(lineCategoryIds))
  }

  return supplier?.categoryIds ?? []
}
