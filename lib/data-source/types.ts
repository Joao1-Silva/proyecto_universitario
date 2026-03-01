import type { Category, Supplier } from "@/lib/api-types"

export type DataMode = "LOCAL" | "API"

export interface SupplierInput {
  name: string
  rif: string
  email: string
  phoneCountryCode: string
  phoneNumber: string
  categoryIds: string[]
  responsible: string
  isActive?: boolean
  creditDays: number
}

export interface SupplierUpdateInput extends Partial<SupplierInput> {
  status?: Supplier["status"]
  isActive?: boolean
  balance?: number
}

export interface DataSource {
  readonly mode: DataMode
  listSuppliers: () => Promise<Supplier[]>
  createSupplier: (input: SupplierInput) => Promise<Supplier>
  updateSupplier: (supplierId: string, input: SupplierUpdateInput) => Promise<Supplier>
  deleteSupplier: (supplierId: string) => Promise<void>
  listCategories: () => Promise<Category[]>
  createCategory: (name: string) => Promise<Category>
}
