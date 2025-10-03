import { NS } from "@ns"

export async function main(ns: NS): Promise<void> {
  const scriptPath = "/shareRam.js"

  // Get all purchased servers (nodes)
  function getAllNodes(): string[] {
    const nodes: string[] = []
    for (let i = 0; i < 25; i++) {
      const nodeName = "node" + String(i).padStart(2, "0")
      if (ns.serverExists(nodeName)) {
        nodes.push(nodeName)
      }
    }
    return nodes
  }

  while (true) {
    const nodes = getAllNodes()
    const allServers = ["home", ...nodes]

    // Copy script to all servers and start sharing
    for (const server of allServers) {
      // Skip if we can't write to this server
      if (!ns.hasRootAccess(server)) continue

      // Copy the script if needed
      if (!ns.fileExists(scriptPath, server)) {
        await ns.scp(scriptPath, server)
      }

      // Kill existing shareRam instances on this server
      ns.scriptKill(scriptPath, server)

      const scriptRam = ns.getScriptRam(scriptPath)
      const availableRam = ns.getServerMaxRam(server) - ns.getServerUsedRam(server)
      const threads = Math.floor(availableRam / scriptRam)

      if (threads > 0) {
        ns.exec(scriptPath, server, threads)
        ns.tprint(`Started ${threads} share threads on ${server} (${ns.formatRam(threads * scriptRam)})`)
      }
    }

    // Wait and check if we can add more threads on any server
    await ns.sleep(10000)

    let needsRestart = false
    for (const server of allServers) {
      if (!ns.hasRootAccess(server)) continue

      const scriptRam = ns.getScriptRam(scriptPath)
      const currentAvailableRam = ns.getServerMaxRam(server) - ns.getServerUsedRam(server)
      const additionalThreads = Math.floor(currentAvailableRam / scriptRam)

      if (additionalThreads > 0) {
        needsRestart = true
        break
      }
    }

    if (needsRestart) {
      continue // Restart with new thread counts
    }
  }
}
