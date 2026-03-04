import type {
  Category,
  CompanySettings,
  Department,
  FinanceBalanceSummary,
  FinanceInstallment,
  FinancePayment,
  InventoryItem,
  InventoryMovement,
  MovementHistoryEvent,
  Product,
  PurchaseOrder,
  PurchaseOrderItem,
  SecurityQuestion,
  Supplier,
  User,
} from "@/lib/api-types"

interface MockApiResult<T = unknown> {
  ok: boolean
  statusCode: number
  data?: T
  error?: string
}

type CanonicalRole = "superadmin" | "finanzas" | "procura"

interface MockSecurityAnswer {
  questionId: number
  answer: string
}

interface MockUserRecord extends User {
  role: CanonicalRole
  password: string
  securityQuestions: MockSecurityAnswer[]
}

interface MockAuthSession {
  token: string
  userId: string
  createdAt: string
}

interface MockRecoverySession {
  token: string
  userId: string
  questionIds: number[]
  expiresAt: string
}

interface MockResetSession {
  token: string
  userId: string
  expiresAt: string
}

interface MockApiState {
  version: 1
  categories: Category[]
  suppliers: Supplier[]
  products: Product[]
  purchaseOrders: PurchaseOrder[]
  inventoryItems: InventoryItem[]
  inventoryMovements: InventoryMovement[]
  departments: Department[]
  financePayments: FinancePayment[]
  financeInstallments: FinanceInstallment[]
  monitoring: MovementHistoryEvent[]
  users: MockUserRecord[]
  sessions: MockAuthSession[]
  recoverySessions: MockRecoverySession[]
  resetSessions: MockResetSession[]
  securityQuestions: SecurityQuestion[]
  companySettings: CompanySettings
}

const MOCK_STORAGE_KEY = "ppd:mock-api:v1"
const MOCK_SESSION_RECOVERY_MINUTES = 10
const MOCK_SESSION_RESET_MINUTES = 10
const PURCHASE_ORDER_VAT_RATE = 0.16

const EMAIL_REGEX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i
const RIF_REGEX = /^J-\d{8}-\d$/
const E164_REGEX = /^\+[1-9]\d{7,14}$/

const normalizeCurrencyUsd = (value: unknown): string | null => {
  const normalized = String(value ?? "USD").trim().toUpperCase() || "USD"
  if (normalized !== "USD") return null
  return "USD"
}

let memoryState: MockApiState | null = null

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const deepClone = <T,>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

const normalizeRole = (value: unknown): CanonicalRole => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (normalized === "superadmin" || normalized === "admin" || normalized === "gerente") return "superadmin"
  if (normalized === "finanzas" || normalized === "finance" || normalized === "administradora") return "finanzas"
  return "procura"
}

const asIso = (daysAgo = 0): string => new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()

const createId = (prefix: string): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

const normalizeRif = (value: string): string => {
  const raw = value.trim().toUpperCase()
  const digits = raw.replace(/\D/g, "").slice(0, 9).padStart(9, "0")
  return `J-${digits.slice(0, 8)}-${digits[8]}`
}

const normalizePhoneCountryCode = (value: string): string => {
  const raw = value.trim()
  if (!raw) return "+58"
  return raw.startsWith("+") ? raw : `+${raw}`
}

const normalizePhoneNumber = (value: string): string => value.replace(/\D/g, "")

const sanitizePhoneE164 = (value?: string): string => {
  const raw = (value ?? "").trim()
  if (!raw) return ""
  const sanitized = raw.replace(/[()\s\-\.]/g, "")
  if (!sanitized) return ""
  if (sanitized.includes("+") && !sanitized.startsWith("+")) return sanitized
  if (!sanitized.startsWith("+")) return `+${sanitized}`
  return sanitized
}

const normalizePhoneE164 = (countryCode: string, phoneNumber: string, explicit?: string): string => {
  const direct = sanitizePhoneE164(explicit)
  if (direct) return direct
  const normalizedPhone = normalizePhoneNumber(phoneNumber)
  if (!normalizedPhone) return ""
  return `${normalizePhoneCountryCode(countryCode)}${normalizePhoneNumber(phoneNumber)}`
}

