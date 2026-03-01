import type { Category, Supplier } from "@/lib/api-types"
import { createApiClient } from "@/lib/api-client"

import type { DataSource, SupplierInput, SupplierUpdateInput } from "./types"

const apiClient = createApiClient({
  timeoutMs: 2500,
  retries: 1,
})

const asSupplierArray = (payload: unknown): Supplier[] => {
  if (typeof payload !== "object" || payload === null) return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data as Supplier[]
}

const asSupplier = (payload: unknown): Supplier | null => {
  if (typeof payload !== "object" || payload === null) return null
  const data = (payload as { data?: unknown }).data
  if (typeof data !== "object" || data === null) return null
  return data as Supplier
}

const asCategoryArray = (payload: unknown): Category[] => {
  if (typeof payload !== "object" || payload === null) return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data as Category[]
}

const asCategory = (payload: unknown): Category | null => {
  if (typeof payload !== "object" || payload === null) return null
  const data = (payload as { data?: unknown }).data
  if (typeof data !== "object" || data === null) return null
  return data as Category
}

const readError = (error?: string) => error ?? "API request failed."

export const apiDataSource: DataSource = {
  mode: "API",

  async listSuppliers() {
    const result = await apiClient.request<unknown>("GET", "/suppliers")
    if (!result.ok) {
      throw new Error(readError(result.error))
    }
    return asSupplierArray(result.data)
  },

  async createSupplier(input: SupplierInput) {
    const result = await apiClient.request<unknown>("POST", "/suppliers", input)
    if (!result.ok) {
      throw new Error(readError(result.error))
    }
    const supplier = asSupplier(result.data)
    if (!supplier) {
      throw new Error("API returned invalid supplier payload.")
    }
    return supplier
  },

  async updateSupplier(supplierId: string, input: SupplierUpdateInput) {
    const result = await apiClient.request<unknown>("PUT", `/suppliers/${supplierId}`, input)
    if (!result.ok) {
      throw new Error(readError(result.error))
    }
    const supplier = asSupplier(result.data)
    if (!supplier) {
      throw new Error("API returned invalid supplier payload.")
    }
    return supplier
  },

  async deleteSupplier(supplierId: string) {
    const result = await apiClient.request<unknown>("DELETE", `/suppliers/${supplierId}`)
    if (!result.ok) {
      throw new Error(readError(result.error))
    }
  },

  async listCategories() {
    const result = await apiClient.request<unknown>("GET", "/categories")
    if (!result.ok) {
      throw new Error(readError(result.error))
    }
    return asCategoryArray(result.data)
  },

  async createCategory(name: string) {
    const result = await apiClient.request<unknown>("POST", "/categories", { name })
    if (!result.ok) {
      throw new Error(readError(result.error))
    }
    const category = asCategory(result.data)
    if (!category) {
      throw new Error("API returned invalid category payload.")
    }
    return category
  },
}
