const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const projectRoot = process.cwd()
const backendDir = path.join(projectRoot, "backend")
const backendEntry = path.join(backendDir, "server_entry.py")
const backendRequirements = path.join(backendDir, "requirements.txt")
const distRoot = path.join(projectRoot, "backend-dist")
const pyInstallerWork = path.join(projectRoot, "backend-build", "work")
const pyInstallerSpec = path.join(projectRoot, "backend-build", "spec")
const pythonExecutable = process.env.PYTHON_EXECUTABLE || "python"

const run = (args, cwd = projectRoot) => {
  const result = spawnSync(pythonExecutable, args, {
    cwd,
    stdio: "inherit",
    shell: false,
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (!fs.existsSync(backendEntry)) {
  console.error(`[build-backend-runtime] Missing backend entry script: ${backendEntry}`)
  process.exit(1)
}

if (!fs.existsSync(backendRequirements)) {
  console.error(`[build-backend-runtime] Missing requirements file: ${backendRequirements}`)
  process.exit(1)
}

fs.rmSync(distRoot, { recursive: true, force: true })
fs.mkdirSync(distRoot, { recursive: true })
fs.mkdirSync(pyInstallerWork, { recursive: true })
fs.mkdirSync(pyInstallerSpec, { recursive: true })

console.log("[build-backend-runtime] Installing Python dependencies...")
run(["-m", "pip", "install", "-r", backendRequirements, "pyinstaller"])

console.log("[build-backend-runtime] Building backend runtime with PyInstaller...")
run([
  "-m",
  "PyInstaller",
  "--noconfirm",
  "--clean",
  "--name",
  "backend-server",
  "--distpath",
  distRoot,
  "--workpath",
  pyInstallerWork,
  "--specpath",
  pyInstallerSpec,
  "--collect-all",
  "uvicorn",
  "--collect-all",
  "reportlab",
  "--hidden-import",
  "pymysql",
  "--hidden-import",
  "sqlalchemy.dialects.mysql.pymysql",
  "--hidden-import",
  "bcrypt",
  backendEntry,
])

const outputDir = path.join(distRoot, "backend-server")
const outputExe = path.join(outputDir, "backend-server.exe")
if (!fs.existsSync(outputExe)) {
  console.error(`[build-backend-runtime] Build finished but executable was not found: ${outputExe}`)
  process.exit(1)
}

console.log(`[build-backend-runtime] Runtime generated at: ${outputDir}`)
