/**
 * Run Black vs every faction in C++ (no server, no game).
 * Exits non-zero unless every faction hits 100% wins.
 *
 *   node scripts/bench-factions.js [size] [games] [budget] [seed] [engine]
 *   pnpm run ipvgo:bench -- 5 200 10000
 *   pnpm run ipvgo:bench -- 5 20 3 1 exploit
 *
 * engine: "mcgs" (default, budget = playouts) or "exploit" (budget = search depth).
 */

import { spawnSync } from "child_process"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")
const isWindows = process.platform === "win32"

const FACTIONS_5_13 = [
  "Netburners",
  "Slum Snakes",
  "The Black Hand",
  "Tetrads",
  "Daedalus",
  "Illuminati",
]

function findExe() {
  const exe = isWindows ? "ipvgo_game.exe" : "ipvgo_game"
  const buildDirs = [
    path.join(root, "..", "cmake-build", "bin", "Release"),
    path.join(root, "..", "cmake-build", "bin"),
    path.join(root, "..", "cmake-build", "Release"),
    path.join(root, "..", "cmake-build"),
    path.join(root, "build", "Release"),
    path.join(root, "build"),
    path.join(root, "build-game", "Release"),
    path.join(root, "build-game"),
  ]
  return buildDirs.map((dir) => path.join(dir, exe)).find((p) => fs.existsSync(p))
}

const size = Number(process.argv[2] ?? 5)
const games = Number(process.argv[3] ?? 100)
const playouts = Number(process.argv[4] ?? 10000)
const seed = process.argv[5] ?? "1"

if (![5, 7, 9, 13, 19].includes(size)) {
  console.error("size must be 5, 7, 9, 13, or 19")
  process.exit(2)
}

const exe = findExe()
if (!exe) {
  console.error("ipvgo_game not built. Run: pnpm run ipvgo:build")
  process.exit(1)
}

const engine = process.env.IPVGO_ENGINE?.trim() === "exploit" || process.argv[6] === "exploit" ? "exploit" : "mcgs"
const command = engine === "exploit" ? "exploitplay" : "mcgsplay"
const budgetLabel = engine === "exploit" ? "depth" : "playouts"

const factions = size === 19 ? ["WorldDaemon"] : FACTIONS_5_13
let failed = 0

console.log(`bench: engine=${engine} size=${size} games=${games} ${budgetLabel}=${playouts} seed=${seed}`)
for (const faction of factions) {
  console.log(`\n--- ${faction} ---`)
  const result = spawnSync(exe, [command, faction, String(size), String(games), String(playouts), seed], {
    stdio: "inherit",
    cwd: root,
  })
  if ((result.status ?? 1) !== 0) failed++
}

console.log(failed === 0 ? "\nbench: PASS (100% all factions)" : `\nbench: FAIL (${failed} faction(s) below 100%)`)
process.exit(failed === 0 ? 0 : 1)
