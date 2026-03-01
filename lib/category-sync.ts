import type { Category } from "@/lib/api-types"
import { resolveDataSource } from "@/lib/data-source"
import { updateStore } from "@/lib/store"

const SYNC_TTL_MS = 10_000
let lastSync = 0
let inflight: Promise<void> | null = null

const categoriesEqual = (left: Category[], right: Category[]) => {
  if (left.length !== right.length) return false
  const map = new Map(left.map((category) => [category.id, category.name]))
  return right.every((category) => map.get(category.id) === category.name)
}

export const syncCategories = async (force = false) => {
  const now = Date.now()
  if (!force && now - lastSync < SYNC_TTL_MS) return
  if (inflight) return inflight

  inflight = (async () => {
    const { mode, dataSource } = await resolveDataSource(force)
    if (mode !== "API") {
      lastSync = Date.now()
      return
    }

    const categories = await dataSource.listCategories()
    updateStore((store) => {
      if (categoriesEqual(store.categories, categories)) {
        return store
      }
      return { ...store, categories }
    })
    lastSync = Date.now()
  })()
    .catch(() => {
      lastSync = Date.now()
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}