const parseDateInput = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value !== "string") return null
  const raw = value.trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T12:00:00.000Z`)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

const sortByCreatedAtDesc = <T extends { createdAt: string }>(rows: T[]): T[] =>
  [...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt))

const seedState = (): MockApiState => {
  const categories: Category[] = [
    { id: "cat-epp-cabeza-cuerpo", name: "Protección Personal (EPP - Cabeza y Cuerpo)" },
    { id: "cat-extremidades", name: "Protección de Extremidades (Manos y Pies)" },
    { id: "cat-senalizacion-vial", name: "Señalización y Seguridad Vial" },
    { id: "cat-escritura-papeleria", name: "Consumibles de Escritura y Papeleria" },
    { id: "cat-impresion-tecnologia", name: "Insumos de Impresión y Tecnología" },
  ]

  const suppliers: Supplier[] = [
    {
      id: "supplier_seed_001",
      name: "Aguilera Industrial Supply C.A.",
      rif: "J-41234567-8",
      email: "contacto@aguilera-supply.com",
      phoneCountryCode: "+58",
      phoneNumber: "4121234567",
      phoneE164: "+584121234567",
      phone: "+58 4121234567",
      categoryIds: ["cat-epp-cabeza-cuerpo"],
      responsible: "Luis Aguilera",
      isActive: true,
      status: "active",
      creditDays: 30,
      balance: 0,
      createdAt: asIso(240),
    },
    {
      id: "supplier_seed_002",
      name: "Andes Safety Tools S.A.",
      rif: "J-42345678-9",
      email: "ventas@andessafety.com",
      phoneCountryCode: "+58",
      phoneNumber: "4149876543",
      phoneE164: "+584149876543",
      phone: "+58 4149876543",
      categoryIds: ["cat-extremidades"],
      responsible: "Mariana Toro",
      isActive: true,
      status: "active",
      creditDays: 15,
      balance: 0,
      createdAt: asIso(180),
    },
  ]

  const products: Product[] = [
    {
      id: "prod_001",
      categoryId: "cat-epp-cabeza-cuerpo",
      name: "Casco de seguridad industrial",
      description: "Casco dieléctrico clase E",
      unit: "unidad",
      isTypical: true,
      isActive: true,
      createdBy: "seed",
      createdAt: asIso(300),
    },
    {
      id: "prod_006",
      categoryId: "cat-extremidades",
      name: "Guantes anticorte nivel 5",
      description: "Fibra de alto desempeño",
      unit: "par",
      isTypical: true,
      isActive: true,
      createdBy: "seed",
      createdAt: asIso(300),
    },
    {
      id: "prod_011",
      categoryId: "cat-senalizacion-vial",
      name: "Cono de seguridad 75cm",
      description: "PVC reflectivo",
      unit: "unidad",
      isTypical: true,
      isActive: true,
      createdBy: "seed",
      createdAt: asIso(300),
    },
    {
      id: "prod_016",
      categoryId: "cat-escritura-papeleria",
      name: "Resma carta 75g",
      description: "Papel multipropósito",
      unit: "paquete",
      isTypical: true,
      isActive: true,
      createdBy: "seed",
      createdAt: asIso(300),
    },
    {
      id: "prod_021",
      categoryId: "cat-impresion-tecnologia",
      name: "Tóner láser negro",
      description: "Compatible HP/Canon",
      unit: "unidad",
      isTypical: true,
      isActive: true,
      createdBy: "seed",
      createdAt: asIso(300),
    },
  ]

  const purchaseOrderItems: PurchaseOrderItem[] = [
    {
      id: "poi_seed_001",
      productId: "prod_001",
      description: "Casco de seguridad industrial",
      quantity: 10,
      unit: "unidad",
      unitPrice: 65,
      total: 650,
      categoryId: "cat-epp-cabeza-cuerpo",
      removedBySuperadmin: false,
      removedBySuperadminReason: undefined,
    },
    {
      id: "poi_seed_002",
      productId: "prod_006",
      description: "Guantes anticorte nivel 5",
      quantity: 12,
      unit: "par",
      unitPrice: 28,
      total: 336,
      categoryId: "cat-extremidades",
      removedBySuperadmin: false,
      removedBySuperadminReason: undefined,
    },
  ]

  const subtotal = purchaseOrderItems.reduce((sum, item) => sum + item.total, 0)
  const tax = Number((subtotal * PURCHASE_ORDER_VAT_RATE).toFixed(2))
  const total = Number((subtotal + tax).toFixed(2))

  const purchaseOrders: PurchaseOrder[] = [
    {
      id: "po_seed_001",
      orderNumber: "OC-2026-0001",
      supplierId: "supplier_seed_001",
      supplierName: "Aguilera Industrial Supply C.A.",
      date: "2026-02-10T12:00:00.000Z",
      status: "approved",
      items: purchaseOrderItems,
      subtotal,
      tax,
      total,
      reason: "Reposición de stock",
      approvedBy: "Juan Perez",
      approvedAt: "2026-02-11T10:30:00.000Z",
      submittedAt: "2026-02-10T14:10:00.000Z",
      createdBy: "Juan Perez",
      createdAt: "2026-02-10T12:00:00.000Z",
    },
  ]

  const inventoryItems: InventoryItem[] = [
    {
      id: "inv_seed_001",
      productId: "prod_001",
      stock: 20,
      location: "Rack A1",
      assetType: "cat-epp-cabeza-cuerpo",
      updatedAt: asIso(12),
    },
    {
      id: "inv_seed_002",
      productId: "prod_006",
      stock: 30,
      location: "Rack B1",
      assetType: "cat-extremidades",
      updatedAt: asIso(12),
    },
  ]

  const inventoryMovements: InventoryMovement[] = [
    {
      id: "invm_seed_001",
      type: "IN",
      productId: "prod_001",
      qty: 20,
      departmentId: null,
      reason: "Carga inicial seed",
      purchaseOrderId: null,
      createdBy: "seed",
      createdAt: asIso(13),
    },
  ]

  const departments: Department[] = [
    { id: "dept_operaciones", name: "Operaciones", isActive: true, createdAt: asIso(300), updatedAt: asIso(300) },
    { id: "dept_mantenimiento", name: "Mantenimiento", isActive: true, createdAt: asIso(300), updatedAt: asIso(300) },
    { id: "dept_procura", name: "Compras/Procura", isActive: true, createdAt: asIso(300), updatedAt: asIso(300) },
    { id: "dept_finanzas", name: "Finanzas", isActive: true, createdAt: asIso(300), updatedAt: asIso(300) },
    { id: "dept_almacen", name: "Almacén", isActive: true, createdAt: asIso(300), updatedAt: asIso(300) },
  ]

  const financePayments: FinancePayment[] = [
    {
      id: "fpay_seed_001",
      purchaseOrderId: "po_seed_001",
      amount: 250,
      currency: "USD",
      paymentType: "contado",
      paymentMode: "transferencia",
      reference: "SEED-001",
      concept: "Pago inicial",
      createdBy: "user_superadmin",
      createdAt: asIso(8),
    },
  ]

  const financeInstallments: FinanceInstallment[] = [
    {
      id: "fins_seed_001",
      purchaseOrderId: "po_seed_001",
      financePaymentId: "fpay_seed_001",
      amount: 150,
      currency: "USD",
      concept: "Abono complementario",
      createdBy: "user_superadmin",
      createdAt: asIso(6),
    },
  ]

  const securityQuestions: SecurityQuestion[] = [
    { id: 1, questionText: "¿Cuál es el nombre de tu ciudad de nacimiento?", active: true },
    { id: 2, questionText: "¿Cuál fue tu primer proyecto laboral?", active: true },
    { id: 3, questionText: "¿Cuál es el nombre de tu mascota favorita?", active: true },
    { id: 4, questionText: "¿Cuál es tu película favorita?", active: true },
    { id: 5, questionText: "¿Cuál es tu lugar favorito para vacacionar?", active: true },
    { id: 6, questionText: "¿Cuál fue tu primer automóvil?", active: true },
  ]

  const users: MockUserRecord[] = [
    {
      id: "user_superadmin",
      email: "juan.perez@empresa.com",
      name: "Juan Perez",
      role: "superadmin",
      createdAt: asIso(450),
      password: "Admin123!",
      securityQuestions: [
        { questionId: 1, answer: "Admin123!" },
        { questionId: 2, answer: "SYMBIOS" },
        { questionId: 3, answer: "Operación" },
      ],
    },
    {
      id: "user_finanzas",
      email: "maria.lopez@empresa.com",
      name: "Maria Lopez",
      role: "finanzas",
      createdAt: asIso(440),
      password: "Finance123!",
      securityQuestions: [
        { questionId: 1, answer: "Caracas" },
        { questionId: 2, answer: "ERP" },
        { questionId: 3, answer: "Luna" },
      ],
    },
    {
      id: "user_procura",
      email: "carlos.ruiz@empresa.com",
      name: "Carlos Ruiz",
      role: "procura",
      createdAt: asIso(430),
      password: "Procura123!",
      securityQuestions: [
        { questionId: 1, answer: "Valencia" },
        { questionId: 2, answer: "Compras" },
        { questionId: 3, answer: "Max" },
      ],
    },
  ]

  return {
    version: 1,
    categories,
    suppliers,
    products,
    purchaseOrders,
    inventoryItems,
    inventoryMovements,
    departments,
    financePayments,
    financeInstallments,
    monitoring: [],
    users,
    sessions: [],
    recoverySessions: [],
    resetSessions: [],
    securityQuestions,
    companySettings: {
      name: "SYMBIOS",
      rif: "J-00000000-0",
      address: "Av. Principal, Caracas",
      phone: "+58 2120000000",
      email: "contacto@aguilera21.com",
    },
  }
}

const toPublicUser = (user: MockUserRecord): User => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  createdAt: user.createdAt,
})

const clearExpiredSessions = (state: MockApiState) => {
  const now = Date.now()
  state.recoverySessions = state.recoverySessions.filter((session) => new Date(session.expiresAt).getTime() > now)
  state.resetSessions = state.resetSessions.filter((session) => new Date(session.expiresAt).getTime() > now)
}

const ensureStateShape = (value: unknown): MockApiState | null => {
  if (!isObject(value)) return null
  if (value.version !== 1) return null
  const requiredKeys: Array<keyof MockApiState> = [
    "categories",
    "suppliers",
    "products",
    "purchaseOrders",
    "inventoryItems",
    "inventoryMovements",
    "departments",
    "financePayments",
    "financeInstallments",
    "monitoring",
    "users",
    "sessions",
    "recoverySessions",
    "resetSessions",
    "securityQuestions",
    "companySettings",
  ]
  const hasAllKeys = requiredKeys.every((key) => key in value)
  if (!hasAllKeys) return null
  return value as unknown as MockApiState
}

const loadState = (): MockApiState => {
  if (memoryState) {
    return memoryState
  }
  if (typeof window === "undefined") {
    memoryState = seedState()
    return memoryState
  }
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY)
    if (!raw) {
      memoryState = seedState()
      window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(memoryState))
      return memoryState
    }

    const parsed = JSON.parse(raw) as unknown
    const normalized = ensureStateShape(parsed)
    if (!normalized) {
      memoryState = seedState()
      window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(memoryState))
      return memoryState
    }

    memoryState = normalized
    clearExpiredSessions(memoryState)
    return memoryState
  } catch {
    memoryState = seedState()
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(memoryState))
    }
    return memoryState
  }
}

const saveState = (state: MockApiState) => {
  memoryState = state
  if (typeof window !== "undefined") {
    window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state))
  }
}

const success = <T,>(payload: T, statusCode = 200): MockApiResult<T> => ({
  ok: true,
  statusCode,
  data: payload,
})

const failure = <T,>(statusCode: number, error: string): MockApiResult<T> => ({
  ok: false,
  statusCode,
  error,
})

const wrapData = <T,>(data: T) => ({ data, meta: { source: "api" as const } })

const extractBearerToken = (headers: Record<string, string>): string | null => {
  const direct = headers.Authorization ?? headers.authorization
  if (!direct) return null
  const [scheme, token] = direct.split(" ")
  if (scheme?.toLowerCase() !== "bearer") return null
  const value = token?.trim()
  return value ? value : null
}

const getCurrentUser = (state: MockApiState, headers: Record<string, string>): MockUserRecord | null => {
  const token = extractBearerToken(headers)
  if (!token) return null
  const session = state.sessions.find((item) => item.token === token)
  if (!session) return null
  return state.users.find((item) => item.id === session.userId) ?? null
}

const appendMonitoringEvent = (
  state: MockApiState,
  currentUser: MockUserRecord,
  eventType: string,
  entityType: string,
  entityId: string,
  detail: Record<string, unknown>,
) => {
  const event: MovementHistoryEvent = {
    id: createId("mov"),
    createdAt: new Date().toISOString(),
    userId: currentUser.id,
    userName: currentUser.name,
    role: currentUser.role,
    eventType,
    action: eventType,
    entityType,
    entityId,
    detail,
    result: "OK",
  }
  state.monitoring = [event, ...state.monitoring]
}

const parseBooleanQuery = (value: string | null): boolean => {
  if (!value) return false
  return ["true", "1", "yes"].includes(value.trim().toLowerCase())
}

const filterByDateRange = <T extends { createdAt?: string; date?: string }>(
  rows: T[],
  startDateRaw: string | null,
  endDateRaw: string | null,
): T[] => {
  const startDate = parseDateInput(startDateRaw)
  const endDate = parseDateInput(endDateRaw)
  return rows.filter((row) => {
    const raw = row.createdAt ?? row.date
    if (!raw) return true
    const target = parseDateInput(raw)
    if (!target) return true
    if (startDate && target.getTime() < startDate.getTime()) return false
    if (endDate) {
      const inclusiveEnd = new Date(endDate)
      inclusiveEnd.setUTCHours(23, 59, 59, 999)
      if (target.getTime() > inclusiveEnd.getTime()) return false
    }
    return true
  })
}

const parsePath = (path: string): URL => {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return new URL(path)
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return new URL(`http://mock.local${normalizedPath}`)
}

const validateSupplierPayload = (payload: Record<string, unknown>, mode: "create" | "update"): string | null => {
  const has = (key: string) => key in payload
  const readText = (key: string) => (typeof payload[key] === "string" ? payload[key].trim() : "")

  if (mode === "create") {
    if (readText("name").length < 3) return "El nombre o razón social debe tener al menos 3 caracteres."
    if (!readText("rif")) return "El RIF es obligatorio."
    if (!readText("responsible")) return "El responsable es obligatorio."
  }

  if (has("email") && readText("email") && !EMAIL_REGEX.test(readText("email"))) {
    return "Email inválido."
  }

  if (has("rif") && readText("rif")) {
    const normalized = normalizeRif(readText("rif"))
    if (!RIF_REGEX.test(normalized)) {
      return "RIF inválido. Formato esperado: J-########-#."
    }
  }

  const email = readText("email").toLowerCase()
  const countryCode = normalizePhoneCountryCode(readText("phoneCountryCode") || "+58")
  const phoneNumber = normalizePhoneNumber(readText("phoneNumber"))
  const e164 = normalizePhoneE164(countryCode, phoneNumber, readText("phoneE164") || undefined)
  const e164Digits = e164.replace(/\D/g, "")
  const hasPhone = e164.length > 0
  const hasEmail = email.length > 0

  const contactFieldsProvided =
    mode === "create" || has("email") || has("phoneCountryCode") || has("phoneNumber") || has("phoneE164")

  if (contactFieldsProvided && !hasPhone && !hasEmail) {
    return "Debes registrar al menos un medio de contacto: teléfono o email."
  }

  if (has("phoneCountryCode") || has("phoneNumber") || has("phoneE164")) {
    if (e164Digits.length > 15) {
      return "El teléfono no puede superar 15 dígitos (E.164)."
    }
    if (hasPhone && !E164_REGEX.test(e164)) {
      return "Teléfono inválido. Debe cumplir formato E.164."
    }
  }

  if (has("creditDays")) {
    const creditDays = Number(payload.creditDays)
    if (!Number.isFinite(creditDays) || creditDays < 0) {
      return "creditDays no puede ser negativo."
    }
  }

  return null
}

