"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Bell, Moon, Search, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { createApiClient } from "@/lib/api-client"
import { getCachedDataMode, resolveDataSource, type DataMode } from "@/lib/data-source"
import { roleLabel } from "@/lib/permissions"
import { getCurrentUser, signOut, useAppStore } from "@/lib/store"
import { cn } from "@/lib/utils"

const SYSTEM_NAME = "SYMBIOS"

const buildInitials = (name?: string) => {
  if (!name) return "--"
  const parts = name.split(" ").filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

export function TopNav() {
  const { theme, setTheme } = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const store = useAppStore()
  const currentUser = getCurrentUser(store)
  const [query, setQuery] = useState("")
  const [isFocused, setIsFocused] = useState(false)
  const [dataMode, setDataMode] = useState<DataMode>(getCachedDataMode())
  const apiClient = useMemo(() => createApiClient({ timeoutMs: 2500, retries: 0 }), [])

  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) {
      return {
        suppliers: [],
        purchaseOrders: [],
      }
    }

    const match = (value: string) => value.toLowerCase().includes(term)
    return {
      suppliers: store.suppliers.filter((supplier) => match(supplier.name)).slice(0, 5),
      purchaseOrders: store.purchaseOrders
        .filter((order) => match(order.orderNumber) || match(order.supplierName))
        .slice(0, 5),
    }
  }, [query, store.purchaseOrders, store.suppliers])

  const totalResults = searchResults.suppliers.length + searchResults.purchaseOrders.length

  const notifications = useMemo(() => {
    const pendingOrders = store.purchaseOrders.filter((order) => order.status === "pending")
    const rejectedOrders = store.purchaseOrders.filter((order) => order.status === "rejected")
    return {
      pendingCount: pendingOrders.length,
      rejectedCount: rejectedOrders.length,
    }
  }, [store.purchaseOrders])

  const showResults = isFocused && query.trim().length > 1

  const handleLogout = async () => {
    await apiClient.request("POST", "/auth/logout")
    signOut()
    router.replace("/login")
  }

  useEffect(() => {
    setQuery("")
    setIsFocused(false)
  }, [pathname])

  useEffect(() => {
    let cancelled = false

    const refreshMode = async () => {
      const resolved = await resolveDataSource(true)
      if (!cancelled) {
        setDataMode(resolved.mode)
      }
    }

    void refreshMode()
    const intervalId = window.setInterval(() => {
      void refreshMode()
    }, 10_000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  return (
    <div className="flex h-16 items-center gap-4 border-b bg-card px-6">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{SYSTEM_NAME}</p>
      </div>

      <div className="relative w-[420px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar proveedores y OC..."
          className="pl-9"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 150)}
        />

        {showResults && (
          <div className="absolute top-full z-50 mt-2 w-full rounded-lg border bg-popover p-2 shadow-lg">
            {totalResults === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">Sin resultados para "{query}"</div>
            ) : (
              <div className="space-y-3">
                {searchResults.suppliers.length > 0 && (
                  <div>
                    <p className="px-3 text-xs font-medium text-muted-foreground">Proveedores</p>
                    <div className="mt-1 space-y-1">
                      {searchResults.suppliers.map((supplier) => (
                        <Link
                          key={supplier.id}
                          href={`/suppliers?q=${encodeURIComponent(supplier.name)}`}
                          className={cn("flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-accent")}
                        >
                          <span className="font-medium">{supplier.name}</span>
                          <span className="text-xs text-muted-foreground">{supplier.rif}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {searchResults.purchaseOrders.length > 0 && (
                  <div>
                    <p className="px-3 text-xs font-medium text-muted-foreground">Órdenes de Compra</p>
                    <div className="mt-1 space-y-1">
                      {searchResults.purchaseOrders.map((order) => (
                        <Link
                          key={order.id}
                          href={`/purchase-orders?q=${encodeURIComponent(order.orderNumber)}`}
                          className="flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-accent"
                        >
                          <span className="font-medium">{order.orderNumber}</span>
                          <span className="text-xs text-muted-foreground">{order.supplierName}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Badge variant={dataMode === "API" ? "default" : "secondary"} className="tracking-wide">
          {dataMode}
        </Badge>

        <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Cambiar tema</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <Bell className="h-5 w-5" />
              <span className="sr-only">Notificaciones</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>Notificaciones</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="flex flex-col items-start gap-1">
              <span className="text-sm font-medium">OC pendientes</span>
              <span className="text-xs text-muted-foreground">
                {notifications.pendingCount > 0
                  ? `${notifications.pendingCount} pendientes de aprobación`
                  : "No hay OC pendientes"}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem className="flex flex-col items-start gap-1">
              <span className="text-sm font-medium">OC rechazadas</span>
              <span className="text-xs text-muted-foreground">
                {notifications.rejectedCount > 0
                  ? `${notifications.rejectedCount} requieren gestion`
                  : "No hay OC rechazadas"}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback>{buildInitials(currentUser?.name)}</AvatarFallback>
              </Avatar>
              <div className="hidden text-left md:block">
                <p className="text-sm font-medium leading-none">{currentUser?.name ?? "Usuario"}</p>
                <p className="text-xs text-muted-foreground">{roleLabel(currentUser?.role)}</p>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Mi Cuenta</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/settings")}>Ajustes</DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
