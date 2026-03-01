import type { Category, Supplier } from "@/lib/api-types"
import { appendAuditLog, createId, loadStore, updateStore } from "@/lib/store"

import type { DataSource, SupplierInput, SupplierUpdateInput } from "./types"

const toSupplier = (input: SupplierInput): Supplier => ({
  id: createId("supplier"),
  name: input.name.trim(),
  rif: input.rif.trim().toUpperCase(),
  email: input.email.trim(),
  phoneCountryCode: input.phoneCountryCode.trim(),
  phoneNumber: input.phoneNumber.trim(),
  phoneE164: `${input.phoneCountryCode.trim()}${input.phoneNumber.replace(/\D/g, "")}`,
  phone: `${input.phoneCountryCode.trim()} ${input.phoneNumber.trim()}`.trim(),
  categoryIds: input.categoryIds,
  responsible: input.responsible.trim(),
  isActive: input.isActive ?? true,
  status: input.isActive === false ? "inactive" : "active",
  creditDays: input.creditDays,
  balance: 0,
  createdAt: new Date().toISOString(),
})

export const localDataSource: DataSource = {
  mode: "LOCAL",

  async listSuppliers() {
    return loadStore().suppliers
  },

  async createSupplier(input) {
    const supplier = toSupplier(input)

    updateStore((storeState) => {
      const next = {
        ...storeState,
        suppliers: [supplier, ...storeState.suppliers],
      }
      return appendAuditLog(next, {
        action: "create",
        entity: "supplier",
        entityId: supplier.id,
        changes: supplier,
      })
    })

    return supplier
  },

  async updateSupplier(supplierId, input) {
    let updatedSupplier: Supplier | null = null

    updateStore((storeState) => {
      const suppliers = storeState.suppliers.map((supplier) => {
        if (supplier.id !== supplierId) return supplier

        updatedSupplier = {
          ...supplier,
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.rif !== undefined ? { rif: input.rif.trim().toUpperCase() } : {}),
          ...(input.email !== undefined ? { email: input.email.trim() } : {}),
          ...(input.phoneCountryCode !== undefined ? { phoneCountryCode: input.phoneCountryCode.trim() } : {}),
          ...(input.phoneNumber !== undefined ? { phoneNumber: input.phoneNumber.trim() } : {}),
          ...(input.categoryIds !== undefined ? { categoryIds: input.categoryIds } : {}),
          ...(input.responsible !== undefined ? { responsible: input.responsible.trim() } : {}),
          ...(input.creditDays !== undefined ? { creditDays: input.creditDays } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.isActive !== undefined
            ? { isActive: input.isActive, status: input.isActive ? "active" : "inactive" }
            : {}),
          ...(input.balance !== undefined ? { balance: input.balance } : {}),
        }
        if (updatedSupplier.phoneCountryCode || updatedSupplier.phoneNumber) {
          updatedSupplier.phone = `${updatedSupplier.phoneCountryCode ?? ""} ${updatedSupplier.phoneNumber ?? ""}`.trim()
          const digits = (updatedSupplier.phoneNumber ?? "").replace(/\D/g, "")
          updatedSupplier.phoneE164 = `${updatedSupplier.phoneCountryCode ?? "+58"}${digits}`
        }
        return updatedSupplier ?? supplier
      })

      if (!updatedSupplier) {
        return storeState
      }

      const next = { ...storeState, suppliers }
      return appendAuditLog(next, {
        action: "update",
        entity: "supplier",
        entityId: supplierId,
        changes: input,
      })
    })

    if (!updatedSupplier) {
      throw new Error("Supplier not found.")
    }

    return updatedSupplier
  },

  async deleteSupplier(supplierId) {
    let deleted = false

    updateStore((storeState) => {
      const target = storeState.suppliers.find((supplier) => supplier.id === supplierId)
      if (!target) return storeState

      deleted = true
      const next = {
        ...storeState,
        suppliers: storeState.suppliers.filter((supplier) => supplier.id !== supplierId),
      }

      return appendAuditLog(next, {
        action: "delete",
        entity: "supplier",
        entityId: supplierId,
        changes: { name: target.name },
      })
    })

    if (!deleted) {
      throw new Error("Supplier not found.")
    }
  },

  async listCategories() {
    return loadStore().categories
  },

  async createCategory(name) {
    const trimmed = name.trim()
    if (!trimmed) {
      throw new Error("Category name is required.")
    }

    const existing = loadStore().categories.find((category) => category.name.toLowerCase() === trimmed.toLowerCase())
    if (existing) {
      return existing
    }

    const category: Category = {
      id: createId("cat"),
      name: trimmed,
    }

    updateStore((storeState) => {
      const next = { ...storeState, categories: [...storeState.categories, category] }
      return appendAuditLog(next, {
        action: "create",
        entity: "category",
        entityId: category.id,
        changes: category,
      })
    })

    return category
  },
}