const normalizeSupplierForCreate = (payload: Record<string, unknown>): Supplier => {
  const name = String(payload.name ?? "").trim()
  const rif = normalizeRif(String(payload.rif ?? ""))
  const email = String(payload.email ?? "").trim().toLowerCase()
  const phoneCountryCode = normalizePhoneCountryCode(String(payload.phoneCountryCode ?? "+58"))
  const phoneNumber = normalizePhoneNumber(String(payload.phoneNumber ?? ""))
  const phoneE164 = normalizePhoneE164(phoneCountryCode, phoneNumber, typeof payload.phoneE164 === "string" ? payload.phoneE164 : undefined)
  const categoryIds = Array.isArray(payload.categoryIds)
    ? payload.categoryIds.map((item) => String(item).trim()).filter((item) => item.length > 0)
    : []
  const isActive = payload.isActive === undefined ? true : Boolean(payload.isActive)
  const creditDaysRaw = Number(payload.creditDays ?? 0)
  const creditDays = Number.isFinite(creditDaysRaw) ? creditDaysRaw : 0
  const balanceRaw = Number(payload.balance ?? 0)
  const balance = Number.isFinite(balanceRaw) ? balanceRaw : 0

  return {
    id: createId("supplier"),
    name,
    rif,
    email,
    phoneCountryCode,
    phoneNumber,
    phoneE164: phoneE164 || undefined,
    phone: phoneNumber ? `${phoneCountryCode} ${phoneNumber}`.trim() : "",
    categoryIds: Array.from(new Set(categoryIds)),
    responsible: String(payload.responsible ?? "").trim(),
    isActive,
    status: isActive ? "active" : "inactive",
    creditDays,
    balance,
    createdAt: new Date().toISOString(),
  }
}

const applySupplierUpdates = (current: Supplier, payload: Record<string, unknown>): Supplier => {
  const next: Supplier = { ...current }
  if ("name" in payload && payload.name !== undefined) next.name = String(payload.name).trim()
  if ("rif" in payload && payload.rif !== undefined) next.rif = normalizeRif(String(payload.rif))
  if ("email" in payload && payload.email !== undefined) next.email = String(payload.email).trim().toLowerCase()
  if ("responsible" in payload && payload.responsible !== undefined) next.responsible = String(payload.responsible).trim()
  if ("creditDays" in payload && payload.creditDays !== undefined) {
    const creditDays = Number(payload.creditDays)
    if (Number.isFinite(creditDays)) next.creditDays = creditDays
  }
  if ("balance" in payload && payload.balance !== undefined) {
    const balance = Number(payload.balance)
    if (Number.isFinite(balance)) next.balance = balance
  }
  if ("categoryIds" in payload && Array.isArray(payload.categoryIds)) {
    next.categoryIds = Array.from(
      new Set(payload.categoryIds.map((item) => String(item).trim()).filter((item) => item.length > 0)),
    )
  }

  const touchesPhone = "phoneCountryCode" in payload || "phoneNumber" in payload || "phoneE164" in payload
  if (touchesPhone) {
    const countryCode = normalizePhoneCountryCode(
      typeof payload.phoneCountryCode === "string" ? payload.phoneCountryCode : next.phoneCountryCode ?? "+58",
    )
    const phoneNumber = normalizePhoneNumber(
      typeof payload.phoneNumber === "string" ? payload.phoneNumber : next.phoneNumber ?? "",
    )
    const phoneE164 = normalizePhoneE164(
      countryCode,
      phoneNumber,
      typeof payload.phoneE164 === "string" ? payload.phoneE164 : next.phoneE164,
    )
    next.phoneCountryCode = countryCode
    next.phoneNumber = phoneNumber
    next.phoneE164 = phoneE164 || undefined
    next.phone = phoneNumber ? `${countryCode} ${phoneNumber}`.trim() : ""
  }

  if ("isActive" in payload && payload.isActive !== undefined) {
    next.isActive = Boolean(payload.isActive)
    next.status = next.isActive ? "active" : "inactive"
  }

  return next
}

const computePurchaseOrderTotals = (items: PurchaseOrderItem[]) => {
  const activeItems = items.filter((item) => !item.removedBySuperadmin)
  const subtotal = Number(activeItems.reduce((sum, item) => sum + item.total, 0).toFixed(2))
  const tax = Number((subtotal * PURCHASE_ORDER_VAT_RATE).toFixed(2))
  const total = Number((subtotal + tax).toFixed(2))
  return { subtotal, tax, total }
}

const normalizePurchaseOrderItems = (payload: unknown): PurchaseOrderItem[] | null => {
  if (!Array.isArray(payload) || payload.length === 0) return null
  const items: PurchaseOrderItem[] = []
  for (const rawItem of payload) {
    if (!isObject(rawItem)) return null
    const description = String(rawItem.description ?? "").trim()
    const quantity = Number(rawItem.quantity)
    const unitPrice = Number(rawItem.unitPrice)
    if (!description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      return null
    }
    items.push({
      id: createId("poi"),
      productId: typeof rawItem.productId === "string" ? rawItem.productId : undefined,
      description,
      quantity,
      unit: typeof rawItem.unit === "string" ? rawItem.unit : undefined,
      unitPrice: Number(unitPrice.toFixed(2)),
      total: Number((quantity * unitPrice).toFixed(2)),
      categoryId: typeof rawItem.categoryId === "string" ? rawItem.categoryId : undefined,
      removedBySuperadmin: false,
      removedBySuperadminReason: undefined,
    })
  }
  return items
}

const getNextOrderNumber = (state: MockApiState, year: number): string => {
  const prefix = `OC-${year}-`
  const sequence = state.purchaseOrders
    .map((order) => order.orderNumber)
    .filter((number) => number.startsWith(prefix))
    .map((number) => Number.parseInt(number.slice(prefix.length), 10))
    .filter((number) => Number.isFinite(number))
    .reduce((max, current) => Math.max(max, current), 0)
  return `${prefix}${String(sequence + 1).padStart(4, "0")}`
}

const recordInventoryEntryForOrder = (state: MockApiState, order: PurchaseOrder, actor: MockUserRecord, reason: string) => {
  for (const item of order.items) {
    if (item.removedBySuperadmin) continue
    if (!item.productId) continue

    const alreadyExists = state.inventoryMovements.some(
      (movement) => movement.type === "IN" && movement.purchaseOrderId === order.id && movement.productId === item.productId,
    )
    if (alreadyExists) continue

    let inventoryItem = state.inventoryItems.find((row) => row.productId === item.productId)
    if (!inventoryItem) {
      const product = state.products.find((row) => row.id === item.productId)
      inventoryItem = {
        id: createId("inv"),
        productId: item.productId,
        stock: 0,
        location: "Almacén principal",
        assetType: product?.categoryId ?? "industrial",
        updatedAt: new Date().toISOString(),
      }
      state.inventoryItems = [inventoryItem, ...state.inventoryItems]
    }

    inventoryItem.stock = Number((inventoryItem.stock + item.quantity).toFixed(2))
    inventoryItem.updatedAt = new Date().toISOString()

    state.inventoryMovements = [
      {
        id: createId("invm"),
        type: "IN",
        productId: item.productId,
        qty: item.quantity,
        departmentId: null,
        reason,
        purchaseOrderId: order.id,
        createdBy: actor.id,
        createdAt: new Date().toISOString(),
      },
      ...state.inventoryMovements,
    ]
  }
}

const transitionPurchaseOrder = (
  state: MockApiState,
  order: PurchaseOrder,
  nextStatus: PurchaseOrder["status"],
  currentUser: MockUserRecord,
  reason?: string,
): string | null => {
  const transitions: Record<PurchaseOrder["status"], PurchaseOrder["status"][]> = {
    draft: ["pending"],
    pending: ["approved", "rejected"],
    approved: ["certified"],
    rejected: [],
    certified: ["received"],
    received: [],
    sent: [],
    paid: [],
    overdue: [],
    closed: [],
    canceled: [],
  }

  if (!transitions[order.status].includes(nextStatus)) {
    return `Transición de estado inválida: ${order.status} -> ${nextStatus}.`
  }

  const nowIso = new Date().toISOString()
  order.status = nextStatus

  if (nextStatus === "pending") {
    order.submittedAt = nowIso
  } else if (nextStatus === "approved") {
    order.approvedAt = nowIso
    order.approvedBy = currentUser.name
    order.rejectionReason = undefined
  } else if (nextStatus === "rejected") {
    if (!reason?.trim()) {
      return "La razón de rechazo es obligatoria."
    }
    order.rejectedAt = nowIso
    order.rejectedBy = currentUser.name
    order.rejectionReason = reason.trim()
  } else if (nextStatus === "certified") {
    order.certifiedAt = nowIso
    recordInventoryEntryForOrder(state, order, currentUser, "OC_CERTIFIED")
  } else if (nextStatus === "received") {
    order.receivedAt = nowIso
    recordInventoryEntryForOrder(state, order, currentUser, "OC_RECEIVED")
  }

  return null
}

const summarizeInstallmentsByOrder = (rows: FinanceInstallment[]): Record<string, number> => {
  return rows.reduce<Record<string, number>>((acc, installment) => {
    acc[installment.purchaseOrderId] = Number(((acc[installment.purchaseOrderId] ?? 0) + Number(installment.amount)).toFixed(2))
    return acc
  }, {})
}

