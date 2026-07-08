const path = require("node:path")
const fs = require("node:fs")
const { buildSync } = require("esbuild")

const ROOT = path.join(__dirname, "..")
const ENTRY = path.join(ROOT, "tests/kingOfTheHillBench.ts")
const OUT = path.join(ROOT, "tests/kingOfTheHillBench.mjs")

function bundleKingOfTheHillBench() {
  buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: OUT,
    target: "es2020",
    sourcemap: false,
    logLevel: "silent",
    external: ["node:os", "node:path", "node:url", "node:worker_threads"],
  })
  const existing = fs.readFileSync(OUT, "utf8")
  fs.writeFileSync(
    OUT,
    "/* Auto-generated — edit tests/kingOfTheHillBench.ts; run pnpm run test:koth:bench */\n" + existing,
  )
  return OUT
}

module.exports = { bundleKingOfTheHillBench, ENTRY, OUT }

if (require.main === module) {
  bundleKingOfTheHillBench()
  console.log(`bundled KingOfTheHill bench -> ${OUT}`)
}
