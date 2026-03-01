import { createApiClient } from "@/lib/api-client"

import { apiDataSource } from "./ApiDataSource"
import { localDataSource } from "./LocalDataSource"
import type { DataMode, DataSource } from "./types"

const apiClient = createApiClient({
  timeoutMs: 1500,
  retries: 0,
})

const MODE_CACHE_TTL_MS = 10_000

let cachedMode: DataMode = "LOCAL"
let cacheTimestamp = 0

const chooseMode = async (): Promise<DataMode> => {
  const health = await apiClient.health()
  if (!health.ok) {
    return "LOCAL"
  }

  const payload = (health.data ?? {}) as { status?: string; mode?: string }
  return payload.status === "ok" && payload.mode === "api" ? "API" : "LOCAL"
}

export const resolveDataSource = async (force = false): Promise<{ mode: DataMode; dataSource: DataSource }> => {
  const now = Date.now()
  if (force || now - cacheTimestamp > MODE_CACHE_TTL_MS) {
    cachedMode = await chooseMode()
    cacheTimestamp = now
  }

  return {
    mode: cachedMode,
    dataSource: cachedMode === "API" ? apiDataSource : localDataSource,
  }
}

export const getCachedDataMode = (): DataMode => cachedMode

export type { DataMode, DataSource, SupplierInput, SupplierUpdateInput } from "./types"
export { apiDataSource } from "./ApiDataSource"
export { localDataSource } from "./LocalDataSource"
