const path = require("node:path")
const fs = require("node:fs")
const { buildSync } = require("esbuild")

const ROOT = path.join(__dirname, "..")
const ENTRY = path.join(ROOT, "tests/kingOfTheHillCore.ts")
const OUT = path.join(ROOT, "tests/kingOfTheHillCore.mjs")

/** Bundle test harness + in-game KingOfTheHill solver for browser viz (static serve). */
function bundleKingOfTheHillCore() {
  buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile: OUT,
    target: "es2020",
    sourcemap: false,
    logLevel: "silent",
  })
  const existing = fs.readFileSync(OUT, "utf8")
  fs.writeFileSync(
    OUT,
    "/* Auto-generated — edit tests/kingOfTheHillCore.ts; run pnpm run test:koth:bundle */\n" + existing,
  )
  return OUT
}

module.exports = { bundleKingOfTheHillCore, ENTRY, OUT }

if (require.main === module) {
  bundleKingOfTheHillCore()
  console.log(`bundled KingOfTheHill test core -> ${OUT}`)
}
