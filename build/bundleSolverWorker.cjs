const path = require("node:path")
const fs = require("node:fs")
const { buildSync } = require("esbuild")

const ROOT = path.join(__dirname, "..")
const ENTRY = path.join(ROOT, "src/dnet/solvers/solverWorker.entry.ts")
const OUT = path.join(ROOT, "src/dnet/solvers/solverWorker.js")

/** Bundle solver worker entry + all solvers into a single IIFE (no imports). */
function bundleSolverWorker() {
  const result = buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    target: "es2020",
    sourcemap: false,
    logLevel: "silent",
  })
  const code =
    "/* Auto-generated — edit src/dnet/solvers/solverWorker.entry.ts */\n" +
    result.outputFiles[0].text +
    "\n"
  fs.writeFileSync(OUT, code)
  return code
}

module.exports = { bundleSolverWorker, ENTRY, OUT }

if (require.main === module) {
  bundleSolverWorker()
  console.log(`bundled solver worker -> ${OUT}`)
}
