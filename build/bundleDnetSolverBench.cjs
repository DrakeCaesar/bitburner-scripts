const path = require("node:path")
const { buildSync } = require("esbuild")

const ROOT = path.join(__dirname, "..")
const ENTRY = path.join(ROOT, "bench/dnet/dnetSolverBenchCore.ts")
const OUT = path.join(ROOT, "bench/dnet/dnetSolverBenchCore.mjs")

/** Bundle the darknet solver bench core (game model + shipped solvers) for the Node CLI. */
function bundleDnetSolverBench() {
  buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile: OUT,
    target: "es2022",
    sourcemap: false,
    logLevel: "warning",
    banner: { js: "/* Auto-generated - edit bench/dnet/dnetSolverBenchCore.ts; run pnpm run test:dnet-solvers */" },
  })
  return OUT
}

module.exports = { bundleDnetSolverBench, ENTRY, OUT }

if (require.main === module) {
  bundleDnetSolverBench()
  console.log(`bundled darknet solver bench -> ${OUT}`)
}
