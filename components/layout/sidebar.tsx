"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Activity, Boxes, ClipboardList, FileBarChart2, Settings, Users, Wallet } from "lucide-react"

import { canonicalRole, getPermissions, roleLabel } from "@/lib/permissions"
import { getCurrentUser, useAppStore } from "@/lib/store"
import { cn } from "@/lib/utils"

const SYSTEM_NAME = "Sistema de Gestion Administrativa de activos industriales en Servicios y Mantenimientos AGUILERA21 C.A."

export function Sidebar() {
  const pathname = usePathname()
  const store = useAppStore()
  const currentUser = getCurrentUser(store)
  const permissions = getPermissions(currentUser)
  const role = canonicalRole(currentUser?.role)

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
      title: "Ordenes de Compra",
      href: "/purchase-orders",
      icon: ClipboardList,
      visible: permissions.canViewPurchaseOrders,
    },
    {
      title: "Almacen",
      href: "/inventory",
      icon: Boxes,
      visible: permissions.canViewInventory,
    },
    {
      title: "Finanzas",
      href: "/finanzas",
      icon: Wallet,
      visible: permissions.canViewFinance,
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
        <h1 className="text-sm font-semibold leading-tight text-primary">{SYSTEM_NAME}</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          {currentUser ? `${currentUser.name} - ${roleLabel(currentUser.role)}` : "Sin sesion"}
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
