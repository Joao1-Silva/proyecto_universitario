"use client"

import { useEffect, useState } from "react"
import type {
  AuditLog,
  BankTransaction,
  CompanySettings,
  Category,
  Invoice,
  LateFeeSettings,
  Payment,
  PurchaseOrder,
  PurchaseOrderItem,
  Service,
  Supplier,
  User,
} from "./api-types"
import { dateInputToIso } from "./date-utils"
import { mockCategories, mockServices } from "./mock-data"
import { calculatePurchaseOrderTotals, normalizePurchaseOrderItem } from "./purchase-order-utils"

export type StoredUser = User & { password: string }

export interface Session {
  userId: string
  token: string
  createdAt: string
  user?: User
}

export interface AppStore {
  version: 1
  categories: Category[]
  services: Service[]
  suppliers: Supplier[]
  purchaseOrders: PurchaseOrder[]
  invoices: Invoice[]
  payments: Payment[]
  bankTransactions: BankTransaction[]
  auditLogs: AuditLog[]
  users: StoredUser[]
  companySettings: CompanySettings
  lateFees: LateFeeSettings
  session: Session | null
}

const STORAGE_KEY = "ppd:store:v2"

const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  name: "",
  rif: "",
  address: "",
  phone: "",
  email: "",
}

const DEFAULT_LATE_FEES: LateFeeSettings = {
  enabled: false,
  percentage: 0,
  graceDays: 0,
}

const DEFAULT_STORE: AppStore = {
  version: 1,
  categories: mockCategories,
  services: mockServices,
  suppliers: [],
  purchaseOrders: [],
  invoices: [],
  payments: [],
  bankTransactions: [],
  auditLogs: [],
  users: [],
  companySettings: DEFAULT_COMPANY_SETTINGS,
  lateFees: DEFAULT_LATE_FEES,
  session: null,
}

const listeners = new Set<() => void>()
let memoryStore: AppStore | null = null

const clone = <T,>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

const isBrowser = () => typeof window !== "undefined"

const ensureNumber = (value: number) => (Number.isFinite(value) ? value : 0)
const normalizeRole = (value?: string): User["role"] => {
  const normalized = value?.toLowerCase().trim() ?? ""
  if (normalized === "superadmin" || normalized === "admin" || normalized === "gerente") return "superadmin"
  if (normalized === "finanzas" || normalized === "finance" || normalized === "administradora") return "finanzas"
  if (normalized === "procura" || normalized === "viewer" || normalized === "compras") return "procura"
  return "procura"
}

