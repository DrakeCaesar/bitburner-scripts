/**
 * Run MCGS self-play vs every faction in C++ (no server, no game).
 * Exits non-zero unless every faction hits 100% wins.
 *
 *   node scripts/bench-factions.js [size] [games] [playouts] [seed]
 *   pnpm run game:bench -- 5 200 10000
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
  const candidates = [
    path.join(root, "build", "Release", exe),
    path.join(root, "build", exe),
    path.join(root, "build-game", "Release", exe),
    path.join(root, "build-game", exe),
  ]
  return candidates.find((p) => fs.existsSync(p))
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
  console.error("ipvgo_game not built. Run: pnpm run game:build")
  process.exit(1)
}

const factions = size === 19 ? ["WorldDaemon"] : FACTIONS_5_13
let failed = 0

console.log(`bench: size=${size} games=${games} playouts=${playouts} seed=${seed}`)
for (const faction of factions) {
  console.log(`\n--- ${faction} ---`)
  const result = spawnSync(exe, ["mcgsplay", faction, String(size), String(games), String(playouts), seed], {
    stdio: "inherit",
    cwd: root,
  })
  if ((result.status ?? 1) !== 0) failed++
}

console.log(failed === 0 ? "\nbench: PASS (100% all factions)" : `\nbench: FAIL (${failed} faction(s) below 100%)`)
process.exit(failed === 0 ? 0 : 1)
