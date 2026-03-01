export interface BackendHealthResult {
  ok: boolean
  error?: string
  statusCode?: number
  data?: unknown
}

export interface BackendRequestResult {
  ok: boolean
  statusCode?: number
  data?: unknown
  error?: string
}

export interface BackendStatusResult {
  usingExternal: boolean
  started: boolean
  pid: number | null
  baseUrl: string
  pythonExecutable: string | null
  health: "unknown" | "ok" | "error"
  lastError: string | null
}

export interface ElectronApi {
  backend: {
    health: () => Promise<BackendHealthResult>
    request: (
      method: string,
      path: string,
      body?: unknown,
      headers?: Record<string, string>,
    ) => Promise<BackendRequestResult>
    status: () => Promise<BackendStatusResult>
  }
}

declare global {
  interface Window {
    api: ElectronApi
  }
}

export {}
