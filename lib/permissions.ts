import type { User } from "@/lib/api-types"

export interface Permissions {
  canViewSuppliers: boolean
  canManageSuppliers: boolean
  canDeleteSuppliers: boolean
  canActivateSuppliers: boolean

  canViewPurchaseOrders: boolean
  canCreatePurchaseOrders: boolean
  canSubmitPurchaseOrders: boolean
  canApprovePurchaseOrders: boolean
  canRejectPurchaseOrders: boolean
  canCertifyPurchaseOrders: boolean
  canReceivePurchaseOrders: boolean
  canRemovePurchaseOrderItems: boolean

  canViewProducts: boolean
  canManageProducts: boolean
  canManagePriceLists: boolean

  canViewInventory: boolean
  canManageInventory: boolean

  canViewFinance: boolean
  canManageFinance: boolean

  canViewMonitoring: boolean
  canViewReports: boolean
  canManageUsers: boolean
  canManageSettings: boolean

  // Legacy flags for compatibility with old screens.
  canViewInvoices: boolean
  canCreateInvoices: boolean
  canViewPayments: boolean
  canCreatePayments: boolean
  canViewAudit: boolean
  canCancelPurchaseOrders: boolean
}

const DEFAULT_PERMISSIONS: Permissions = {
  canViewSuppliers: false,
  canManageSuppliers: false,
  canDeleteSuppliers: false,
  canActivateSuppliers: false,

  canViewPurchaseOrders: false,
  canCreatePurchaseOrders: false,
  canSubmitPurchaseOrders: false,
  canApprovePurchaseOrders: false,
  canRejectPurchaseOrders: false,
  canCertifyPurchaseOrders: false,
  canReceivePurchaseOrders: false,
  canRemovePurchaseOrderItems: false,

  canViewProducts: false,
  canManageProducts: false,
  canManagePriceLists: false,

  canViewInventory: false,
  canManageInventory: false,

  canViewFinance: false,
  canManageFinance: false,

  canViewMonitoring: false,
  canViewReports: false,
  canManageUsers: false,
  canManageSettings: false,

  canViewInvoices: false,
  canCreateInvoices: false,
  canViewPayments: false,
  canCreatePayments: false,
  canViewAudit: false,
  canCancelPurchaseOrders: false,
}

const normalizeRole = (role?: string): "superadmin" | "finanzas" | "procura" => {
  const normalized = (role ?? "").trim().toLowerCase()
  if (normalized === "superadmin" || normalized === "admin" || normalized === "gerente") return "superadmin"
  if (normalized === "finanzas" || normalized === "finance" || normalized === "administradora") return "finanzas"
  return "procura"
}

const ROLE_PERMISSIONS: Record<"superadmin" | "finanzas" | "procura", Permissions> = {
  superadmin: {
    ...DEFAULT_PERMISSIONS,
    canViewSuppliers: true,
    canManageSuppliers: true,
    canDeleteSuppliers: true,
    canActivateSuppliers: true,

    canViewPurchaseOrders: true,
    canCreatePurchaseOrders: true,
    canSubmitPurchaseOrders: true,
    canApprovePurchaseOrders: true,
    canRejectPurchaseOrders: true,
    canCertifyPurchaseOrders: true,
    canReceivePurchaseOrders: true,
    canRemovePurchaseOrderItems: true,

    canViewProducts: true,
    canManageProducts: true,
    canManagePriceLists: true,

    canViewInventory: true,
    canManageInventory: true,

    canViewFinance: true,
    canManageFinance: true,

    canViewMonitoring: true,
    canViewReports: true,
    canManageUsers: true,
    canManageSettings: true,

    canViewInvoices: true,
    canCreateInvoices: true,
    canViewPayments: true,
    canCreatePayments: true,
    canViewAudit: true,
    canCancelPurchaseOrders: true,
  },
  finanzas: {
    ...DEFAULT_PERMISSIONS,
    canViewSuppliers: true,
    canViewPurchaseOrders: true,
    canViewFinance: true,
    canManageFinance: true,
    canViewMonitoring: true,
    canViewReports: true,

    canViewInvoices: true,
    canCreateInvoices: true,
    canViewPayments: true,
    canCreatePayments: true,
  },
  procura: {
    ...DEFAULT_PERMISSIONS,
    canViewSuppliers: true,
    canManageSuppliers: true,

    canViewPurchaseOrders: true,
    canCreatePurchaseOrders: true,
    canSubmitPurchaseOrders: true,
    canCertifyPurchaseOrders: true,
    canReceivePurchaseOrders: true,

    canViewProducts: true,
    canManageProducts: true,
    canManagePriceLists: true,

    canViewInventory: true,
    canManageInventory: true,

    canViewMonitoring: true,
    canViewReports: true,
  },
}

export const getPermissions = (user: User | null | undefined): Permissions => {
  if (!user) return DEFAULT_PERMISSIONS
  const role = normalizeRole(user.role)
  return ROLE_PERMISSIONS[role] ?? DEFAULT_PERMISSIONS
}

export const roleLabel = (role?: string) => {
  const normalized = normalizeRole(role)
  if (normalized === "superadmin") return "Superadmin"
  if (normalized === "finanzas") return "Finanzas"
  return "Procura"
}

export const canonicalRole = normalizeRole
