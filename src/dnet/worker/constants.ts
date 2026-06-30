/** Worker-only constants (do not import from dnet/constants.js — shared chunks pull in the master graph). */

export const CONTROL_PORT = 45209
export const WORKER_SCRIPT = "dnet/worker/main.js"
export const STASIS_SCRIPT = "dnet/stasis/stasisLink.js"

/** Files copied to remote hosts when spawning workers. Worker subtree only. */
export const WORKER_SCP_FILES = [
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
}
