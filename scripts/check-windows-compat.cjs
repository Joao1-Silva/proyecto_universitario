const os = require("node:os")
const { spawnSync } = require("node:child_process")

const checks = []

const addCheck = (status, item, detail) => {
  checks.push({ status, item, detail })
}

const parseSemver = (value) => {
  const [major = "0", minor = "0", patch = "0"] = value.split(".")
  return {
    major: Number.parseInt(major, 10) || 0,
    minor: Number.parseInt(minor, 10) || 0,
    patch: Number.parseInt(patch, 10) || 0,
  }
}

const gte = (value, minimum) => {
  if (value.major !== minimum.major) {
    return value.major > minimum.major
  }
  if (value.minor !== minimum.minor) {
    return value.minor > minimum.minor
  }
  return value.patch >= minimum.patch
}

if (process.platform !== "win32") {
  addCheck("FAIL", "Operating System", `Unsupported platform: ${process.platform}. Use Windows 10/11.`)
} else {
  const release = os.release()
  const [majorText = "0", minorText = "0", buildText = "0"] = release.split(".")
  const major = Number.parseInt(majorText, 10) || 0
  const minor = Number.parseInt(minorText, 10) || 0
  const build = Number.parseInt(buildText, 10) || 0

  if (major === 10 && minor === 0 && build >= 10240) {
    const windowsName = build >= 22000 ? "Windows 11" : "Windows 10"
    addCheck("PASS", "Operating System", `${windowsName} detected (${release}).`)
    if (build < 19044) {
      addCheck("WARN", "Windows Build", "Build is old. Update to latest cumulative updates for better stability.")
    }
  } else {
    addCheck("FAIL", "Operating System", `Unsupported Windows version (${release}). Use Windows 10 or 11.`)
  }
}

const architecture = os.arch()
if (architecture === "x64" || architecture === "arm64") {
  addCheck("PASS", "Architecture", `Supported architecture: ${architecture}.`)
} else {
  addCheck("FAIL", "Architecture", `Unsupported architecture: ${architecture}. Build targets are x64/arm64.`)
}

const totalMemoryGb = Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10
if (totalMemoryGb >= 4) {
  addCheck("PASS", "RAM", `${totalMemoryGb} GB detected (minimum: 4 GB).`)
  if (totalMemoryGb < 8) {
    addCheck("WARN", "RAM", "8 GB+ is recommended for smoother multitasking.")
  }
} else {
  addCheck("FAIL", "RAM", `${totalMemoryGb} GB detected. Minimum recommended is 4 GB.`)
}

const nodeVersion = parseSemver(process.versions.node)
const minimumNode = { major: 20, minor: 9, patch: 0 }
if (gte(nodeVersion, minimumNode)) {
  addCheck("PASS", "Node.js", `Node ${process.versions.node} is compatible (>= 20.9.0).`)
  const ltsMajors = new Set([20, 22, 24])
  if (!ltsMajors.has(nodeVersion.major)) {
    addCheck("WARN", "Node.js", "Use an LTS line (20.x, 22.x or 24.x) for production stability.")
  }
} else {
  addCheck("FAIL", "Node.js", `Node ${process.versions.node} is below required 20.9.0.`)
}

const python = spawnSync("python", ["--version"], { encoding: "utf8", shell: false })
if (python.status === 0) {
  const output = `${python.stdout}${python.stderr}`.trim()
  const versionMatch = output.match(/Python\s+(\d+\.\d+\.\d+)/i)
  if (!versionMatch) {
    addCheck("WARN", "Python", `Unable to parse Python version: "${output}".`)
  } else {
    const pythonVersion = parseSemver(versionMatch[1])
    const minimumPython = { major: 3, minor: 11, patch: 0 }
    if (gte(pythonVersion, minimumPython)) {
      addCheck("PASS", "Python", `${versionMatch[1]} is valid for backend build/runtime packaging.`)
    } else {
      addCheck("WARN", "Python", `${versionMatch[1]} detected. Use Python 3.11+ for packaging tasks.`)
    }
  }
} else {
  addCheck("WARN", "Python", "Python was not found in PATH. Required only for development/build tasks.")
}

console.log("SGA-AGUILERA21 Windows compatibility report")
console.log("=======================================")
for (const check of checks) {
  console.log(`[${check.status}] ${check.item}: ${check.detail}`)
}

const hasFail = checks.some((check) => check.status === "FAIL")
if (hasFail) {
  console.error("\nResult: NOT COMPATIBLE. Resolve FAIL items before deployment.")
  process.exit(1)
}

console.log("\nResult: COMPATIBLE for Windows runtime checks.")
