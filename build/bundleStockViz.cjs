const path = require("node:path")
const fs = require("node:fs")
const { buildSync } = require("esbuild")

const ROOT = path.join(__dirname, "..")
const ENTRY = path.join(ROOT, "bench/stock/stockBenchCore.ts")
const TEMPLATE = path.join(ROOT, "bench/stock/stockTraderViz.template.html")
const OUT = path.join(ROOT, "bench/stock/stockTraderViz.html")

/**
 * Inline the benchmark core into one self-contained HTML page.
 * No server, no module imports, no workers: open the file directly.
 */
function bundleStockViz() {
  const built = buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    format: "iife",
    globalName: "StockBench",
    platform: "neutral",
    target: "es2022",
    write: false,
    sourcemap: false,
    logLevel: "silent",
    alias: { "@": path.join(ROOT, "src") },
  })
  const core = built.outputFiles[0].text
  const template = fs.readFileSync(TEMPLATE, "utf8")
  if (!template.includes("/*__BENCH_CORE__*/")) {
    throw new Error(`${TEMPLATE} is missing the /*__BENCH_CORE__*/ placeholder`)
  }
  const html =
    "<!-- Auto-generated from bench/stock/stockTraderViz.template.html; run pnpm run stock:viz -->\n" +
    template.replace("/*__BENCH_CORE__*/", () => core)
  fs.writeFileSync(OUT, html)
  return { out: OUT, bytes: html.length }
}

module.exports = { bundleStockViz, ENTRY, TEMPLATE, OUT }

if (require.main === module) {
  const { out, bytes } = bundleStockViz()
  console.log(`built ${out} (${Math.round(bytes / 1024)} KB, self-contained)`)
}
