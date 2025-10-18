import { NS } from "@ns"

/**
 * Gets the effective max RAM for a server, with special handling for "home".
 * For the "home" server, reserves 10% or 100 GB (whichever is larger) to ensure
 * headroom for running scripts while batching operations are ongoing.
 *
 * @param ns - Netscript instance
 * @param server - Server name to get max RAM for
 * @returns Effective maximum RAM available for the server
 */
export function getEffectiveMaxRam(ns: NS, server: string): number {
  const maxRam = ns.getServerMaxRam(server)
  const usedRam = ns.getServerUsedRam(server)
  if (server === "home") {
    const tenPercent = maxRam * 0.1
    const reservation = Math.max(tenPercent, Math.min(maxRam, 100))

    return Math.max(0, maxRam - reservation)
  }

  return maxRam
}
