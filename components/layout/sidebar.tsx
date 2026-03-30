"use client"

import { useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Activity, Boxes, ClipboardList, FileBarChart2, Settings, Users, Wallet } from "lucide-react"

import { createApiClient } from "@/lib/api-client"
import type { CompanySettings } from "@/lib/api-types"
import { canonicalRole, getPermissions, roleLabel } from "@/lib/permissions"
import { getCurrentUser, updateStore, useAppStore } from "@/lib/store"
import { cn } from "@/lib/utils"

const SYSTEM_NAME = "SYMBIOS"
const apiClient = createApiClient({ timeoutMs: 2500, retries: 0 })

const readData = <T,>(payload: unknown): T | null => {
  if (typeof payload !== "object" || payload === null) return null
  const data = (payload as { data?: unknown }).data
  if (data === undefined) return null
  return data as T
}

const normalizeCompanySettings = (value: CompanySettings | null): CompanySettings => ({
  name: value?.name ?? "",
  rif: value?.rif ?? "",
  address: value?.address ?? "",
  phone: value?.phone ?? "",
  email: value?.email ?? "",
  logo: typeof value?.logo === "string" && value.logo.trim() ? value.logo : undefined,
})

export function Sidebar() {
  const pathname = usePathname()
  const store = useAppStore()
  const currentUser = getCurrentUser(store)
  const permissions = getPermissions(currentUser)
  const role = canonicalRole(currentUser?.role)
  const companySettings = normalizeCompanySettings(store.companySettings)
  const companyName = companySettings.name.trim() || SYSTEM_NAME
  const companyLogo = companySettings.logo ?? undefined

  useEffect(() => {
    if (!currentUser) return

    let cancelled = false

    const loadCompanySettings = async () => {
      const response = await apiClient.request<unknown>("GET", "/company-settings")
      if (!response.ok || cancelled) return

      const nextCompanySettings = normalizeCompanySettings(readData<CompanySettings>(response.data))
      updateStore((storeState) => ({
        ...storeState,
        companySettings: nextCompanySettings,
      }))
    }

    void loadCompanySettings()

    return () => {
      cancelled = true
    }
  }, [currentUser?.id])

  const menuItems = [
    {
      title: "Monitoreo",
      href: "/monitoring",
      icon: Activity,
      visible: permissions.canViewMonitoring,
    },
    {
      title: "Proveedores",
      href: "/suppliers",
      icon: Users,
      visible: permissions.canViewSuppliers,
    },
    {
      title: "Órdenes de Compra",
      href: "/purchase-orders",
      icon: ClipboardList,
      visible: permissions.canViewPurchaseOrders,
    },
    {
      title: "Finanzas",
      href: "/finanzas",
      icon: Wallet,
      visible: permissions.canViewFinance,
    },
    {
      title: "Almacén",
      href: "/inventory",
      icon: Boxes,
      visible: permissions.canViewInventory,
    },
    {
      title: "Reportes",
      href: "/reports",
      icon: FileBarChart2,
      visible: permissions.canViewReports,
    },
    {
      title: "Ajustes",
      href: "/settings",
      icon: Settings,
      visible: role === "superadmin" || permissions.canManageSettings,
    },
  ]

  return (
    <div className="flex h-full w-72 flex-col border-r bg-card">
      <div className="border-b px-5 py-4">
        {companyLogo ? (
          <div className="inline-flex max-w-full items-center rounded-lg bg-muted/30 px-3 py-2">
            <img
              src={companyLogo}
              alt={`Logo de ${companyName}`}
              className="h-16 w-auto max-w-[220px] object-contain object-left drop-shadow-sm"
            />
          </div>
        ) : (
          <h1 className="text-sm font-semibold leading-tight text-primary">{companyName}</h1>
        )}
        {companyLogo ? <h1 className="mt-3 text-sm font-semibold leading-tight text-primary">{companyName}</h1> : null}
        <p className="mt-2 text-xs text-muted-foreground">
          {currentUser ? `${currentUser.name} - ${roleLabel(currentUser.role)}` : "Sin sesión"}
        </p>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {menuItems
          .filter((item) => item.visible)
          .map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="h-5 w-5" />
                {item.title}
              </Link>
            )
          })}
      </nav>
    </div>
  )
}
