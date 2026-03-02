const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const projectRoot = process.cwd()
const routeDir = path.join(projectRoot, "app", "api", "mock", "[[...path]]")
const routePath = path.join(routeDir, "route.ts")
const backupPath = path.join(routeDir, "route.ts.disabled")

const restoreRouteFile = () => {
  if (!fs.existsSync(backupPath)) {
    return
  }
  if (fs.existsSync(routePath)) {
    fs.rmSync(backupPath)
    return
  }
  fs.renameSync(backupPath, routePath)
}

const disableMockApiRouteForStaticExport = () => {
  if (fs.existsSync(routePath)) {
    fs.renameSync(routePath, backupPath)
  }
}

const run = () => {
  restoreRouteFile()
  disableMockApiRouteForStaticExport()
  const env = { ...process.env, NEXT_OUTPUT_MODE: "export" }
  const nextCli = require.resolve("next/dist/bin/next")
  const result = spawnSync(process.execPath, [nextCli, "build", "--webpack"], {
    stdio: "inherit",
    env,
  })
  restoreRouteFile()
  if (typeof result.status === "number") {
    process.exit(result.status)
  }
  process.exit(1)
}

try {
  run()
} catch (error) {
  try {
    restoreRouteFile()
  } catch {
    // no-op
  }
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[build-renderer-export] ${message}`)
  process.exit(1)
}

