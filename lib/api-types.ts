// API Response Types and Contracts

export interface ApiResponse<T> {
  data: T
  message?: string
  error?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

// User & Auth
export type CanonicalRole = "superadmin" | "finanzas" | "procura"
export type LegacyRole = "admin" | "finance"

export interface User {
  id: string
  email: string
  name: string
  role: CanonicalRole | LegacyRole
  createdAt: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  token: string
  user: User
}

export interface SecurityQuestion {
  id: number
  questionText: string
  active: boolean
}

export interface UserSecurityQuestionInput {
  questionId: number
  answer: string
}

export interface PasswordRecoveryQuestion {
  questionId: number
  questionText: string
}

// Supplier
export interface Supplier {
  id: string
  name: string
  rif: string
  email: string
  phoneCountryCode?: string
  phoneNumber?: string
  phoneE164?: string
  // Legacy compatibility
  phone?: string
  categoryIds: string[]
  responsible: string
  isActive?: boolean
  status?: "active" | "inactive"
  creditDays: number
  balance: number
  createdAt: string
}

export interface CreateSupplierRequest {
  name: string
  rif: string
  email: string
  phoneCountryCode?: string
  phoneNumber?: string
  phoneE164?: string
  phone?: string
  categoryIds: string[]
  responsible: string
  isActive?: boolean
  creditDays: number
}

// Category
export interface Category {
  id: string
  name: string
  description?: string
}

// Legacy services catalog kept for compatibility with local store seed data.
export interface Service {
  id: string
  name: string
  vatRate: number
}

// Product / Catalog
export interface Product {
  id: string
  categoryId: string
  name: string
  description?: string
  unit: string
  isTypical: boolean
  isActive: boolean
  createdAt: string
  createdBy?: string
}

// Price lists
export interface PriceList {
  id: string
  name: string
  validFrom: string
  validTo?: string | null
  supplierId?: string | null
  currency: string
  isActive: boolean
  createdBy: string
  createdAt: string
  updatedAt?: string | null
  itemCount?: number
}

export interface PriceListItem {
  id: string
  priceListId: string
  productId: string
  unit: string
  price: number
  createdAt: string
  updatedAt?: string | null
}

// Purchase Order
export type PurchaseOrderStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "certified"
  | "received"
  // Legacy compatibility
  | "sent"
  | "paid"
  | "overdue"
  | "closed"
  | "canceled"

export interface PurchaseOrderItem {
  id: string
  description: string
  quantity: number
  unit?: string
  unitPrice: number
  total: number
  productId?: string
  categoryId?: string
  removedBySuperadmin?: boolean
  removedBySuperadminReason?: string
  // Legacy compatibility
  isService?: boolean
  appliesIva?: boolean
  serviceId?: string
  typeItem?: "product" | "service"
}

export interface PurchaseOrder {
  id: string
  orderNumber: string
  supplierId: string
  supplierName: string
  date: string
  status: PurchaseOrderStatus
  items: PurchaseOrderItem[]
  subtotal: number
  tax: number
  total: number
  reason?: string
  rejectionReason?: string
  approvedBy?: string
  approvedAt?: string
  rejectedBy?: string
  rejectedAt?: string
  submittedAt?: string
  certifiedAt?: string
  receivedAt?: string
  createdBy: string
  createdAt: string
  // Legacy compatibility
  paymentType?: "credit" | "cash"
  cancellationReason?: string
  canceledAt?: string
}

export interface CreatePurchaseOrderRequest {
  supplierId: string
  date: string
  items: Omit<PurchaseOrderItem, "id" | "total">[]
  reason?: string
}

// Movement monitoring
export interface MovementHistoryEvent {
  id: string
  createdAt: string
  userId: string
  userName: string
  role: string
  eventType: string
  action: string
  entityType: string
  entityId: string
  detail: Record<string, unknown>
  result: "OK" | "Error"
  errorMessage?: string
}

// Inventory
export interface InventoryItem {
  id: string
  productId: string
  stock: number
  location?: string
  assetType: string
  updatedAt: string
}

export interface InventoryMovement {
  id: string
  type: "IN" | "OUT"
  productId: string
  qty: number
  departmentId?: string | null
  reason?: string | null
  purchaseOrderId?: string | null
  createdBy: string
  createdAt: string
}

export interface Department {
  id: string
  name: string
  isActive: boolean
  createdAt?: string
  updatedAt?: string
}

// Finance module
export interface FinancePayment {
  id: string
  purchaseOrderId: string
  amount: number
  currency: string
  paymentType: "contado" | "credito"
  paymentMode: string
  reference?: string
  concept?: string
  createdBy: string
  createdAt: string
}

export interface FinanceInstallment {
  id: string
  purchaseOrderId: string
  financePaymentId?: string | null
  amount: number
  currency: string
  concept?: string
  createdBy: string
  createdAt: string
}

export interface FinanceBalanceSummary {
  purchaseOrderId: string
  orderNumber: string
  supplierName: string
  totalAmount: number
  paidAmount: number
  remainingAmount: number
  status: "pending" | "partial" | "paid"
  currency: "USD"
}

export interface FinanceLateFee {
  id: string
  purchaseOrderId: string
  mode: "percentage" | "fixed"
  percentageMonthly?: number | null
  fixedAmount?: number | null
  calculatedAmount: number
  concept?: string
  createdBy: string
  createdAt: string
}

export interface FinanceReceipt {
  id: string
  receiptNumber: string
  purchaseOrderId: string
  financePaymentId?: string | null
  amount: number
  currency: string
  generatedPdfPath?: string | null
  createdBy: string
  createdAt: string
  pdfBase64?: string
}

// Legacy modules (kept for compatibility while old pages exist)
export interface Invoice {
  id: string
  invoiceNumber: string
  purchaseOrderId: string
  supplierId: string
  supplierName: string
  issueDate: string
  dueDate: string
  status: "pending" | "partial" | "paid"
  amount: number
  paidAmount: number
  balance: number
  createdAt: string
}

export interface Payment {
  id: string
  paymentNumber: string
  invoiceId: string
  invoiceNumber: string
  supplierId: string
  supplierName: string
  date: string
  amount: number
  method: "transfer" | "check" | "cash"
  reference: string
  status: "pending" | "completed" | "cancelled"
  proofUrl?: string
  reason?: string
  notes?: string
  createdBy: string
  createdAt: string
}

export interface BankTransaction {
  id: string
  date: string
  description: string
  amount: number
  reference: string
  status: "unmatched" | "matched" | "ignored"
  matchedPaymentId?: string
}

export interface ReconciliationMatch {
  bankTransactionId: string
  paymentId: string
}

export interface AuditLog {
  id: string
  userId: string
  userName: string
  role?: string
  action: string
  entity: string
  entityId: string
  changes: Record<string, any>
  timestamp: string
  ipAddress: string
}

export interface DashboardKPIs {
  totalOutstanding: number
  totalOverdue: number
  monthlyPayments: number
  criticalSuppliers: number
  upcomingPayments: {
    next7Days: number
    next15Days: number
    next30Days: number
  }
}

export interface CompanySettings {
  name: string
  rif: string
  address: string
  phone: string
  email: string
  logo?: string
}

export interface LateFeeSettings {
  enabled: boolean
  percentage: number
  graceDays: number
}
