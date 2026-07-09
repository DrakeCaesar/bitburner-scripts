/**
 * Locate and run the built native `ipvgo_game` (or `ipvgo_train`) executable.
 * Searches the common CMake output directories.
 *
 *   node scripts/run-game.js selftest
 *   node scripts/run-game.js parity temp/parity_cases.json
 *   node scripts/run-game.js train ...        (requires trainer build)
 */

import { spawnSync } from "child_process"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")
const isWindows = process.platform === "win32"

function findExe(name) {
  const exe = isWindows ? `${name}.exe` : name
  const candidates = [
    path.join(root, "build", "Release", exe),
    path.join(root, "build", exe),
    path.join(root, "build-game", "Release", exe),
    path.join(root, "build-game", exe),
    path.join(root, "build-trainer", "Release", exe),
    path.join(root, "build-trainer", exe),
  ]
  return candidates.find((p) => fs.existsSync(p))
}

const [, , command, ...rest] = process.argv
if (!command) {
  console.error("usage: run-game.js <selftest|parity|aimove|gen|train> ...")
  process.exit(2)
}

const exeName = command === "train" ? "ipvgo_train" : "ipvgo_game"
const exe = findExe(exeName)
if (!exe) {
  console.error(`Could not find ${exeName}. Build it first (pnpm run game:build).`)
  process.exit(1)
}

const args = command === "train" ? rest : [command, ...rest]
const result = spawnSync(exe, args, { stdio: "inherit", cwd: root })
process.exit(result.status ?? 1)
