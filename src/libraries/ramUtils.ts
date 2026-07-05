import { NS } from "@ns"
import { DEFAULT_BATCH_OPTIONS } from "./batchOptions.js"

/**
 * Gets the effective max RAM for a server, with special handling for "home".
 * Subtracts homeReserveGb from home only (other hosts use full max RAM).
 */
export function getEffectiveMaxRam(
  ns: NS,
  server: string,
  homeReserveGb: number = DEFAULT_BATCH_OPTIONS.homeReserveGb
): number {
  const maxRam = ns.getServerMaxRam(server)
  if (server === "home") {
    return Math.max(0, maxRam - Math.min(maxRam, homeReserveGb))
  }
  return maxRam
}

/**
 * RAM currently free for launching scripts on a server.
 * Clamps to zero — home may already exceed its batch budget when batch.js and other scripts are running.
 */
export function getAvailableRam(
  ns: NS,
  server: string,
  homeReserveGb: number = DEFAULT_BATCH_OPTIONS.homeReserveGb
): number {
  return Math.max(0, getEffectiveMaxRam(ns, server, homeReserveGb) - ns.getServerUsedRam(server))
}

/** Sum free RAM across batch worker hosts (uses getAvailableRam on each). */
export function sumBatchWorkerRam(
  ns: NS,
  nodes: string[],
  homeReserveGb: number = DEFAULT_BATCH_OPTIONS.homeReserveGb
): number {
  return nodes.reduce((sum, node) => sum + getAvailableRam(ns, node, homeReserveGb), 0)
}
