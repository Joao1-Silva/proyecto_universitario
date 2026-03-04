import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import { spawn, type ChildProcess } from "node:child_process"
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http"
import net from "node:net"
import { app, BrowserWindow, ipcMain } from "electron"

const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL ?? "http://127.0.0.1:3000"
const isDev = !app.isPackaged
const totalSystemMemoryGb = os.totalmem() / 1024 / 1024 / 1024
const lowResourceMode = process.env.ELECTRON_LOW_RESOURCE_MODE === "1" || totalSystemMemoryGb <= 4
if (process.env.ELECTRON_DISABLE_GPU === "1" || lowResourceMode) {
  app.disableHardwareAcceleration()
}

const parsedBackendPort = Number.parseInt(process.env.BACKEND_PORT ?? "8000", 10)
const backendPort = Number.isFinite(parsedBackendPort) && parsedBackendPort > 0 ? parsedBackendPort : 8000
const defaultBackendBaseUrl = `http://127.0.0.1:${backendPort}`
const configuredBackendBaseUrl = process.env.BACKEND_BASE_URL?.trim()
let backendBaseUrl = configuredBackendBaseUrl && configuredBackendBaseUrl.length > 0 ? configuredBackendBaseUrl : defaultBackendBaseUrl

let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null
let rendererServer: HttpServer | null = null
let rendererBaseUrl: string | null = null
const startupLogPath = path.join(
  process.env.LOCALAPPDATA ?? process.cwd(),
  "SYMBIOS",
  "logs",
  "startup.log",
)

type BackendRuntimeStatus = {
  usingExternal: boolean
  started: boolean
  pid: number | null
  baseUrl: string
  pythonExecutable: string | null
  lowResourceMode: boolean
  totalSystemMemoryGb: number
  health: "unknown" | "ok" | "error"
  lastError: string | null
}

let backendStatus: BackendRuntimeStatus = {
  usingExternal: Boolean(configuredBackendBaseUrl),
  started: false,
  pid: null,
  baseUrl: backendBaseUrl,
  pythonExecutable: null,
  lowResourceMode,
  totalSystemMemoryGb: Math.round(totalSystemMemoryGb * 10) / 10,
  health: "unknown",
  lastError: null,
}

const resolvePreloadPath = () => path.join(__dirname, "preload.js")
const resolveRendererOutDir = () =>
  app.isPackaged ? path.join(app.getAppPath(), "out") : path.join(__dirname, "..", "out")
const resolveProjectRoot = () => (app.isPackaged ? process.resourcesPath : path.join(__dirname, ".."))
const resolveBackendDir = () =>
  app.isPackaged ? path.join(process.resourcesPath, "backend") : path.join(resolveProjectRoot(), "backend")
const resolvePackagedBackendExecutable = () => {
  if (!app.isPackaged) {
    return null
  }

  const executableName = process.platform === "win32" ? "backend-server.exe" : "backend-server"
  const executablePath = path.join(process.resourcesPath, "backend-runtime", executableName)
  return fs.existsSync(executablePath) ? executablePath : null
}

type BackendRequestPayload = {
  method: string
  path: string
  body?: unknown
  headers?: Record<string, string>
}

const updateBackendStatus = (partial: Partial<BackendRuntimeStatus>) => {
  backendStatus = {
    ...backendStatus,
    ...partial,
  }
}