const normalizeStore = (store: AppStore): AppStore => {
  const categories = [...store.categories]
  const categoryByName = new Map(categories.map((category) => [category.name.toLowerCase(), category.id]))

  const suppliers = store.suppliers.map((supplier) => {
    const legacyCategory = (supplier as Supplier & { category?: string }).category
    const legacyRif = (supplier as Supplier & { rfc?: string }).rfc
    const rif = supplier.rif ?? legacyRif ?? ""
    const legacyPhone = (supplier as Supplier & { phone?: string }).phone ?? ""
    const fallbackCountryCode = supplier.phoneCountryCode ?? (legacyPhone.startsWith("+") ? legacyPhone.split(" ")[0] : "+58")
    const fallbackPhoneNumber = supplier.phoneNumber ?? legacyPhone.replace(/[^\d]/g, "")
    let categoryIds = supplier.categoryIds ?? []

    if (categoryIds.length === 0 && legacyCategory) {
      const normalizedName = legacyCategory.trim()
      let id = categoryByName.get(normalizedName.toLowerCase())
      if (!id) {
        id = createId("cat")
        categories.push({ id, name: normalizedName })
        categoryByName.set(normalizedName.toLowerCase(), id)
      }
      categoryIds = [id]
    }

    return {
      ...supplier,
      rif,
      phoneCountryCode: fallbackCountryCode,
      phoneNumber: fallbackPhoneNumber,
      phoneE164: supplier.phoneE164 ?? `${fallbackCountryCode}${fallbackPhoneNumber}`,
      phone: `${fallbackCountryCode} ${fallbackPhoneNumber}`.trim(),
      categoryIds,
      responsible: supplier.responsible ?? "",
      isActive: supplier.isActive ?? supplier.status !== "inactive",
      status: supplier.status ?? (supplier.isActive === false ? "inactive" : "active"),
    }
  })

  const invoices = store.invoices.map((invoice) => {
    const amount = ensureNumber(invoice.amount)
    const paidAmount = Math.min(ensureNumber(invoice.paidAmount), amount)
    const balance = Math.max(amount - paidAmount, 0)
    const status: Invoice["status"] = balance === 0 ? "paid" : paidAmount > 0 ? "partial" : "pending"
    return {
      ...invoice,
      amount,
      paidAmount,
      balance,
      status,
    }
  })

  const payments = store.payments.map((payment) => {
    const reason = (payment.reason ?? payment.notes)?.trim() || undefined
    return {
      ...payment,
      reason,
      notes: reason,
    }
  })

  const purchaseOrders = store.purchaseOrders.map((order) => {
    const legacyReason = (order as PurchaseOrder & { notes?: string }).notes
    const rawStatus = ((order as PurchaseOrder & { status?: string }).status ?? "draft") as string
    const allowedStatuses: PurchaseOrder["status"][] = [
      "draft",
      "pending",
      "approved",
      "rejected",
      "certified",
      "received",
      "sent",
      "paid",
      "overdue",
      "closed",
      "canceled",
    ]
    const safeStatus: PurchaseOrder["status"] = allowedStatuses.includes(rawStatus as PurchaseOrder["status"])
      ? (rawStatus as PurchaseOrder["status"])
      : "draft"
    const items = order.items.map((item) => {
      const quantity = ensureNumber(item.quantity)
      const unitPrice = ensureNumber(item.unitPrice)
      const total = ensureNumber(item.total) || quantity * unitPrice
      const inferredService = item.isService ?? order.tax > 0
      return normalizePurchaseOrderItem({
        ...item,
        id: item.id ?? createId("poi_legacy"),
        quantity,
        unitPrice,
        total,
        isService: inferredService,
        appliesIva: item.appliesIva ?? inferredService,
      }) as PurchaseOrderItem
    })
    const totals = calculatePurchaseOrderTotals(items)

    return {
      ...order,
      status: safeStatus,
      items: totals.normalizedItems as PurchaseOrderItem[],
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      reason: order.reason ?? legacyReason,
    }
  })

  const supplierBalances = invoices.reduce<Record<string, number>>((acc, invoice) => {
    acc[invoice.supplierId] = (acc[invoice.supplierId] ?? 0) + invoice.balance
    return acc
  }, {})

  const normalizedSuppliers = suppliers.map((supplier) => ({
    ...supplier,
    balance: supplierBalances[supplier.id] ?? 0,
  }))

  const users = store.users.map((user) => ({
    ...user,
    role: normalizeRole(user.role),
  }))

  const session =
    store.session && store.session.user
      ? { ...store.session, user: { ...store.session.user, role: normalizeRole(store.session.user.role) } }
      : store.session

  const companySettings = {
    ...store.companySettings,
    rif: store.companySettings.rif ?? (store.companySettings as CompanySettings & { rfc?: string }).rfc ?? "",
  }

  return {
    ...store,
    categories,
    suppliers: normalizedSuppliers,
    purchaseOrders,
    invoices,
    payments,
    users,
    session,
    companySettings,
  }
}

const emit = () => {
  listeners.forEach((listener) => listener())
}

