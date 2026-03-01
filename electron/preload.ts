import { contextBridge, ipcRenderer } from "electron"
import type { BackendHealthResult, BackendRequestResult, BackendStatusResult } from "./electron-env"

contextBridge.exposeInMainWorld("api", {
  backend: {
    health: async (): Promise<BackendHealthResult> => ipcRenderer.invoke("backend:health"),
    request: async (
      method: string,
      path: string,
      body?: unknown,
      headers?: Record<string, string>,
    ): Promise<BackendRequestResult> =>
      ipcRenderer.invoke("backend:request", { method, path, body, headers }),
    status: async (): Promise<BackendStatusResult> => ipcRenderer.invoke("backend:status"),
  },
})
