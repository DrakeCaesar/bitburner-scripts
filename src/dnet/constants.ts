/** Constants for dnet v2 (separate port range from legacy darknet crawl). */

export const DARKWEB = "darkweb"
export const WORKER_SCRIPT = "dnet/worker.js"
export const LABYRINTH_MODEL = "(The Labyrinth)"

/** Master broadcasts session config here; workers read each loop. */
export const CONTROL_PORT = 45209

/** Per-worker command ports start here (even); reply = command + 1. */
export const PORT_POOL_START = 45210
export const PORT_POOL_SIZE = 256

export const LOOP_INTERVAL_MS = 250
export const EXHAUSTED_RETRY_MS = 20_000
export const WORKER_TIMEOUT_MS = 120_000
export const UNREACHABLE_RECHECK_MS = 5_000

/** Files copied to remote hosts when spawning workers. */
export const WORKER_SCP_FILES = [
  "dnet/constants.js",
  "dnet/types.js",
  "dnet/api/server.js",
  "dnet/worker/protocol.js",
  "dnet/worker/execute.js",
  "dnet/worker/main.js",
  "dnet/worker.js",
]

export interface ControlMessage {
  sessionId: number
}
