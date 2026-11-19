/**
 * Single source of truth for all port numbers used across the repo.
 *
 * Ports are assigned in blocks to prevent accidental collisions:
 *   Batch hacking      — 21
 *   Stock trading      — 31
 *   Darknet crawl      — 45108–46121
 */

// ---- batch hacking ----

/** Child hack.js writes ns.hack() return value here (exec cannot return to parent). */
export const BATCH_HACK_INCOME_PORT = 21

/** Bitburner port queue capacity; one hack completion = one write. */
export const HACK_INCOME_PORT_CAPACITY = 50

// ---- stock trading ----

/**
 * Trader-to-worker broadcast: which company servers to influence and in which direction
 * (single JSON message, hack/grow workers peek). See libraries/stock/influence.ts.
 */
export const STOCK_INFLUENCE_PORT = 31

// ---- darknet crawl ----

/** Worker-to-controller text content IPC — lore/journaling files (raw strings). */
export const DARKNET_LORE_PORT = 45108

/** Master-to-worker broadcast — runtime config and commands (single-message, workers peek). */
export const DARKNET_CONTROL_PORT = 45109
