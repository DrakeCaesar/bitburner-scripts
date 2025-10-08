import { NS } from "@ns"
import { crawl } from "./libraries/crawl"

export async function main(ns: NS): Promise<void> {
  const scriptPath = "libraries/shareRam.js"
  const useNukedServers = ns.args[0] === "nuked"
  const useAllServers = ns.args[0] === "all"

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

  // Get all nuked servers
  function getNukedServers(): string[] {
    const knownServers = new Set<string>()
    crawl(ns, knownServers)

    const purchasedServers = getAllNodes()
    const nukedServers: string[] = []

    for (const serverName of knownServers) {
      const server = ns.getServer(serverName)
      // Skip home and purchased servers
      if (serverName === "home" || purchasedServers.includes(serverName)) {
        continue
      }
      // Add servers that are nuked and have RAM
      if (server.hasAdminRights && server.maxRam > 0) {
        nukedServers.push(serverName)
      }
    }

    return nukedServers
  }

  while (true) {
    let allServers: string[]

    if (useNukedServers) {
      const nukedServers = getNukedServers()
      allServers = nukedServers
      // ns.tprint(`Running on ${nukedServers.length} nuked servers only`)
    } else if (useAllServers) {
      const nodes = getAllNodes()
      const nukedServers = getNukedServers()
      allServers = ["home", ...nodes, ...nukedServers]
      // ns.tprint(`Running on all servers: ${allServers.length} total`)
    } else {
      const nodes = getAllNodes()
      allServers = ["home", ...nodes]
    }

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
        // ns.tprint(`Started ${threads} share threads on ${server} (${ns.formatRam(threads * scriptRam)})`)
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