const formatUnknownError = (error: unknown) => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`
  }
  return String(error)
}

const logStartup = (message: string, error?: unknown) => {
  const details = error ? ` | ${formatUnknownError(error)}` : ""
  const line = `[${new Date().toISOString()}] ${message}${details}`
  try {
    fs.mkdirSync(path.dirname(startupLogPath), { recursive: true })
    fs.appendFileSync(startupLogPath, `${line}\n`, "utf8")
  } catch {
    // Ignore file logging errors to avoid breaking startup.
  }
  if (error) {
    console.error(line)
  } else {
    console.log(line)
  }
}

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
}

const CACHEABLE_EXTENSIONS = new Set([".css", ".js", ".json", ".png", ".jpg", ".jpeg", ".svg", ".ico", ".woff2"])

const getMimeType = (filePath: string) => MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream"

const isPortAvailable = (port: number) =>
  new Promise<boolean>((resolve) => {
    const server = net.createServer()
    server.once("error", () => {
      resolve(false)
    })
    server.once("listening", () => {
      server.close(() => resolve(true))
    })
    server.listen(port, "127.0.0.1")
  })

const resolveRendererFilePath = (requestPath: string, rendererOutDir: string) => {
  let normalizedPath = requestPath
  try {
    normalizedPath = decodeURIComponent(requestPath)
  } catch {
    normalizedPath = requestPath
  }

  const trimmed = normalizedPath.replace(/[#?].*$/, "")
  const routePath = trimmed === "/" ? "/login" : trimmed
  const safePath = path.posix.normalize(routePath).replace(/^\/+/, "")
  if (safePath.includes("..")) {
    return null
  }

  const directFile = path.join(rendererOutDir, safePath)
  if (fs.existsSync(directFile) && fs.statSync(directFile).isFile()) {
    return directFile
  }

  if (!path.extname(safePath)) {
    const htmlFile = path.join(rendererOutDir, `${safePath}.html`)
    if (fs.existsSync(htmlFile) && fs.statSync(htmlFile).isFile()) {
      return htmlFile
    }

    const nestedIndex = path.join(rendererOutDir, safePath, "index.html")
    if (fs.existsSync(nestedIndex) && fs.statSync(nestedIndex).isFile()) {
      return nestedIndex
    }
  }

  const fallback404 = path.join(rendererOutDir, "404.html")
  if (fs.existsSync(fallback404)) {
    return fallback404
  }

  return null
}

const sendFileResponse = (response: ServerResponse<IncomingMessage>, filePath: string) => {
  const extension = path.extname(filePath).toLowerCase()
  response.statusCode = 200
  response.setHeader("Content-Type", getMimeType(filePath))
  response.setHeader("Cache-Control", CACHEABLE_EXTENSIONS.has(extension) ? "public, max-age=31536000, immutable" : "no-cache")
  fs.createReadStream(filePath)
    .on("error", (error) => {
      response.statusCode = 500
      response.end(`Failed to read file: ${formatUnknownError(error)}`)
    })
    .pipe(response)
}

const startRendererServer = async () => {
  if (isDev) {
    rendererBaseUrl = DEV_SERVER_URL
    return rendererBaseUrl
  }

  if (rendererServer && rendererBaseUrl) {
    return rendererBaseUrl
  }

  const rendererOutDir = resolveRendererOutDir()
  if (!fs.existsSync(rendererOutDir)) {
    throw new Error(`Renderer output directory not found: ${rendererOutDir}`)
  }

  const configuredPort = Number.parseInt(process.env.ELECTRON_RENDERER_PORT ?? "3180", 10)
  const startPort = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 3180
  let selectedPort: number | null = null
  for (let offset = 0; offset < 20; offset += 1) {
    const candidatePort = startPort + offset
    if (await isPortAvailable(candidatePort)) {
      selectedPort = candidatePort
      break
    }
  }

  if (selectedPort === null) {
    throw new Error(`No available port found for renderer server starting at ${startPort}`)
  }

  rendererServer = createServer((request, response) => {
    const requestPath = request.url ?? "/"
    const filePath = resolveRendererFilePath(requestPath, rendererOutDir)
    if (!filePath) {
      response.statusCode = 404
      response.end("Not found")
      return
    }
    sendFileResponse(response, filePath)
  })

  await new Promise<void>((resolve, reject) => {
    rendererServer?.once("error", reject)
    rendererServer?.listen(selectedPort, "127.0.0.1", () => resolve())
  })

  rendererBaseUrl = `http://127.0.0.1:${selectedPort}`
  logStartup(`[electron] Renderer static server started at ${rendererBaseUrl} from ${rendererOutDir}`)
  return rendererBaseUrl
}

const stopRendererServer = async () => {
  if (!rendererServer) {
    return
  }

  const serverToClose = rendererServer
  rendererServer = null
  rendererBaseUrl = null
  await new Promise<void>((resolve) => {
    serverToClose.close(() => resolve())
  })
  logStartup("[electron] Renderer static server stopped.")
}

const sanitizeBackendBaseUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.toString().replace(/\/$/, "")
  } catch {
    logStartup(`[electron] Invalid BACKEND_BASE_URL "${value}". Falling back to ${defaultBackendBaseUrl}`)
    return defaultBackendBaseUrl
  }
}

backendBaseUrl = sanitizeBackendBaseUrl(backendBaseUrl)
updateBackendStatus({ baseUrl: backendBaseUrl, usingExternal: Boolean(configuredBackendBaseUrl) })

const normalizeApiPath = (apiPath: string) => (apiPath.startsWith("/") ? apiPath : `/${apiPath}`)

