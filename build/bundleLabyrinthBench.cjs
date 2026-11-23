const path = require("node:path")
const { buildSync } = require("esbuild")

const ROOT = path.join(__dirname, "..")
const ENTRY = path.join(ROOT, "bench/dnet/labyrinthBenchCore.ts")
const OUT = path.join(ROOT, "bench/dnet/labyrinthBenchCore.mjs")

/** Bundle the labyrinth bench core (game maze + shipped solver) for the Node CLI. */
function bundleLabyrinthBench() {
  buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile: OUT,
    target: "es2022",
    sourcemap: false,
    logLevel: "warning",
    banner: { js: "/* Auto-generated - edit bench/dnet/labyrinthBenchCore.ts; run pnpm run test:labyrinth */" },
  })
  return OUT
}

module.exports = { bundleLabyrinthBench, ENTRY, OUT }

if (require.main === module) {
  bundleLabyrinthBench()
  console.log(`bundled labyrinth bench -> ${OUT}`)
}
