/** Constants for dnet v2 (separate port range from legacy darknet crawl). */

export const DARKWEB = "darkweb"
export const WORKER_SCRIPT = "dnet/worker/main.js"
export const STASIS_SCRIPT = "dnet/stasis/stasisLink.js"
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

/** Files copied to remote hosts when spawning workers (worker subtree only). */
export const WORKER_SCP_FILES = [
  "dnet/worker/constants.js",
  "dnet/worker/dnetApi.js",
  "dnet/worker/protocol.js",
  "dnet/worker/execute.js",
  "dnet/worker/realloc.js",
  "dnet/worker/deploy.js",
  "dnet/worker/main.js",
]

export interface ControlMessage {
  sessionId: number
}
