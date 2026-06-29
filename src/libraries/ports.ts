/**
 * Single source of truth for all port numbers used across the repo.
 *
 * Ports are assigned in blocks to prevent accidental collisions:
 *   Batch hacking      — 21
 *   Darknet crawl      — 45108–46121
 */

// ---- batch hacking ----

/** Child hack.js writes ns.hack() return value here (exec cannot return to parent). */
export const BATCH_HACK_INCOME_PORT = 21

/** Bitburner port queue capacity; one hack completion = one write. */
export const HACK_INCOME_PORT_CAPACITY = 50

// ---- darknet crawl ----

/** Worker-to-controller text content IPC — lore/journaling files (raw strings). */
export const DARKNET_LORE_PORT = 45108

/** Master-to-worker broadcast — runtime config and commands (single-message, workers peek). */
export const DARKNET_CONTROL_PORT = 45109