const parseResponseBody = async (response: Response) => {
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    return response.json()
  }

  const text = await response.text()
  return text.length > 0 ? text : null
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const readBackendErrorMessage = (payload: unknown, statusCode: number): string => {
  if (isObject(payload)) {
    if (typeof payload.error === "string" && payload.error.trim().length > 0) {
      return payload.error.trim()
    }

    if (typeof payload.detail === "string" && payload.detail.trim().length > 0) {
      return payload.detail.trim()
    }

    if (Array.isArray(payload.detail)) {
      for (const item of payload.detail) {
        if (!isObject(item) || typeof item.msg !== "string") {
          continue
        }

        const message = item.msg.trim()
        if (!message) {
          continue
        }

        if (Array.isArray(item.loc) && item.loc.length > 0) {
          const location = item.loc
            .map((part) => String(part).trim())
            .filter((part) => part.length > 0)
            .join(".")
          if (location.length > 0) {
            return `${location}: ${message}`
          }
        }

        return message
      }
    }
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim()
  }

  return `Backend request failed (${statusCode})`
}

const callBackend = async (payload: BackendRequestPayload) => {
  try {
    const url = new URL(normalizeApiPath(payload.path), backendBaseUrl)
    const method = payload.method.toUpperCase()
    const hasBody = payload.body !== undefined
    const requestBody = hasBody ? JSON.stringify(payload.body) : undefined
    const headers: Record<string, string> = { ...(payload.headers ?? {}) }
    if (hasBody) {
      headers["Content-Type"] = "application/json"
    }

    const response = await fetch(url, { method, headers, body: requestBody })
    const data = await parseResponseBody(response)

    return {
      ok: response.ok,
      statusCode: response.status,
      data,
      error: response.ok ? undefined : readBackendErrorMessage(data, response.status),
    }
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      error: error instanceof Error ? error.message : "Unexpected backend error",
    }
  }
}

ipcMain.handle("backend:health", async () => callBackend({ method: "GET", path: "/health" }))
ipcMain.handle("backend:request", async (_event, payload: BackendRequestPayload) => callBackend(payload))
ipcMain.handle("backend:status", async () => backendStatus)

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const waitForBackendHealth = async (timeoutMs = 20000) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const health = await callBackend({ method: "GET", path: "/health" })
    if (health.ok) {
      return health
    }
    await delay(500)
  }

  return {
    ok: false,
    statusCode: 0,
    error: `Backend health check timed out after ${timeoutMs}ms`,
  }
}

const spawnBackend = () => {
  if (process.env.BACKEND_BASE_URL) {
    logStartup(`[electron] Using external backend at ${backendBaseUrl}`)
    updateBackendStatus({
      usingExternal: true,
      started: true,
      pid: null,
      pythonExecutable: null,
    })
    return
  }
  if (backendProcess) {
    return
  }

  const backendDir = resolveBackendDir()
  if (!fs.existsSync(backendDir)) {
    logStartup(`[electron] Backend directory not found: ${backendDir}`)
    updateBackendStatus({
      health: "error",
      lastError: `Backend directory not found: ${backendDir}`,
    })
    return
  }

  const packagedBackendExecutable = resolvePackagedBackendExecutable()
  const resolvePythonExecutable = () => {
    if (process.env.PYTHON_EXECUTABLE) {
      return process.env.PYTHON_EXECUTABLE
    }

    const candidates = [
      path.join(backendDir, ".venv", "Scripts", "python.exe"),
      path.join(backendDir, "venv", "Scripts", "python.exe"),
      path.join(backendDir, ".venv", "bin", "python"),
      path.join(backendDir, "venv", "bin", "python"),
    ]
    const venvPython = candidates.find((candidate) => fs.existsSync(candidate))
    if (venvPython) {
      return venvPython
    }

    logStartup("[electron] Backend virtual environment not found. Falling back to system python.")
    return "python"
  }

  const command = packagedBackendExecutable ?? resolvePythonExecutable()
  if (packagedBackendExecutable) {
    logStartup(`[electron] Using packaged backend runtime: ${packagedBackendExecutable}`)
  }
  const args = packagedBackendExecutable
    ? []
    : [
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        String(backendPort),
        "--app-dir",
        backendDir,
        ...(app.isPackaged ? ["--no-access-log"] : []),
        "--log-level",
        app.isPackaged ? "warning" : "info",
      ]
  const commandCwd = packagedBackendExecutable ? path.dirname(command) : backendDir
  const backendEnv: NodeJS.ProcessEnv = {
    ...process.env,
    API_HOST: "127.0.0.1",
    API_PORT: String(backendPort),
    PYTHONUNBUFFERED: "1",
  }
  // In packaged builds we prefer graceful fallback when MariaDB is unavailable.
  // In dev we defer DB credentials/settings to backend/.env unless explicitly
  // provided from the parent environment.
  if (!process.env.DB_REQUIRE_MARIADB) {
    backendEnv.DB_REQUIRE_MARIADB = app.isPackaged ? "false" : "true"
  }

  const child = spawn(command, args, {
    cwd: commandCwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: backendEnv,
  })

  backendProcess = child
  updateBackendStatus({
    usingExternal: false,
    started: true,
    pid: child.pid ?? null,
    pythonExecutable: command,
    lastError: null,
  })

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[backend] ${chunk}`)
  })
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[backend] ${chunk}`)
  })
  child.on("exit", (code, signal) => {
    logStartup(`[electron] Backend exited with code=${code} signal=${signal}`)
    backendProcess = null
    updateBackendStatus({
      started: false,
      pid: null,
      health: code === 0 ? "unknown" : "error",
      lastError: code === 0 ? null : `Backend exited with code=${code} signal=${signal}`,
    })
  })

  logStartup(`[electron] Spawned backend PID=${child.pid} url=${backendBaseUrl}`)
}

