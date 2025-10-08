import { NS } from "@ns"
import { prepareServer } from "./batchCalculations.js"

/**
 * Standalone script to prepare a server (weaken to min security, grow to max money)
 * Usage: run prepareServer.js [serverName]
 * This script is meant to be executed on a node, and it will use that node as the host for prep operations
 */
export async function main(ns: NS) {
  const serverName = ns.args[0] as string

  if (!serverName) {
    ns.tprint("ERROR: Please provide a server name")
    return
  }

  // Use the current host (where this script is running) as the prep host
  const currentHost = ns.getHostname()
  await prepareServer(ns, currentHost, serverName)
}