const buildFinanceSummaryForOrder = (order: PurchaseOrder, paidAmount: number): FinanceBalanceSummary => {
  const totalAmount = Number(Number(order.total).toFixed(2))
  const paid = Number(Number(paidAmount).toFixed(2))
  const remainingAmount = Number(Math.max(totalAmount - paid, 0).toFixed(2))

  let status: FinanceBalanceSummary["status"] = "pending"
  if (remainingAmount <= 0) status = "paid"
  else if (paid > 0) status = "partial"

  return {
    purchaseOrderId: order.id,
    orderNumber: order.orderNumber,
    supplierName: order.supplierName,
    totalAmount,
    paidAmount: paid,
    remainingAmount,
    status,
    currency: "USD",
  }
}

const paginate = <T,>(rows: T[], page: number, pageSize: number) => {
  const start = (page - 1) * pageSize
  const end = start + pageSize
  const total = rows.length
  return {
    data: rows.slice(start, end),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    },
  }
}

const toAscii = (value: string): string => value.replace(/[^\x20-\x7E]/g, " ")

const encodeBase64 = (value: string): string => {
  const ascii = toAscii(value)
  const bytes = new TextEncoder().encode(ascii)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return window.btoa(binary)
}

const escapePdfText = (value: string): string => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")

const buildSimplePdfBase64 = (title: string, subtitle: string): string => {
  const streamLines = [
    "BT",
    "/F1 14 Tf",
    "50 790 Td",
    `(${escapePdfText(toAscii(title))}) Tj`,
    "0 -20 Td",
    "/F1 10 Tf",
    `(${escapePdfText(toAscii(subtitle))}) Tj`,
    "ET",
  ]
  const stream = streamLines.join("\n")
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]

  let pdf = "%PDF-1.4\n"
  const offsets: number[] = [0]
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += "0000000000 65535 f \n"
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return encodeBase64(pdf)
}

const buildReportPayload = (state: MockApiState, reportType: string, filters: Record<string, unknown>) => {
  const normalized = reportType.trim().toLowerCase()

  if (normalized === "movement-history" || normalized === "audit-log") {
    let rows = [...state.monitoring]
    rows = filterByDateRange(rows, String(filters.startDate ?? ""), String(filters.endDate ?? ""))
    if (typeof filters.userId === "string" && filters.userId.trim()) {
      rows = rows.filter((item) => item.userId === filters.userId)
    }
    const entityFilter = typeof filters.entity === "string" ? filters.entity.trim() : ""
    if (entityFilter) {
      rows = rows.filter((item) => item.entityType.toLowerCase() === entityFilter.toLowerCase())
    }
    const actionFilter = typeof filters.action === "string" ? filters.action.trim() : ""
    if (actionFilter) {
      rows = rows.filter((item) => item.action.toLowerCase() === actionFilter.toLowerCase())
    }

    return {
      title: "Histórico de movimientos",
      reportType: "movement-history",
      columns: [
        { key: "createdAt", label: "Fecha/Hora" },
        { key: "userName", label: "Usuario" },
        { key: "role", label: "Rol" },
        { key: "action", label: "Acción" },
        { key: "entityType", label: "Entidad" },
        { key: "entityId", label: "ID" },
        { key: "result", label: "Resultado" },
      ],
      rows,
      totals: { registros: rows.length },
      filters,
    }
  }

  if (normalized === "finanzas" || normalized === "payments") {
    const paymentRows = state.financePayments.map((payment) => ({
      type: "Pago",
      number: payment.id,
      purchaseOrder: payment.purchaseOrderId,
      amount: payment.amount,
      currency: payment.currency,
      date: payment.createdAt.slice(0, 10),
      user: payment.createdBy,
    }))
    const installmentRows = state.financeInstallments.map((installment) => ({
      type: "Abono",
      number: installment.id,
      purchaseOrder: installment.purchaseOrderId,
      amount: installment.amount,
      currency: installment.currency,
      date: installment.createdAt.slice(0, 10),
      user: installment.createdBy,
    }))
    const rows = [...paymentRows, ...installmentRows].sort((left, right) => right.date.localeCompare(left.date))
    const totalAmount = rows.reduce((sum, item) => sum + Number(item.amount), 0)

    return {
      title: "Reporte de Finanzas",
      reportType: "finanzas",
      columns: [
        { key: "type", label: "Tipo" },
        { key: "number", label: "Número" },
        { key: "purchaseOrder", label: "OC" },
        { key: "amount", label: "Monto" },
        { key: "currency", label: "Moneda" },
        { key: "date", label: "Fecha" },
        { key: "user", label: "Usuario" },
      ],
      rows,
      totals: {
        registros: rows.length,
        montoTotal: Number(totalAmount.toFixed(2)),
      },
      filters,
    }
  }

  if (normalized === "purchase-orders") {
    let rows = [...state.purchaseOrders]
    rows = filterByDateRange(rows, String(filters.startDate ?? ""), String(filters.endDate ?? ""))
    if (typeof filters.supplierId === "string" && filters.supplierId.trim()) {
      rows = rows.filter((item) => item.supplierId === filters.supplierId)
    }
    if (typeof filters.status === "string" && filters.status.trim()) {
      rows = rows.filter((item) => item.status === filters.status)
    }

    const mapped = rows.map((item) => ({
      orderNumber: item.orderNumber,
      date: item.date.slice(0, 10),
      supplier: item.supplierName,
      status: item.status,
      total: Number(item.total.toFixed(2)),
      user: item.createdBy,
    }))

    return {
      title: "Reporte de Órdenes de Compra",
      reportType: "purchase-orders",
      columns: [
        { key: "orderNumber", label: "OC" },
        { key: "date", label: "Fecha" },
        { key: "supplier", label: "Proveedor" },
        { key: "status", label: "Estatus" },
        { key: "total", label: "Total" },
        { key: "user", label: "Usuario" },
      ],
      rows: mapped,
      totals: {
        registros: mapped.length,
        totalOrdenes: Number(mapped.reduce((sum, item) => sum + item.total, 0).toFixed(2)),
      },
      filters,
    }
  }

  if (normalized === "inventory-movements") {
    let rows = [...state.inventoryMovements]
    rows = filterByDateRange(rows, String(filters.startDate ?? ""), String(filters.endDate ?? ""))
    const mapped = rows.map((item) => ({
      date: item.createdAt,
      type: item.type,
      productId: item.productId,
      qty: item.qty,
      departmentId: item.departmentId,
      purchaseOrderId: item.purchaseOrderId,
      reason: item.reason,
      user: item.createdBy,
    }))

    return {
      title: "Reporte de Movimientos de Inventario",
      reportType: "inventory-movements",
      columns: [
        { key: "date", label: "Fecha" },
        { key: "type", label: "Tipo" },
        { key: "productId", label: "Producto" },
        { key: "qty", label: "Cantidad" },
        { key: "departmentId", label: "Departamento" },
        { key: "purchaseOrderId", label: "OC" },
        { key: "reason", label: "Motivo" },
        { key: "user", label: "Usuario" },
      ],
      rows: mapped,
      totals: {
        registros: mapped.length,
        cantidadTotal: Number(mapped.reduce((sum, item) => sum + Number(item.qty), 0).toFixed(2)),
      },
      filters,
    }
  }

  return null
}

const publicRoutes = new Set<string>([
  "POST:/auth/login",
  "POST:/auth/password-recovery/start",
  "POST:/auth/password-recovery/verify",
  "POST:/auth/password-recovery/reset",
])

const normalizeRouteKey = (method: string, pathname: string) => `${method.toUpperCase()}:${pathname}`

const buildFiltersFromQuery = (query: URLSearchParams): Record<string, unknown> => {
  const filters: Record<string, unknown> = {}
  for (const [key, value] of query.entries()) {
    filters[key] = value
  }
  return filters
}

export const isBrowserMockApiEnabled = (): boolean => {
  if (typeof window === "undefined") return false

  const raw = String(process.env.NEXT_PUBLIC_ENABLE_BROWSER_MOCK_API ?? "").trim().toLowerCase()
  if (["true", "1", "yes", "on"].includes(raw)) return true
  if (["false", "0", "no", "off"].includes(raw)) return false

  // Beta-safe default: if env flag is not explicitly set, use browser mock API.
  // This avoids mobile/browser clients trying to authenticate against non-shared
  // desktop/local backends with different credentials.
  if (!raw) return true

  const isLoopbackHost = (hostname: string) => {
    const normalized = hostname.trim().toLowerCase()
    return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1"
  }

  const parseHostname = (value: string): string | null => {
    try {
      const url = new URL(value)
      return url.hostname
    } catch {
      return null
    }
  }

  const apiBase = String(process.env.NEXT_PUBLIC_API_BASE_URL ?? "").trim() || "http://127.0.0.1:8000"
  const apiHost = parseHostname(apiBase)
  const webHost = window.location.hostname

  const apiLooksLoopback = apiHost ? isLoopbackHost(apiHost) : true
  const webIsLoopback = isLoopbackHost(webHost)

  // Automatic safety net for mobile/remote browser sessions when API_BASE_URL
  // still points to localhost and is unreachable from that client.
  return apiLooksLoopback && !webIsLoopback
}

export const mockApiHealth = async (): Promise<MockApiResult<Record<string, unknown>>> => {
  if (!isBrowserMockApiEnabled()) {
    return failure(503, "Browser mock API is disabled.")
  }
  return success(
    {
      status: "ok",
      db: "fallback",
      mode: "api",
      details: {
        service: "browser-mock-api",
        version: "1.0.0",
        database: {
          active_mode: "browser-local",
          status: "ok",
        },
      },
    },
    200,
  )
}