const stopBackend = () => {
  if (!backendProcess) {
    return
  }

  const child = backendProcess
  const pid = child.pid
  backendProcess = null

  try {
    child.kill("SIGTERM")
  } catch (error) {
    console.warn(`[electron] Backend SIGTERM failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!pid) {
    return
  }

  const forceKillTimer = setTimeout(() => {
    if (child.exitCode !== null) {
      return
    }

    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"])
    } else {
      child.kill("SIGKILL")
    }
  }, 4000)

  child.once("exit", () => {
    clearTimeout(forceKillTimer)
  })
}

async function loadRenderer(window: BrowserWindow) {
  try {
    const rendererUrl = await startRendererServer()
    await window.loadURL(`${rendererUrl}/login`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logStartup(`[electron] Renderer failed to load: ${message}`, error)
    const fallbackHtml = `
      <html>
        <head><meta charset="utf-8" /><title>SYMBIOS</title></head>
        <body style="font-family:Segoe UI,Arial,sans-serif;padding:24px">
          <h1>SYMBIOS</h1>
          <p>No se pudo cargar la interfaz.</p>
          <p>${message}</p>
        </body>
      </html>
    `
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHtml)}`)
  }
}

function createMainWindow() {
  try {
    mainWindow = new BrowserWindow({
      width: 1360,
      height: 840,
      minWidth: 1000,
      minHeight: 620,
      show: false,
      backgroundColor: "#0f172a",
      webPreferences: {
        preload: resolvePreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        devTools: isDev,
        spellcheck: false,
        backgroundThrottling: true,
      },
    })
  } catch (error) {
    logStartup("[electron] Failed to create main window.", error)
    app.quit()
    return
  }

  mainWindow.once("ready-to-show", () => {
    logStartup("[electron] Main window ready-to-show.")
    mainWindow?.show()
  })

  mainWindow.on("closed", () => {
    logStartup("[electron] Main window closed.")
    mainWindow = null
  })

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    logStartup(
      `[electron] Renderer load failure code=${errorCode} description=${errorDescription} url=${validatedURL}`,
    )
  })

  void loadRenderer(mainWindow)
}

const checkBackendHealth = async () => {
  const backendHealth = await waitForBackendHealth()
  if (backendHealth.ok) {
    logStartup("[electron] Backend health check passed.")
    updateBackendStatus({
      health: "ok",
      lastError: null,
    })
  } else {
    logStartup(`[electron] Backend health check failed: ${backendHealth.error ?? "unknown error"}`)
    updateBackendStatus({
      health: "error",
      lastError: backendHealth.error ?? "unknown error",
    })
  }
}

app.whenReady().then(() => {
  logStartup(
    `[electron] App ready. isPackaged=${app.isPackaged} lowResourceMode=${lowResourceMode} totalSystemMemoryGb=${Math.round(totalSystemMemoryGb * 10) / 10} appPath=${app.getAppPath()} resourcesPath=${process.resourcesPath}`,
  )
  spawnBackend()
  createMainWindow()
  void checkBackendHealth()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

process.on("unhandledRejection", (reason) => {
  logStartup("[electron] Unhandled promise rejection.", reason)
})

process.on("uncaughtException", (error) => {
  logStartup("[electron] Uncaught exception.", error)
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("before-quit", () => {
  logStartup("[electron] before-quit received.")
  void stopRendererServer()
  stopBackend()
})
