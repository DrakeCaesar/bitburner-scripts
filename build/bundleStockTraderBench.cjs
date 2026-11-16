const path = require("node:path")
const fs = require("node:fs")
const { buildSync } = require("esbuild")

const ROOT = path.join(__dirname, "..")
const ENTRY = path.join(ROOT, "bench/stock/stockTraderBench.ts")
const OUT = path.join(ROOT, "bench/stock/stockTraderBench.mjs")

/** Bundle the stock benchmark with the in-game strategy code under src/libraries/stock. */
function bundleStockTraderBench() {
  buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: OUT,
    target: "es2022",
    sourcemap: false,
    logLevel: "silent",
    alias: { "@": path.join(ROOT, "src") },
  })
  const existing = fs.readFileSync(OUT, "utf8")
  fs.writeFileSync(
    OUT,
    "/* Auto-generated: edit bench/stock/stockTraderBench.ts; run pnpm run test:stock */\n" + existing,
  )
  return OUT
}

module.exports = { bundleStockTraderBench, ENTRY, OUT }

if (require.main === module) {
  bundleStockTraderBench()
  console.log(`bundled stock trader benchmark -> ${OUT}`)
}
