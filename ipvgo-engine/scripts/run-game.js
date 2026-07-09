/**
 * Locate and run the built native `ipvgo_game` executable.
 * Searches the common CMake output directories.
 *
 *   node scripts/run-game.js selftest
 *   node scripts/run-game.js parity temp/parity_cases.json
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
  ]
  return candidates.find((p) => fs.existsSync(p))
}

const [, , command, ...rest] = process.argv
if (!command) {
  console.error("usage: run-game.js <selftest|parity|aimove|gen|mcgsplay> ...")
  process.exit(2)
}

const exe = findExe("ipvgo_game")
if (!exe) {
  console.error("Could not find ipvgo_game. Build it first (pnpm run game:build).")
  process.exit(1)
}

const result = spawnSync(exe, [command, ...rest], { stdio: "inherit", cwd: root })
process.exit(result.status ?? 1)
