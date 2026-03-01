"use client"

import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createApiClient } from "@/lib/api-client"
import type { PurchaseOrder, Supplier } from "@/lib/api-types"
import { syncCategories } from "@/lib/category-sync"
import { getCurrentUser, loadStore, signOut, updateStore, useAppStore } from "@/lib/store"

const parsePaginatedData = <T,>(payload: unknown): T[] => {
  if (typeof payload !== "object" || payload === null) return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data as T[]
}

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

export function AuthGuard({ children }: { children: ReactNode }) {
  const apiClient = createApiClient({ timeoutMs: 2500, retries: 0 })
  const router = useRouter()
  const store = useAppStore()
  const currentUser = getCurrentUser(store)
  const currentUserId = currentUser?.id ?? ""
  const sessionToken = store.session?.token ?? ""
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
    if (!sessionToken || !currentUserId) {
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
        const nextSuppliers = suppliersResponse.ok ? parsePaginatedData<Supplier>(suppliersResponse.data) : null
        const nextOrders = ordersResponse.ok ? parsePaginatedData<PurchaseOrder>(ordersResponse.data) : null

        updateStore((storeState) => {
          let changed = false
          let nextState = storeState

          if (nextSuppliers && !sameJson(storeState.suppliers, nextSuppliers)) {
            nextState = { ...nextState, suppliers: nextSuppliers }
            changed = true
          }

          if (nextOrders && !sameJson(storeState.purchaseOrders, nextOrders)) {
            nextState = { ...nextState, purchaseOrders: nextOrders }
            changed = true
          }

          return changed ? nextState : storeState
        })
      }
    }
    void validateSession()
    return () => {
      cancelled = true
    }
  }, [currentUserId, hasCheckedSession, router, sessionToken])

  if (!hasCheckedSession || !store.session || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Cargando sesión...
      </div>
    )
  }

  return <>{children}</>
}

