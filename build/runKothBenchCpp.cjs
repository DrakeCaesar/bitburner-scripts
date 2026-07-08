const path = require("node:path")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")

const ROOT = path.join(__dirname, "..")
const BUILD_DIR = path.join(ROOT, "tests/koth_tune/build")
const PRESET = "koth-tune-release"

function findExe() {
  const candidates = [
    path.join(BUILD_DIR, "Release", "koth_bench.exe"),
    path.join(BUILD_DIR, "Release", "koth_bench"),
    path.join(BUILD_DIR, "koth_bench.exe"),
    path.join(BUILD_DIR, "koth_bench"),
  ]
  for (const exe of candidates) {
    if (fs.existsSync(exe)) return exe
  }
  return null
}

function main() {
  execFileSync("cmake", ["--preset", PRESET, "-S", path.join(ROOT, "tests/koth_tune")], {
    stdio: "inherit",
    cwd: ROOT,
  })
  execFileSync("cmake", ["--build", BUILD_DIR, "--config", "Release"], {
    stdio: "inherit",
    cwd: ROOT,
  })
  const exe = findExe()
  if (!exe) {
    console.error("koth_bench executable not found under", BUILD_DIR)
    process.exit(1)
  }
  execFileSync(exe, process.argv.slice(2), { stdio: "inherit" })
}

main()
