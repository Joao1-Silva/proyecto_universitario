"use client"

import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createApiClient } from "@/lib/api-client"
import { syncCategories } from "@/lib/category-sync"
import { getCurrentUser, loadStore, signOut, updateStore, useAppStore } from "@/lib/store"

const parsePaginatedData = <T,>(payload: unknown): T[] => {
  if (typeof payload !== "object" || payload === null) return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data as T[]
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const apiClient = createApiClient({ timeoutMs: 2500, retries: 0 })
  const router = useRouter()
  const store = useAppStore()
  const currentUser = getCurrentUser(store)
  const [hasCheckedSession, setHasCheckedSession] = useState(false)

  useEffect(() => {
    const loaded = loadStore()
    setHasCheckedSession(true)
    if (!loaded.session || !getCurrentUser(loaded)) {
      signOut()
      router.replace("/login")
    }
  }, [router])

  useEffect(() => {
    if (!hasCheckedSession) return
    if (!store.session || !currentUser) {
      signOut()
      router.replace("/login")
      return
    }
    let cancelled = false
    const validateSession = async () => {
      const response = await apiClient.request<unknown>("GET", "/auth/me")
      if (cancelled) return
      if (!response.ok) {
        signOut()
        router.replace("/login")
        return
      }
      await syncCategories()

      const [suppliersResponse, ordersResponse] = await Promise.all([
        apiClient.request<unknown>("GET", "/suppliers"),
        apiClient.request<unknown>("GET", "/purchase-orders?page=1&pageSize=100"),
      ])
      if (cancelled) return

      if (suppliersResponse.ok || ordersResponse.ok) {
        updateStore((storeState) => ({
          ...storeState,
          ...(suppliersResponse.ok ? { suppliers: parsePaginatedData(suppliersResponse.data) } : {}),
          ...(ordersResponse.ok ? { purchaseOrders: parsePaginatedData(ordersResponse.data) } : {}),
        }))
      }
    }
    void validateSession()
    return () => {
      cancelled = true
    }
  }, [currentUser, hasCheckedSession, router, store.session])

  if (!hasCheckedSession || !store.session || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Cargando sesión...
      </div>
    )
  }

  return <>{children}</>
}

