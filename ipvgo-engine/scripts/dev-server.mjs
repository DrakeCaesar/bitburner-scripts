// Development supervisor for the IPvGO engine server.
//
//   pnpm run server:dev
//
// Runs server.js and restarts it whenever the server or the bench page changes,
// so edits show up without touching a terminal. The server advertises
// IPVGO_SUPERVISED=1, which enables POST /api/server/restart (the GUI's
// "Restart server" button) and lets the page reload itself when the server
// instance changes.
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, "..")
const ENTRY = path.join(ROOT, "server.js")

const WATCH = [ENTRY, path.join(ROOT, "web"), path.join(ROOT, "scripts")]
const DEBOUNCE_MS = 200
const RESTART_DELAY_MS = 400

let child = null
let restarting = false
let timer = null
let stopping = false

function log(message) {
  console.log(`[dev-server] ${message}`)
}

function start() {
  child = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, IPVGO_SUPERVISED: "1" },
  })
  log(`server started (pid ${child.pid})`)
  child.on("exit", (code, signal) => {
    child = null
    if (stopping) return
    if (restarting) {
      restarting = false
      start()
      return
    }
    log(`server exited (code=${code ?? "null"} signal=${signal ?? "none"}); restarting in ${RESTART_DELAY_MS}ms`)
    setTimeout(() => {
      if (!stopping && !child) start()
    }, RESTART_DELAY_MS)
  })
}

function restart(reason) {
  if (!child) return
  log(`restarting: ${reason}`)
  restarting = true
  child.kill()
}

function scheduleRestart(reason) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    restart(reason)
  }, DEBOUNCE_MS)
}

function watchPath(target) {
  if (!fs.existsSync(target)) return
  try {
    fs.watch(target, { recursive: true }, (_event, filename) => {
      if (!filename) return scheduleRestart(`${path.relative(ROOT, target)} changed`)
      scheduleRestart(`${filename} changed`)
    })
    log(`watching ${path.relative(ROOT, target)}`)
  } catch (err) {
    log(`cannot watch ${target}: ${err.message}`)
  }
}

for (const target of WATCH) watchPath(target)

// Manual restart requests arrive as SIGHUP, which is handy for editor tasks.
process.on("SIGHUP", () => restart("SIGHUP"))

function shutdown() {
  stopping = true
  if (timer) clearTimeout(timer)
  if (child) child.kill()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

start()
