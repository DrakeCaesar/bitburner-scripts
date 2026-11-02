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
// server.js exits with this code when it wants to be restarted (GUI button).
const RESTART_EXIT_CODE = 75

let child = null
let restarting = false
let timer = null
let stopping = false
let crashDelay = RESTART_DELAY_MS

function log(message) {
  console.log(`[dev-server] ${message}`)
}

function start() {
  child = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, IPVGO_SUPERVISED: "1", IPVGO_SUPERVISOR_PID: String(process.pid) },
  })
  log(`server started (pid ${child.pid})`)
  const startedAt = Date.now()
  child.on("exit", (code, signal) => {
    child = null
    if (stopping) return
    const alive = Date.now() - startedAt
    const planned = restarting || code === RESTART_EXIT_CODE
    if (planned) {
      restarting = false
      crashDelay = RESTART_DELAY_MS
      log("restarting server")
      // The old process may still hold the port for a moment; yielding avoids a
      // bind failure loop that would look like a hang in the browser.
      setTimeout(() => {
        if (!stopping && !child) start()
      }, 120)
      return
    }
    if (alive < 3000) {
      // Crashed right after starting (bad config, port in use): back off.
      crashDelay = Math.min(crashDelay * 2, 8000)
      log(`server died after ${alive}ms (code=${code ?? "null"}); retrying in ${crashDelay}ms`)
    } else {
      crashDelay = RESTART_DELAY_MS
      log(`server exited (code=${code ?? "null"} signal=${signal ?? "none"}); restarting in ${crashDelay}ms`)
    }
    setTimeout(() => {
      if (!stopping && !child) start()
    }, crashDelay)
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
