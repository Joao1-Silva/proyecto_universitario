import { isBrowserMockApiEnabled, mockApiRequest } from "./browser-mock-api"

export interface ApiClientResult<T = unknown> {
  ok: boolean
  statusCode: number
  data?: T
  error?: string
}

interface ApiClientOptions {
  baseUrl?: string
  timeoutMs?: number
  retries?: number
}

const DEFAULT_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000"
const DEFAULT_TIMEOUT_MS = 2500
const DEFAULT_RETRIES = 1
let browserMockTransport: "unknown" | "server" | "local" = "unknown"

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const readErrorMessage = (value: unknown) => {
  if (isObject(value) && typeof value.error === "string") return value.error
  if (isObject(value) && typeof value.detail === "string") return value.detail
  return undefined
}

const hasElectronBridge = () =>
  typeof window !== "undefined" &&
  typeof window.api !== "undefined" &&
  typeof window.api.backend?.request === "function"

const hasElectronHealthBridge = () =>
  typeof window !== "undefined" &&
  typeof window.api !== "undefined" &&
  typeof window.api.backend?.health === "function"

const readSessionToken = (): string | null => {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem("ppd:store:v2")
    if (!raw) return null
    const parsed = JSON.parse(raw) as { session?: { token?: unknown } }
    const token = parsed.session?.token
    if (typeof token !== "string" || !token.trim()) return null
    return token.trim()
  } catch {
    return null
  }
}

const parseHttpPayload = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    return response.json()
  }

  const text = await response.text()
  return text.length ? text : undefined
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const normalizeApiPath = (path: string): string => (path.startsWith("/") ? path : `/${path}`)

export class ApiClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly retries: number

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.retries = options.retries ?? DEFAULT_RETRIES
  }

  private buildHeaders(hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {}
    if (hasBody) {
      headers["Content-Type"] = "application/json"
    }
    const token = readSessionToken()
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
    return headers
  }

  private async requestWithFetch<T>(method: string, path: string, body?: unknown): Promise<ApiClientResult<T>> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`
    const hasBody = body !== undefined
    const headers = this.buildHeaders(hasBody)

    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: hasBody ? JSON.stringify(body) : undefined,
      })
      const payload = await parseHttpPayload(response)

      return {
        ok: response.ok,
        statusCode: response.status,
        data: payload as T,
        error: response.ok ? undefined : readErrorMessage(payload) ?? `HTTP ${response.status}`,
      }
    } catch (error) {
      return {
        ok: false,
        statusCode: 0,
        error: error instanceof Error ? error.message : "Network request failed",
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async requestWithBrowserMockServer<T>(
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<ApiClientResult<T>> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)
    const normalizedPath = normalizeApiPath(path)
    const url = `/api/mock${normalizedPath}`
    const hasBody = body !== undefined

    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: hasBody ? JSON.stringify(body) : undefined,
      })
      const payload = await parseHttpPayload(response)
      return {
        ok: response.ok,
        statusCode: response.status,
        data: payload as T,
        error: response.ok ? undefined : readErrorMessage(payload) ?? `HTTP ${response.status}`,
      }
    } catch (error) {
      return {
        ok: false,
        statusCode: 0,
        error: error instanceof Error ? error.message : "Network request failed",
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async requestWithBrowserMock<T>(method: string, path: string, body?: unknown): Promise<ApiClientResult<T>> {
    const headers = this.buildHeaders(body !== undefined)
    const canUseServerTransport = typeof window !== "undefined" && !hasElectronBridge()

    if (canUseServerTransport && browserMockTransport !== "local") {
      const serverResult = await this.requestWithBrowserMockServer<T>(method, path, body, headers)
      const serverRouteMissing = serverResult.statusCode === 404 || serverResult.statusCode === 405
      const initialNetworkFailure = browserMockTransport === "unknown" && serverResult.statusCode === 0

      if (!serverRouteMissing && !initialNetworkFailure) {
        browserMockTransport = "server"
        return serverResult
      }

      browserMockTransport = "local"
    }

    const mockResult = await mockApiRequest(method, path, body, headers)
    return {
      ok: mockResult.ok,
      statusCode: mockResult.statusCode,
      data: mockResult.data as T | undefined,
      error: mockResult.error,
    }
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<ApiClientResult<T>> {
    const retries = Math.max(this.retries, 0)
    const headers = this.buildHeaders(body !== undefined)

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      let result: ApiClientResult<T>

      if (hasElectronBridge()) {
        const bridgeResult = await window.api.backend.request(method, path, body, headers)
        result = {
          ok: bridgeResult.ok,
          statusCode: bridgeResult.statusCode ?? 0,
          data: bridgeResult.data as T | undefined,
          error: bridgeResult.error,
        }
      } else if (isBrowserMockApiEnabled()) {
        result = await this.requestWithBrowserMock<T>(method, path, body)
      } else {
        result = await this.requestWithFetch<T>(method, path, body)
      }

      if (result.ok) return result
      if (attempt < retries) {
        await sleep(200 * (attempt + 1))
      } else {
        return result
      }
    }

    return {
      ok: false,
      statusCode: 0,
      error: "Unexpected API request failure",
    }
  }

  async health(): Promise<ApiClientResult<Record<string, unknown>>> {
    if (hasElectronHealthBridge()) {
      const bridgeResult = await window.api.backend.health()
      return {
        ok: bridgeResult.ok,
        statusCode: bridgeResult.statusCode ?? 0,
        data: bridgeResult.data as Record<string, unknown> | undefined,
        error: bridgeResult.error,
      }
    }

    if (isBrowserMockApiEnabled()) {
      return this.requestWithBrowserMock<Record<string, unknown>>("GET", "/health")
    }

    return this.request<Record<string, unknown>>("GET", "/health")
  }
}

export const createApiClient = (options: ApiClientOptions = {}) => new ApiClient(options)