export const mockApiRequest = async (
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  options: { force?: boolean } = {},
): Promise<MockApiResult<unknown>> => {
  if (!options.force && !isBrowserMockApiEnabled()) {
    return failure(503, "Browser mock API is disabled.")
  }

  const state = loadState()
  const url = parsePath(path)
  const pathname = url.pathname
  const methodUpper = method.toUpperCase()
  const routeKey = normalizeRouteKey(methodUpper, pathname)

  clearExpiredSessions(state)

  if (pathname === "/health" && methodUpper === "GET") {
    const healthResult = await mockApiHealth()
    return healthResult as MockApiResult<unknown>
  }

  if (routeKey === "POST:/auth/login") {
    if (!isObject(body)) return failure(422, "Payload de inicio de sesión inválido.")
    const email = String(body.email ?? "").trim().toLowerCase()
    const password = String(body.password ?? "").trim()
    const user = state.users.find((item) => item.email.toLowerCase() === email)
    if (!user || user.password !== password) {
      return failure(401, "Credenciales inválidas.")
    }

    const token = createId("token")
    state.sessions = [{ token, userId: user.id, createdAt: new Date().toISOString() }, ...state.sessions]
    saveState(state)
    return success(wrapData({ token, user: toPublicUser(user) }), 200)
  }

  if (routeKey === "POST:/auth/password-recovery/start") {
    if (!isObject(body)) return failure(422, "identifier es requerido.")
    const identifier = String(body.identifier ?? "").trim().toLowerCase()
    if (!identifier) return failure(422, "identifier es requerido.")

    const user = state.users.find(
      (item) => item.email.toLowerCase() === identifier || item.name.toLowerCase() === identifier,
    )
    if (!user) return failure(404, "Usuario no encontrado.")

    const assigned = user.securityQuestions.slice(0, 3)
    if (assigned.length < 1) return failure(422, "El usuario no tiene preguntas de seguridad configuradas.")

    const recoveryToken = createId("recovery")
    const expiresAt = new Date(Date.now() + MOCK_SESSION_RECOVERY_MINUTES * 60 * 1000).toISOString()
    state.recoverySessions = [
      {
        token: recoveryToken,
        userId: user.id,
        questionIds: assigned.map((item) => item.questionId),
        expiresAt,
      },
      ...state.recoverySessions.filter((item) => item.userId !== user.id),
    ]
    saveState(state)

    const questions = assigned
      .map((item) => {
        const catalog = state.securityQuestions.find((question) => question.id === item.questionId)
        if (!catalog) return null
        return {
          questionId: catalog.id,
          questionText: catalog.questionText,
        }
      })
      .filter((item): item is { questionId: number; questionText: string } => item !== null)

    return success(
      wrapData({
        recoveryToken,
        expiresAt,
        questions,
      }),
      200,
    )
  }

  if (routeKey === "POST:/auth/password-recovery/verify") {
    if (!isObject(body)) return failure(422, "Payload de recuperación inválido.")
    const recoveryToken = String(body.recoveryToken ?? "").trim()
    const answers = Array.isArray(body.answers) ? body.answers : []
    const session = state.recoverySessions.find((item) => item.token === recoveryToken)
    if (!session) return failure(401, "La sesión de recuperación expiró.")
    const user = state.users.find((item) => item.id === session.userId)
    if (!user) return failure(404, "Usuario no encontrado.")

    const answersByQuestion = new Map<number, string>()
    for (const entry of answers) {
      if (!isObject(entry)) continue
      const questionId = Number(entry.questionId)
      const answer = String(entry.answer ?? "").trim()
      if (Number.isFinite(questionId)) {
        answersByQuestion.set(questionId, answer)
      }
    }

    const allAnswered = session.questionIds.every((questionId) => answersByQuestion.has(questionId))
    if (!allAnswered) return failure(422, "Debes responder todas las preguntas.")

    const isValid = session.questionIds.every((questionId) => {
      const expected = user.securityQuestions.find((item) => item.questionId === questionId)?.answer ?? ""
      const received = answersByQuestion.get(questionId) ?? ""
      return expected === received
    })
    if (!isValid) return failure(401, "Las respuestas de seguridad no coinciden.")

    const resetToken = createId("reset")
    const expiresAt = new Date(Date.now() + MOCK_SESSION_RESET_MINUTES * 60 * 1000).toISOString()
    state.recoverySessions = state.recoverySessions.filter((item) => item.token !== recoveryToken)
    state.resetSessions = [{ token: resetToken, userId: user.id, expiresAt }, ...state.resetSessions]
    saveState(state)
    return success(wrapData({ resetToken, expiresAt }), 200)
  }

  if (routeKey === "POST:/auth/password-recovery/reset") {
    if (!isObject(body)) return failure(422, "Payload de restablecimiento inválido.")
    const resetToken = String(body.resetToken ?? "").trim()
    const newPassword = String(body.newPassword ?? "")
    if (newPassword.trim().length < 8) {
      return failure(422, "La nueva contraseña debe tener al menos 8 caracteres.")
    }
    const resetSession = state.resetSessions.find((item) => item.token === resetToken)
    if (!resetSession) return failure(401, "La sesión de restablecimiento expiró.")
    const user = state.users.find((item) => item.id === resetSession.userId)
    if (!user) return failure(404, "Usuario no encontrado.")
    user.password = newPassword
    state.resetSessions = state.resetSessions.filter((item) => item.token !== resetToken)
    saveState(state)
    return success({ ok: true }, 200)
  }

  const currentUser = getCurrentUser(state, headers)
  if (!publicRoutes.has(routeKey) && !currentUser && routeKey !== "POST:/auth/logout") {
    return failure(401, "Token inválido.")
  }

  if (routeKey === "GET:/auth/me") {
    if (!currentUser) return failure(401, "Token inválido.")
    return success(wrapData(toPublicUser(currentUser)), 200)
  }

  if (routeKey === "POST:/auth/logout") {
    const token = extractBearerToken(headers)
    if (token) {
      state.sessions = state.sessions.filter((item) => item.token !== token)
      saveState(state)
    }
    return success({ ok: true }, 200)
  }

  if (routeKey === "GET:/categories") {
    return success(wrapData([...state.categories]), 200)
  }

  if (routeKey === "POST:/categories") {
    if (!isObject(body)) return failure(422, "name es requerido.")
    const name = String(body.name ?? "").trim()
    if (!name) return failure(422, "name es requerido.")
    const existing = state.categories.find((item) => item.name.toLowerCase() === name.toLowerCase())
    if (existing) return success(wrapData(existing), 201)
    const category: Category = { id: createId("cat"), name }
    state.categories = [...state.categories, category]
    if (currentUser) {
      appendMonitoringEvent(state, currentUser, "category_create", "category", category.id, { name: category.name })
    }
    saveState(state)
    return success(wrapData(category), 201)
  }

  if (routeKey === "GET:/suppliers") {
    return success(wrapData(sortByCreatedAtDesc(state.suppliers)), 200)
  }

  if (routeKey === "POST:/suppliers") {
    if (!currentUser) return failure(401, "Token inválido.")
    if (!isObject(body)) return failure(422, "Payload de proveedor inválido.")
    const validationError = validateSupplierPayload(body, "create")
    if (validationError) return failure(422, validationError)

    const candidate = normalizeSupplierForCreate(body)
    const duplicateEmail = candidate.email
      ? state.suppliers.find((item) => item.email.toLowerCase() === candidate.email.toLowerCase())
      : null
    if (duplicateEmail) return failure(409, "El email ya existe.")
    const duplicateRif = state.suppliers.find((item) => item.rif.toLowerCase() === candidate.rif.toLowerCase())
    if (duplicateRif) return failure(409, "El RIF ya existe.")

    state.suppliers = [candidate, ...state.suppliers]
    appendMonitoringEvent(state, currentUser, "supplier_create", "supplier", candidate.id, {
      name: candidate.name,
      rif: candidate.rif,
      isActive: candidate.isActive,
    })
    saveState(state)
    return success(wrapData(candidate), 201)
  }

  const supplierItemMatch = pathname.match(/^\/suppliers\/([^/]+)$/)
  if (supplierItemMatch && methodUpper === "GET") {
    const supplierId = decodeURIComponent(supplierItemMatch[1])
    const supplier = state.suppliers.find((item) => item.id === supplierId)
    if (!supplier) return failure(404, "Proveedor no encontrado.")
    return success(wrapData(supplier), 200)
  }

  if (supplierItemMatch && methodUpper === "PUT") {
    if (!currentUser) return failure(401, "Token inválido.")
    if (!isObject(body)) return failure(422, "Payload de proveedor inválido.")
    const supplierId = decodeURIComponent(supplierItemMatch[1])
    const current = state.suppliers.find((item) => item.id === supplierId)
    if (!current) return failure(404, "Proveedor no encontrado.")

    const validationError = validateSupplierPayload(body, "update")
    if (validationError) return failure(422, validationError)

    const preview = applySupplierUpdates(current, body)
    if (!preview.email && !preview.phoneE164) {
      return failure(422, "Debes registrar al menos un medio de contacto: teléfono o email.")
    }
    const duplicateEmail = preview.email
      ? state.suppliers.find((item) => item.id !== supplierId && item.email.toLowerCase() === preview.email.toLowerCase())
      : null
    if (duplicateEmail) return failure(409, "El email ya existe.")
    const duplicateRif = state.suppliers.find(
      (item) => item.id !== supplierId && item.rif.toLowerCase() === preview.rif.toLowerCase(),
    )
    if (duplicateRif) return failure(409, "El RIF ya existe.")

    state.suppliers = state.suppliers.map((item) => (item.id === supplierId ? preview : item))
    appendMonitoringEvent(state, currentUser, "supplier_update", "supplier", supplierId, body)
    saveState(state)
    return success(wrapData(preview), 200)
  }

  if (supplierItemMatch && methodUpper === "DELETE") {
    if (!currentUser) return failure(401, "Token inválido.")
    const supplierId = decodeURIComponent(supplierItemMatch[1])
    const supplier = state.suppliers.find((item) => item.id === supplierId)
    if (!supplier) return failure(404, "Proveedor no encontrado.")
    state.suppliers = state.suppliers.map((item) =>
      item.id === supplierId ? { ...item, isActive: false, status: "inactive" } : item,
    )
    appendMonitoringEvent(state, currentUser, "supplier_soft_delete", "supplier", supplierId, { isActive: false })
    saveState(state)
    return success({ ok: true, id: supplierId }, 200)
  }

  const supplierStateMatch = pathname.match(/^\/suppliers\/([^/]+)\/(activate|deactivate)$/)
  if (supplierStateMatch && methodUpper === "POST") {
    if (!currentUser) return failure(401, "Token inválido.")
    const supplierId = decodeURIComponent(supplierStateMatch[1])
    const action = supplierStateMatch[2]
    const supplier = state.suppliers.find((item) => item.id === supplierId)
    if (!supplier) return failure(404, "Proveedor no encontrado.")

    const isActive = action === "activate"
    const updated = { ...supplier, isActive, status: isActive ? "active" : "inactive" as Supplier["status"] }
    state.suppliers = state.suppliers.map((item) => (item.id === supplierId ? updated : item))
    appendMonitoringEvent(
      state,
      currentUser,
      isActive ? "supplier_activate" : "supplier_deactivate",
      "supplier",
      supplierId,
      { isActive },
    )
    saveState(state)
    return success(wrapData(updated), 200)
  }

  if (routeKey === "GET:/products") {
    const onlyActive = parseBooleanQuery(url.searchParams.get("onlyActive"))
    const categoryId = url.searchParams.get("categoryId")?.trim() ?? ""
    const query = url.searchParams.get("q")?.trim().toLowerCase() ?? ""
    let rows = [...state.products]
    if (categoryId) rows = rows.filter((item) => item.categoryId === categoryId)
    if (onlyActive) rows = rows.filter((item) => item.isActive)
    if (query) {
      rows = rows.filter(
        (item) =>
          item.name.toLowerCase().includes(query) ||
          (item.description ?? "").toLowerCase().includes(query),
      )
    }
    return success(wrapData(rows), 200)
  }

  if (routeKey === "GET:/purchase-orders") {
    const page = Math.max(Number(url.searchParams.get("page") ?? "1"), 1)
    const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize") ?? "20"), 1), 100)
    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? ""
    const statusFilter = url.searchParams.get("status")?.trim().toLowerCase() ?? ""
    const supplierId = url.searchParams.get("supplierId")?.trim() ?? ""
    const dateFrom = parseDateInput(url.searchParams.get("dateFrom"))
    const dateTo = parseDateInput(url.searchParams.get("dateTo"))

    let rows = [...state.purchaseOrders]
    if (statusFilter) rows = rows.filter((item) => item.status.toLowerCase() === statusFilter)
    if (supplierId) rows = rows.filter((item) => item.supplierId === supplierId)
    if (dateFrom) rows = rows.filter((item) => parseDateInput(item.date)?.getTime() ?? 0 >= dateFrom.getTime())
    if (dateTo) {
      const inclusiveEnd = new Date(dateTo)
      inclusiveEnd.setUTCHours(23, 59, 59, 999)
      rows = rows.filter((item) => (parseDateInput(item.date)?.getTime() ?? 0) <= inclusiveEnd.getTime())
    }
    if (q) {
      rows = rows.filter((item) => {
        const reason = (item.reason ?? "").toLowerCase()
        return (
          item.orderNumber.toLowerCase().includes(q) ||
          item.supplierName.toLowerCase().includes(q) ||
          reason.includes(q)
        )
      })
    }
    rows = [...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    const paged = paginate(rows, page, pageSize)
    return success({ ...paged, meta: { source: "api" } }, 200)
  }

  if (routeKey === "POST:/purchase-orders") {
    if (!currentUser) return failure(401, "Token inválido.")
    if (!isObject(body)) return failure(422, "Payload de orden de compra inválido.")

    const supplierId = String(body.supplierId ?? "").trim()
    const supplier = state.suppliers.find((item) => item.id === supplierId)
    if (!supplier) return failure(404, "Proveedor no encontrado.")

    const orderDate = parseDateInput(body.date)
    if (!orderDate) return failure(422, "date has an invalid value.")
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const candidateDate = new Date(orderDate)
    candidateDate.setUTCHours(0, 0, 0, 0)
    if (candidateDate.getTime() < today.getTime()) {
      return failure(422, "La fecha de la orden no puede ser anterior a la fecha actual.")
    }

    const items = normalizePurchaseOrderItems(body.items)
    if (!items) return failure(422, "La orden de compra requiere al menos un item valido.")
    const totals = computePurchaseOrderTotals(items)

    const purchaseOrder: PurchaseOrder = {
      id: createId("po"),
      orderNumber: getNextOrderNumber(state, orderDate.getUTCFullYear()),
      supplierId: supplier.id,
      supplierName: supplier.name,
      date: orderDate.toISOString(),
      status: "draft",
      items,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      reason: typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined,
      createdBy: currentUser.name,
      createdAt: new Date().toISOString(),
    }

    state.purchaseOrders = [purchaseOrder, ...state.purchaseOrders]
    appendMonitoringEvent(state, currentUser, "purchase_order_create", "purchase_order", purchaseOrder.id, {
      orderNumber: purchaseOrder.orderNumber,
      total: purchaseOrder.total,
      status: purchaseOrder.status,
    })
    saveState(state)
    return success(wrapData(purchaseOrder), 201)
  }

  const purchaseOrderMatch = pathname.match(/^\/purchase-orders\/([^/]+)$/)
  if (purchaseOrderMatch && methodUpper === "GET") {
    const orderId = decodeURIComponent(purchaseOrderMatch[1])
    const order = state.purchaseOrders.find((item) => item.id === orderId)
    if (!order) return failure(404, "Orden de compra no encontrada.")
    return success(wrapData(order), 200)
  }

  const purchaseOrderActionMatch = pathname.match(/^\/purchase-orders\/([^/]+)\/(submit|approve|reject|certify|receive)$/)
  if (purchaseOrderActionMatch && methodUpper === "POST") {
    if (!currentUser) return failure(401, "Token inválido.")
    const orderId = decodeURIComponent(purchaseOrderActionMatch[1])
    const action = purchaseOrderActionMatch[2]
    const order = state.purchaseOrders.find((item) => item.id === orderId)
    if (!order) return failure(404, "Orden de compra no encontrada.")

    const reason = isObject(body) && typeof body.reason === "string" ? body.reason : undefined
    const statusMap: Record<string, PurchaseOrder["status"]> = {
      submit: "pending",
      approve: "approved",
      reject: "rejected",
      certify: "certified",
      receive: "received",
    }
    const nextStatus = statusMap[action]
    const transitionError = transitionPurchaseOrder(state, order, nextStatus, currentUser, reason)
    if (transitionError) return failure(422, transitionError)

    appendMonitoringEvent(state, currentUser, `purchase_order_${action}`, "purchase_order", order.id, {
      status: order.status,
      reason: reason ?? null,
    })
    saveState(state)
    return success(wrapData(order), 200)
  }

  const purchaseOrderRemoveItemMatch = pathname.match(/^\/purchase-orders\/([^/]+)\/items\/([^/]+)\/remove$/)
  if (purchaseOrderRemoveItemMatch && methodUpper === "POST") {
    if (!currentUser) return failure(401, "Token inválido.")
    if (!isObject(body)) return failure(422, "reason es requerido.")

    const orderId = decodeURIComponent(purchaseOrderRemoveItemMatch[1])
    const itemId = decodeURIComponent(purchaseOrderRemoveItemMatch[2])
    const reason = String(body.reason ?? "").trim()
    if (!reason) return failure(422, "reason es requerido.")

    const order = state.purchaseOrders.find((item) => item.id === orderId)
    if (!order) return failure(404, "Orden de compra no encontrada.")
    if (order.status !== "pending" && order.status !== "approved") {
      return failure(422, "Los ítems solo pueden eliminarse cuando la orden está pendiente o aprobada.")
    }

    let found = false
    order.items = order.items.map((item) => {
      if (item.id !== itemId) return item
      found = true
      if (item.removedBySuperadmin) return item
      return {
        ...item,
        removedBySuperadmin: true,
        removedBySuperadminReason: reason,
      }
    })
    if (!found) return failure(404, "Ítem de orden de compra no encontrado.")
    const totals = computePurchaseOrderTotals(order.items)
    order.subtotal = totals.subtotal
    order.tax = totals.tax
    order.total = totals.total

    appendMonitoringEvent(state, currentUser, "purchase_order_remove_item", "purchase_order", order.id, {
      itemId,
      reason,
      total: order.total,
    })
    saveState(state)
    return success(wrapData(order), 200)
  }

  if (routeKey === "GET:/inventory/items") {
    const term = url.searchParams.get("q")?.trim().toLowerCase() ?? ""
    let rows = [...state.inventoryItems]
    if (term) {
      const matchingProducts = new Set(
        state.products
          .filter((product) => product.name.toLowerCase().includes(term))
          .map((product) => product.id),
      )
      rows = rows.filter((item) => item.productId.includes(term) || matchingProducts.has(item.productId))
    }
    rows = [...rows].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    return success(wrapData(rows), 200)
  }

  if (routeKey === "GET:/inventory/movements") {
    const page = Math.max(Number(url.searchParams.get("page") ?? "1"), 1)
    const pageSize = Math.min(Math.max(Number(url.searchParams.get("page_size") ?? "20"), 1), 200)
    const productId = url.searchParams.get("productId")?.trim() ?? ""
    const movementType = url.searchParams.get("movementType")?.trim().toUpperCase() ?? ""
    let rows = [...state.inventoryMovements]
    if (productId) rows = rows.filter((item) => item.productId === productId)
    if (movementType) rows = rows.filter((item) => item.type.toUpperCase() === movementType)
    rows = [...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    const paged = paginate(rows, page, pageSize)
    return success({ ...paged, meta: { source: "api" } }, 200)
  }

  if (routeKey === "POST:/inventory/movements/in") {
    if (!currentUser) return failure(401, "Token inválido.")
    if (!isObject(body)) return failure(422, "Payload de movimiento inválido.")
    const productId = String(body.productId ?? "").trim()
    const qty = Number(body.qty)
    if (!productId) return failure(422, "productId es requerido.")
    if (!Number.isFinite(qty) || qty <= 0) return failure(422, "qty debe ser mayor a cero.")
    const product = state.products.find((item) => item.id === productId)
    if (!product) return failure(404, "Producto no encontrado.")

    let inventoryItem = state.inventoryItems.find((item) => item.productId === productId)
    if (!inventoryItem) {
      inventoryItem = {
        id: createId("inv"),
        productId,
        stock: 0,
        location: "Almacén principal",
        assetType: product.categoryId,
        updatedAt: new Date().toISOString(),
      }
      state.inventoryItems = [inventoryItem, ...state.inventoryItems]
    }
    inventoryItem.stock = Number((inventoryItem.stock + qty).toFixed(2))
    inventoryItem.updatedAt = new Date().toISOString()

    const movement: InventoryMovement = {
      id: createId("invm"),
      type: "IN",
      productId,
      qty,
      departmentId: null,
      reason: typeof body.reason === "string" ? body.reason : null,
      purchaseOrderId: typeof body.purchaseOrderId === "string" ? body.purchaseOrderId : null,
      createdBy: currentUser.id,
      createdAt: new Date().toISOString(),
    }
    state.inventoryMovements = [movement, ...state.inventoryMovements]
    appendMonitoringEvent(state, currentUser, "inventory_in", "inventory", movement.id, {
      productId,
      qty,
      stock: inventoryItem.stock,
    })
    saveState(state)
    return success(wrapData(movement), 201)
  }

  if (routeKey === "POST:/inventory/movements/out") {
    if (!currentUser) return failure(401, "Token inválido.")
    if (!isObject(body)) return failure(422, "Payload de movimiento inválido.")
    const productId = String(body.productId ?? "").trim()
    const qty = Number(body.qty)
    const departmentId = String(body.departmentId ?? "").trim()
    const reason = String(body.reason ?? "").trim()

    if (!productId) return failure(422, "productId es requerido.")
    if (!departmentId) return failure(422, "departmentId es requerido.")
    if (!reason) return failure(422, "reason es requerido.")
    if (!Number.isFinite(qty) || qty <= 0) return failure(422, "qty debe ser mayor a cero.")

    const product = state.products.find((item) => item.id === productId)
    if (!product) return failure(404, "Producto no encontrado.")
    const department = state.departments.find((item) => item.id === departmentId && item.isActive)
    if (!department) return failure(422, "departmentId es inválido o está inactivo.")

    let inventoryItem = state.inventoryItems.find((item) => item.productId === productId)
    if (!inventoryItem) {
      inventoryItem = {
        id: createId("inv"),
        productId,
        stock: 0,
        location: "Almacén principal",
        assetType: product.categoryId,
        updatedAt: new Date().toISOString(),
      }
      state.inventoryItems = [inventoryItem, ...state.inventoryItems]
    }
    if (inventoryItem.stock < qty) return failure(422, "Stock insuficiente.")

    inventoryItem.stock = Number((inventoryItem.stock - qty).toFixed(2))
    inventoryItem.updatedAt = new Date().toISOString()

    const movement: InventoryMovement = {
      id: createId("invm"),
      type: "OUT",
      productId,
      qty,
      departmentId,
      reason,
      purchaseOrderId: null,
      createdBy: currentUser.id,
      createdAt: new Date().toISOString(),
    }
    state.inventoryMovements = [movement, ...state.inventoryMovements]
    appendMonitoringEvent(state, currentUser, "inventory_out", "inventory", movement.id, {
      productId,
      qty,
      departmentId,
      stock: inventoryItem.stock,
    })
    saveState(state)
    return success(wrapData(movement), 201)
  }

  if (routeKey === "GET:/departments") {
    const onlyActive = parseBooleanQuery(url.searchParams.get("only_active"))
    const rows = onlyActive ? state.departments.filter((item) => item.isActive) : [...state.departments]
    return success(wrapData(rows), 200)
  }

  if (routeKey === "GET:/finanzas/resumen") {
    const purchaseOrderId = url.searchParams.get("purchaseOrderId")?.trim() ?? ""
    const orders = purchaseOrderId
      ? state.purchaseOrders.filter((item) => item.id === purchaseOrderId)
      : [...state.purchaseOrders]
    if (purchaseOrderId && orders.length === 0) return failure(404, "Orden de compra no encontrada.")

    const paidByOrder = summarizeInstallmentsByOrder(state.financeInstallments)
    const summaries = orders
      .sort((left, right) => right.date.localeCompare(left.date))
      .map((order) => buildFinanceSummaryForOrder(order, paidByOrder[order.id] ?? 0))

    return success(wrapData(summaries), 200)
  }

  if (routeKey === "GET:/finanzas/pagos") {
    const purchaseOrderId = url.searchParams.get("purchaseOrderId")?.trim() ?? ""
    const rows = purchaseOrderId
      ? state.financePayments.filter((item) => item.purchaseOrderId === purchaseOrderId)
      : [...state.financePayments]
    return success(wrapData(sortByCreatedAtDesc(rows)), 200)
  }

  if (routeKey === "POST:/finanzas/pagos") {
    if (!currentUser) return failure(401, "Token inválido.")
    if (!isObject(body)) return failure(422, "Payload financiero inválido.")
    const purchaseOrderId = String(body.purchaseOrderId ?? "").trim()
    const amount = Number(body.amount)
    const paymentType = String(body.paymentType ?? "").trim().toLowerCase()
    const paymentMode = String(body.paymentMode ?? "").trim()
    if (!purchaseOrderId) return failure(422, "purchaseOrderId es requerido.")
    if (!Number.isFinite(amount) || amount <= 0) return failure(422, "El monto debe ser mayor a 0.")
    if (!["contado", "credito"].includes(paymentType)) return failure(422, "El tipo de pago debe ser contado o crédito.")
    if (paymentType === "contado" && !paymentMode) return failure(422, "El modo de pago es obligatorio para pagos de contado.")
    if (!normalizeCurrencyUsd(body.currency)) return failure(422, "La moneda admitida es USD.")

    const order = state.purchaseOrders.find((item) => item.id === purchaseOrderId)
    if (!order) return failure(404, "Orden de compra no encontrada.")

    const payment: FinancePayment = {
      id: createId("fpay"),
      purchaseOrderId,
      amount: Number(amount.toFixed(2)),
      currency: "USD",
      paymentType: paymentType as FinancePayment["paymentType"],
      paymentMode,
      reference: typeof body.reference === "string" ? body.reference : undefined,
      concept: typeof body.concept === "string" ? body.concept : undefined,
      createdBy: currentUser.id,
      createdAt: new Date().toISOString(),
    }
    state.financePayments = [payment, ...state.financePayments]
    appendMonitoringEvent(state, currentUser, "finance_payment_create", "finance_payment", payment.id, {
      purchaseOrderId: order.id,
      amount: payment.amount,
      paymentType: payment.paymentType,
    })
    saveState(state)
    return success(wrapData(payment), 201)
  }

  if (routeKey === "GET:/finanzas/abonos") {
    const purchaseOrderId = url.searchParams.get("purchaseOrderId")?.trim() ?? ""
    const rows = purchaseOrderId
      ? state.financeInstallments.filter((item) => item.purchaseOrderId === purchaseOrderId)
      : [...state.financeInstallments]
    return success(wrapData(sortByCreatedAtDesc(rows)), 200)
  }

  if (routeKey === "POST:/finanzas/abonos") {
    if (!currentUser) return failure(401, "Token inválido.")
    if (!isObject(body)) return failure(422, "Payload financiero inválido.")
    const purchaseOrderId = String(body.purchaseOrderId ?? "").trim()
    const amount = Number(body.amount)
    if (!purchaseOrderId) return failure(422, "purchaseOrderId es requerido.")
    if (!Number.isFinite(amount) || amount <= 0) return failure(422, "El abono debe ser mayor a 0.")
    if (!normalizeCurrencyUsd(body.currency)) return failure(422, "La moneda admitida es USD.")

    const order = state.purchaseOrders.find((item) => item.id === purchaseOrderId)
    if (!order) return failure(404, "Orden de compra no encontrada.")

    const financePaymentId = typeof body.financePaymentId === "string" ? body.financePaymentId : null
    if (financePaymentId) {
      const payment = state.financePayments.find((item) => item.id === financePaymentId)
      if (!payment) return failure(404, "financePaymentId no encontrado.")
    }

    const paidByOrder = summarizeInstallmentsByOrder(state.financeInstallments)
    const currentSummary = buildFinanceSummaryForOrder(order, paidByOrder[order.id] ?? 0)
    if (currentSummary.remainingAmount <= 0) return failure(422, "La orden ya está pagada.")
    if (amount > currentSummary.remainingAmount) {
      return failure(422, "El abono no puede superar el saldo restante.")
    }

    const installment: FinanceInstallment = {
      id: createId("fins"),
      purchaseOrderId,
      financePaymentId,
      amount: Number(amount.toFixed(2)),
      currency: "USD",
      concept: typeof body.concept === "string" ? body.concept : undefined,
      createdBy: currentUser.id,
      createdAt: new Date().toISOString(),
    }
    state.financeInstallments = [installment, ...state.financeInstallments]
    appendMonitoringEvent(state, currentUser, "finance_installment_create", "finance_installment", installment.id, {
      purchaseOrderId: order.id,
      amount: installment.amount,
    })
    saveState(state)
    const nextSummary = buildFinanceSummaryForOrder(order, (paidByOrder[order.id] ?? 0) + installment.amount)
    return success(wrapData({ ...installment, balance: nextSummary }), 201)
  }

  if (routeKey === "GET:/monitoring/movements") {
    let rows = [...state.monitoring]
    const eventType = url.searchParams.get("event_type")?.trim().toLowerCase() ?? ""
    const userId = url.searchParams.get("user_id")?.trim() ?? ""
    const entityType = url.searchParams.get("entity_type")?.trim().toLowerCase() ?? ""
    const entityId = url.searchParams.get("entity_id")?.trim() ?? ""
    const dateFrom = url.searchParams.get("date_from")
    const dateTo = url.searchParams.get("date_to")
    rows = filterByDateRange(rows, dateFrom, dateTo)
    if (eventType) rows = rows.filter((item) => item.eventType.toLowerCase() === eventType)
    if (userId) rows = rows.filter((item) => item.userId === userId)
    if (entityType) rows = rows.filter((item) => item.entityType.toLowerCase() === entityType)
    if (entityId) rows = rows.filter((item) => item.entityId === entityId)
    rows = [...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt))

    const page = Math.max(Number(url.searchParams.get("page") ?? "1"), 1)
    const pageSize = Math.min(Math.max(Number(url.searchParams.get("page_size") ?? "20"), 1), 200)
    const paged = paginate(rows, page, pageSize)
    return success({ ...paged, meta: { source: "api" } }, 200)
  }

  const reportGetMatch = pathname.match(/^\/reports\/([^/]+)$/)
  if (reportGetMatch && methodUpper === "GET") {
    const reportType = decodeURIComponent(reportGetMatch[1])
    const filters = buildFiltersFromQuery(url.searchParams)
    const payload = buildReportPayload(state, reportType, filters)
    if (!payload) return failure(404, "Reporte no encontrado.")
    return success(wrapData(payload), 200)
  }

  const reportPdfMatch = pathname.match(/^\/reports\/([^/]+)\/pdf$/)
  if (reportPdfMatch && methodUpper === "POST") {
    const reportType = decodeURIComponent(reportPdfMatch[1])
    const filters = isObject(body) ? (body as Record<string, unknown>) : {}
    const payload = buildReportPayload(state, reportType, filters)
    if (!payload) return failure(404, "Reporte no encontrado.")
    const base64 = buildSimplePdfBase64(payload.title, `Registros: ${payload.rows.length}`)
    return success(
      wrapData({
        filename: `${reportType}_${new Date().toISOString().slice(0, 10)}.pdf`,
        mimeType: "application/pdf",
        contentBase64: base64,
        rowCount: payload.rows.length,
        totals: payload.totals,
        title: payload.title,
      }),
      200,
    )
  }

  if (routeKey === "GET:/company-settings") {
    return success(wrapData(state.companySettings), 200)
  }

  if (routeKey === "PUT:/company-settings") {
    if (!isObject(body)) return failure(422, "Payload de configuración de compañía inválido.")
    const next: CompanySettings = {
      name: String(body.name ?? "").trim(),
      rif: String(body.rif ?? "").trim(),
      address: String(body.address ?? "").trim(),
      phone: String(body.phone ?? "").trim(),
      email: String(body.email ?? "").trim(),
      logo: typeof body.logo === "string" ? body.logo : undefined,
    }
    state.companySettings = next
    if (currentUser) {
      appendMonitoringEvent(
        state,
        currentUser,
        "company_settings_update",
        "settings",
        "company",
        next as unknown as Record<string, unknown>,
      )
    }
    saveState(state)
    return success(wrapData(next), 200)
  }

  if (routeKey === "GET:/users") {
    const rows = [...state.users].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(toPublicUser)
    return success(wrapData(rows), 200)
  }

  if (routeKey === "POST:/users") {
    if (!isObject(body)) return failure(422, "Payload de usuario inválido.")
    const name = String(body.name ?? "").trim()
    const email = String(body.email ?? "").trim().toLowerCase()
    const role = normalizeRole(body.role)
    const password = String(body.password ?? "")
    const securityPayload = Array.isArray(body.securityQuestions) ? body.securityQuestions : []
    if (!name) return failure(422, "El nombre es requerido.")
    if (!EMAIL_REGEX.test(email)) return failure(422, "Email inválido.")
    if (password.trim().length < 6) return failure(422, "La contraseña debe tener al menos 6 caracteres.")
    if (securityPayload.length !== 3) return failure(422, "Se requieren exactamente 3 preguntas de seguridad.")
    if (state.users.some((item) => item.email.toLowerCase() === email)) return failure(409, "El email ya existe.")

    const securityQuestions: MockSecurityAnswer[] = []
    for (const item of securityPayload) {
      if (!isObject(item)) return failure(422, "Preguntas de seguridad inválidas.")
      const questionId = Number(item.questionId)
      const answer = String(item.answer ?? "").trim()
      const questionExists = state.securityQuestions.some((question) => question.id === questionId && question.active)
      if (!Number.isFinite(questionId) || !questionExists) return failure(422, "Preguntas de seguridad inválidas.")
      if (answer.length < 2) return failure(422, "Cada respuesta de seguridad debe tener al menos 2 caracteres.")
      securityQuestions.push({ questionId, answer })
    }
    if (new Set(securityQuestions.map((item) => item.questionId)).size !== 3) {
      return failure(422, "Las preguntas de seguridad deben ser únicas.")
    }

    const user: MockUserRecord = {
      id: createId("user"),
      email,
      name,
      role,
      createdAt: new Date().toISOString(),
      password,
      securityQuestions,
    }
    state.users = [user, ...state.users]
    if (currentUser) {
      appendMonitoringEvent(state, currentUser, "user_create", "user", user.id, { email: user.email, role: user.role })
    }
    saveState(state)
    return success(wrapData(toPublicUser(user)), 201)
  }

  const userSecurityMatch = pathname.match(/^\/users\/([^/]+)\/security-questions$/)
  if (userSecurityMatch && methodUpper === "GET") {
    const userId = decodeURIComponent(userSecurityMatch[1])
    const user = state.users.find((item) => item.id === userId)
    if (!user) return failure(404, "Usuario no encontrado.")
    const rows = user.securityQuestions
      .map((item) => {
        const question = state.securityQuestions.find((questionItem) => questionItem.id === item.questionId)
        if (!question) return null
        return { questionId: question.id, questionText: question.questionText }
      })
      .filter((item): item is { questionId: number; questionText: string } => item !== null)
    return success(wrapData(rows), 200)
  }

  const userItemMatch = pathname.match(/^\/users\/([^/]+)$/)
  if (userItemMatch && methodUpper === "PUT") {
    if (!isObject(body)) return failure(422, "Payload de usuario inválido.")
    const userId = decodeURIComponent(userItemMatch[1])
    const user = state.users.find((item) => item.id === userId)
    if (!user) return failure(404, "Usuario no encontrado.")

    const nextEmail = "email" in body ? String(body.email ?? "").trim().toLowerCase() : user.email
    if ("email" in body && !EMAIL_REGEX.test(nextEmail)) return failure(422, "Email inválido.")
    const duplicate = state.users.find((item) => item.id !== userId && item.email.toLowerCase() === nextEmail.toLowerCase())
    if (duplicate) return failure(409, "El email ya existe.")

    if ("name" in body && String(body.name ?? "").trim()) user.name = String(body.name).trim()
    if ("email" in body) user.email = nextEmail
    if ("role" in body) user.role = normalizeRole(body.role)
    if ("password" in body && String(body.password ?? "").trim()) user.password = String(body.password ?? "").trim()

    if ("securityQuestions" in body && body.securityQuestions !== undefined) {
      const securityPayload = Array.isArray(body.securityQuestions) ? body.securityQuestions : []
      if (securityPayload.length !== 3) return failure(422, "Se requieren exactamente 3 preguntas de seguridad.")
      const securityQuestions: MockSecurityAnswer[] = []
      for (const item of securityPayload) {
        if (!isObject(item)) return failure(422, "Preguntas de seguridad inválidas.")
        const questionId = Number(item.questionId)
        const answer = String(item.answer ?? "").trim()
        const questionExists = state.securityQuestions.some((question) => question.id === questionId && question.active)
        if (!Number.isFinite(questionId) || !questionExists) return failure(422, "Preguntas de seguridad inválidas.")
        if (answer.length < 2) return failure(422, "Cada respuesta de seguridad debe tener al menos 2 caracteres.")
        securityQuestions.push({ questionId, answer })
      }
      if (new Set(securityQuestions.map((item) => item.questionId)).size !== 3) {
        return failure(422, "Las preguntas de seguridad deben ser únicas.")
      }
      user.securityQuestions = securityQuestions
      if (currentUser) {
        appendMonitoringEvent(state, currentUser, "security_questions_reset", "user", user.id, { count: 3 })
      }
    }

    if (currentUser) {
      appendMonitoringEvent(state, currentUser, "user_update", "user", user.id, { email: user.email, role: user.role })
    }
    saveState(state)
    return success(wrapData(toPublicUser(user)), 200)
  }

  if (userItemMatch && methodUpper === "DELETE") {
    if (!currentUser) return failure(401, "Token inválido.")
    const userId = decodeURIComponent(userItemMatch[1])
    if (currentUser.id === userId) return failure(422, "No puedes eliminar al usuario actual.")
    const exists = state.users.some((item) => item.id === userId)
    if (!exists) return failure(404, "Usuario no encontrado.")
    state.users = state.users.filter((item) => item.id !== userId)
    state.sessions = state.sessions.filter((item) => item.userId !== userId)
    appendMonitoringEvent(state, currentUser, "user_delete", "user", userId, {})
    saveState(state)
    return success({ ok: true, id: userId }, 200)
  }

  if (routeKey === "GET:/security-questions") {
    return success(wrapData(state.securityQuestions.filter((item) => item.active)), 200)
  }

  return failure(404, `Endpoint mock no encontrado: ${methodUpper} ${pathname}`)
}
