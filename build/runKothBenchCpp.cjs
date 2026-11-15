const path = require("node:path")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")

const ROOT = path.join(__dirname, "..")
const SRC_DIR = path.join(ROOT, "tests/koth_tune")
const BUILD_DIR = path.join(ROOT, "out", "build", "x64-Release")

const EXE_CANDIDATES = [
  path.join(BUILD_DIR, "bin", "Release", "koth_bench.exe"),
  path.join(BUILD_DIR, "bin", "Release", "koth_bench"),
  path.join(BUILD_DIR, "bin", "koth_bench.exe"),
  path.join(BUILD_DIR, "bin", "koth_bench"),
  path.join(SRC_DIR, "build", "Release", "koth_bench.exe"),
  path.join(SRC_DIR, "build", "Release", "koth_bench"),
  path.join(SRC_DIR, "build", "koth_bench.exe"),
  path.join(SRC_DIR, "build", "koth_bench"),
]

function findExe() {
  for (const exe of EXE_CANDIDATES) {
    if (fs.existsSync(exe)) return exe
  }
  return null
}

function collectSourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(full, out)
    else if (/\.(cpp|hpp)$/.test(entry.name)) out.push(full)
  }
  return out
}

function newestMtime(files) {
  let newest = 0
  for (const file of files) {
    if (!fs.existsSync(file)) continue
    const mtime = fs.statSync(file).mtimeMs
    if (mtime > newest) newest = mtime
  }
  return newest
}

function needsRebuild(exe, args) {
  if (args.includes("--force")) return true
  if (!fs.existsSync(path.join(BUILD_DIR, "CMakeCache.txt"))) return true
  if (!exe) return true

  const sources = [
    ...collectSourceFiles(path.join(SRC_DIR, "src")),
    path.join(SRC_DIR, "CMakeLists.txt"),
    path.join(ROOT, "CMakeLists.txt"),
    path.join(ROOT, "CMakeSettings.json"),
    path.join(ROOT, "cmake", "BuildTypes.cmake"),
  ]
  const srcMtime = newestMtime(sources)
  const exeMtime = fs.statSync(exe).mtimeMs
  return srcMtime > exeMtime
}

// The native build needs the MSVC environment (Ninja calls cl.exe directly), so
// delegate to the shared PowerShell wrapper instead of invoking cmake here.
function buildBench() {
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(ROOT, "cmake", "Build-Native.ps1"),
      "-Configure",
      "-Target",
      "koth_bench",
    ],
    { stdio: "inherit", cwd: ROOT },
  )
}

function main() {
  const args = process.argv.slice(2)
  const benchArgs = args.filter((a) => a !== "--force")
  let exe = findExe()

  if (needsRebuild(exe, args)) {
    console.log("Building koth_bench...")
    buildBench()
    exe = findExe()
  } else {
    console.log("koth_bench is up to date (use --force to rebuild)")
  }

  if (!exe) {
    console.error("koth_bench executable not found under", BUILD_DIR)
    process.exit(1)
  }
  execFileSync(exe, benchArgs, { stdio: "inherit" })
}

main()
