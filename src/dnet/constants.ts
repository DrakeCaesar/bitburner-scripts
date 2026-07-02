/** Constants for dnet (dedicated Netscript port range). */

export const DARKWEB = "darkweb"
export const WORKER_SCRIPT = "dnet/worker/main.js"
export const STASIS_SCRIPT = "dnet/stasis/stasisLink.js"
export const LABYRINTH_MODEL = "(The Labyrinth)"

/** Master broadcasts session config here; workers read each loop. */
export const CONTROL_PORT = 45209

/** Latest darknet mutation timestamp (single entry); written by mutationWatcher on home. */
export const MUTATION_PORT = 45208
export const MUTATION_WATCHER_SCRIPT = "dnet/mutationWatcher.js"

/** Worker-to-coordinator lore/journaling text (raw strings). */
export const LORE_PORT = 45207

/** Per-worker command ports start here (even); reply = command + 1. */
export const PORT_POOL_START = 45210
export const PORT_POOL_SIZE = 256

export const LOOP_INTERVAL_MS = 10
export const EXHAUSTED_RETRY_MS = 20_000
export const WORKER_TIMEOUT_MS = 120_000
/** Grace after a worker-reported deadline before the coordinator treats the command as failed. */
export const DEADLINE_GRACE_MS = 50
/** Initial window for the worker to post its first reply (deadline or final result) on auth. */
export const FIRST_REPLY_MS = 50
/** Fallback if probeResult/spawnResult never arrives (no worker deadline messages). */
export const INSTANT_CMD_FALLBACK_MS = 10_000
/** @deprecated use INSTANT_CMD_FALLBACK_MS */
export const PROBE_FALLBACK_MS = INSTANT_CMD_FALLBACK_MS
export const UNREACHABLE_RECHECK_MS = 5_000

/** Files copied to remote hosts when spawning workers (worker subtree only). */
export const WORKER_SCP_FILES = [
  "dnet/files/categorize.js",
  "dnet/files/archive.js",
  "dnet/files/intel.js",
  "dnet/files/types.js",
  "dnet/files/serverFiles.js",
  "dnet/files/sanitize.js",
  "dnet/worker/constants.js",
  "dnet/worker/dnetApi.js",
  "dnet/worker/protocol.js",
  "dnet/worker/taskTiming.js",
  "dnet/worker/execute.js",
  "dnet/worker/realloc.js",
  "dnet/worker/deploy.js",
  "dnet/worker/main.js",
]

export interface ControlMessage {
  sessionId: number
  lorePort: number
}