export const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const loadStore = (): AppStore => {
  if (!isBrowser()) {
    return DEFAULT_STORE
  }

  if (memoryStore) {
    return memoryStore
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      memoryStore = normalizeStore(clone(DEFAULT_STORE))
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryStore))
      return memoryStore
    }

    const parsed = JSON.parse(raw) as Partial<AppStore>
    const parsedCompanySettings = (parsed.companySettings ?? {}) as Partial<CompanySettings> & { rfc?: string }
    const seededUsers = (parsed.users ?? []).map((user) => ({
      ...user,
      password: (user as StoredUser).password ?? "",
    }))
    const merged: AppStore = {
      ...clone(DEFAULT_STORE),
      ...parsed,
      categories: parsed.categories ?? DEFAULT_STORE.categories,
      services: parsed.services ?? DEFAULT_STORE.services,
      suppliers: DEFAULT_STORE.suppliers,
      purchaseOrders: DEFAULT_STORE.purchaseOrders,
      invoices: DEFAULT_STORE.invoices,
      payments: DEFAULT_STORE.payments,
      bankTransactions: DEFAULT_STORE.bankTransactions,
      auditLogs: DEFAULT_STORE.auditLogs,
      users: seededUsers,
      companySettings: {
        ...DEFAULT_COMPANY_SETTINGS,
        ...parsedCompanySettings,
        rif: parsedCompanySettings.rif ?? parsedCompanySettings.rfc ?? DEFAULT_COMPANY_SETTINGS.rif,
      },
      lateFees: {
        ...DEFAULT_LATE_FEES,
        ...parsed.lateFees,
      },
      session: parsed.session ?? null,
      version: 1,
    }

    memoryStore = normalizeStore(merged)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryStore))
    return memoryStore
  } catch (error) {
    memoryStore = normalizeStore(clone(DEFAULT_STORE))
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryStore))
    return memoryStore
  }
}

export const saveStore = (store: AppStore) => {
  if (!isBrowser()) return
  memoryStore = store
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  emit()
}

export const updateStore = (updater: (store: AppStore) => AppStore) => {
  const current = loadStore()
  const next = normalizeStore(updater(clone(current)))
  saveStore(next)
  return next
}

export const useAppStore = () => {
  const [store, setStore] = useState<AppStore>(() => DEFAULT_STORE)

  useEffect(() => {
    if (!isBrowser()) return
    setStore(loadStore())
    return subscribe(() => setStore(loadStore()))
  }, [])

  return store
}

export const getPublicUsers = (store: AppStore): User[] =>
  store.users.map(({ password: _password, ...user }) => user)

export const getCurrentUser = (store: AppStore): User | null => {
  if (!store.session) return null
  if (store.session.user) return store.session.user
  const user = store.users.find((item) => item.id === store.session?.userId)
  if (!user) return null
  const { password: _password, ...publicUser } = user
  return publicUser
}

const generateToken = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export const signIn = (email: string, password: string) => {
  const store = loadStore()
  const user = store.users.find((item) => item.email.toLowerCase() === email.toLowerCase())
  if (!user) {
    return { ok: false, error: "Usuario no encontrado." }
  }
  if (user.password !== password) {
    return { ok: false, error: "Contraseña incorrecta." }
  }

  const session: Session = {
    userId: user.id,
    token: generateToken(),
    createdAt: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    },
  }

  saveStore({ ...store, session })
  const { password: _password, ...publicUser } = user
  return { ok: true, user: publicUser }
}

export const signInWithSession = (user: User, token: string) => {
  const store = loadStore()
  const existingUsers = [...store.users]
  const existingIndex = existingUsers.findIndex((item) => item.id === user.id)

  if (existingIndex >= 0) {
    existingUsers[existingIndex] = {
      ...existingUsers[existingIndex],
      ...user,
    }
  } else {
    existingUsers.unshift({
      ...user,
      password: "",
    })
  }

  const session: Session = {
    userId: user.id,
    token,
    createdAt: new Date().toISOString(),
    user,
  }

  saveStore({ ...store, users: existingUsers, session })
  return { ok: true, user }
}

export const signOut = () => {
  const store = loadStore()
  saveStore({ ...store, session: null })
}

export const createId = (prefix = "") => {
  const id = generateToken()
  return prefix ? `${prefix}_${id}` : id
}

