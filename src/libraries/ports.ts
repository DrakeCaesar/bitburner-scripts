/**
 * Single source of truth for all port numbers used across the repo.
 *
 * Ports are assigned in blocks to prevent accidental collisions:
 *   Batch hacking      — 21
 *   Darknet crawl      — 45107–45109
 */

// ---- batch hacking ----

/** Child hack.js writes ns.hack() return value here (exec cannot return to parent). */
export const BATCH_HACK_INCOME_PORT = 21

/** Bitburner port queue capacity; one hack completion = one write. */
export const HACK_INCOME_PORT_CAPACITY = 50

// ---- darknet crawl ----

/** Worker-to-controller crawl progress/status IPC (structured JSON). */
export const CRAWL_REPORT_PORT = 45107

/** Worker-to-controller text content IPC (raw strings). */
export const DARKNET_TEXT_PORT = 45108