export const appendAuditLog = (
  store: AppStore,
  entry: Omit<AuditLog, "id" | "timestamp" | "userId" | "userName" | "ipAddress">,
): AppStore => {
  const currentUser = getCurrentUser(store)
  const log: AuditLog = {
    id: createId("audit"),
    userId: currentUser?.id ?? "system",
    userName: currentUser?.name ?? "Sistema",
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    changes: entry.changes,
    timestamp: new Date().toISOString(),
    ipAddress: "127.0.0.1",
  }

  return {
    ...store,
    auditLogs: [log, ...store.auditLogs],
  }
}

export const getNextSequence = (values: string[], prefix: string, digits = 3) => {
  const numbers = values
    .filter((value) => value.startsWith(prefix))
    .map((value) => value.replace(prefix, ""))
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value))

  const next = (numbers.length ? Math.max(...numbers) : 0) + 1
  return `${prefix}${String(next).padStart(digits, "0")}`
}

export interface PaymentInput {
  invoiceId: string
  date: string
  amount: number
  method: "transfer" | "check" | "cash"
  reference: string
  reason?: string
  notes?: string
  proofUrl?: string
}

export type ApplyPaymentResult =
  | { ok: true; payment: Payment }
  | { ok: false; error: string }

export const applyPayment = (input: PaymentInput): ApplyPaymentResult => {
  const store = loadStore()
  const invoice = store.invoices.find((item) => item.id === input.invoiceId)

  if (!invoice) {
    return { ok: false, error: "Factura no encontrada." }
  }
  if (input.amount <= 0) {
    return { ok: false, error: "El monto debe ser mayor a cero." }
  }
  if (input.amount > invoice.balance) {
    return { ok: false, error: "El monto supera el saldo pendiente de la factura." }
  }
  if (!input.reference.trim()) {
    return { ok: false, error: "Ingresa la referencia del pago." }
  }

  let paymentDateIso = ""
  let paymentDate = new Date()
  try {
    paymentDateIso = dateInputToIso(input.date)
    paymentDate = new Date(paymentDateIso)
    if (Number.isNaN(paymentDate.getTime())) {
      throw new Error("Invalid date.")
    }
  } catch (_error) {
    return { ok: false, error: "Ingresa una fecha de pago valida." }
  }

  const year = paymentDate.getUTCFullYear()
  const paymentNumber = getNextSequence(
    store.payments.map((payment) => payment.paymentNumber),
    `PAG-${year}-`,
  )
  const currentUser = getCurrentUser(store)
  let createdPayment: Payment | null = null

  updateStore((storeState) => {
    const updatedInvoices = storeState.invoices.map((item) => {
      if (item.id !== invoice.id) return item
      const paidAmount = item.paidAmount + input.amount
      const balance = Math.max(item.amount - paidAmount, 0)
      const status: Invoice["status"] = balance === 0 ? "paid" : "partial"
      return { ...item, paidAmount, balance, status }
    })

    createdPayment = {
      id: createId("pay"),
      paymentNumber,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      supplierId: invoice.supplierId,
      supplierName: invoice.supplierName,
      date: paymentDateIso,
      amount: input.amount,
      method: input.method,
      reference: input.reference.trim(),
      status: "completed",
      proofUrl: input.proofUrl,
      reason: input.reason?.trim() || input.notes?.trim() || undefined,
      notes: input.reason?.trim() || input.notes?.trim() || undefined,
      createdBy: currentUser?.name ?? "Sistema",
      createdAt: new Date().toISOString(),
    }

    const next = {
      ...storeState,
      payments: createdPayment ? [createdPayment, ...storeState.payments] : storeState.payments,
      invoices: updatedInvoices,
    }

    return appendAuditLog(next, {
      action: "create",
      entity: "payment",
      entityId: createdPayment?.id ?? "payment",
      changes: createdPayment ?? {},
    })
  })

  if (!createdPayment) {
    return { ok: false, error: "No se pudo registrar el pago." }
  }

  return { ok: true, payment: createdPayment }
}

