import { NS } from "@ns"
import { crawl } from "../crawl.js"

export function getAllNodes(ns: NS): string[] {
  const nodes: string[] = []
  for (let i = 0; i < 25; i++) {
    const nodeName = "node" + String(i).padStart(2, "0")
    if (ns.serverExists(nodeName)) {
      nodes.push(nodeName)
    }
  }
  return nodes
}

/**
 * Get nodes for batching with fallback logic:
 * 1. Try purchased servers (node00-node24) or home if it has more RAM
 * 2. If no purchased servers, use all nuked servers with >=16GB RAM
 * 3. If no suitable servers found, return empty array
 */
export function getNodesForBatching(ns: NS): string[] {
  // First try purchased servers
  let nodes = getAllNodes(ns)

  // if (nodes.length === 0) {
  //   ns.tprint("No purchased servers found, using home...")
  //   return ["home"]
  // }

  // Check if home has more RAM than purchased servers
  const homeRam = ns.getServerMaxRam("home")
  const totalPurchasedRam = nodes.reduce((sum, node) => sum + ns.getServerMaxRam(node), 0)

  // if (homeRam > totalPurchasedRam) {
  //   ns.tprint(
  //     `Home has more RAM (${ns.formatRam(homeRam)}) than purchased servers (${ns.formatRam(totalPurchasedRam)}), using home...`
  //   )
  //   return ["home"]
  // }

  // If only home or no purchased servers, use all nuked servers with enough RAM
  if (nodes.length === 0 || (nodes.length === 1 && nodes[0] === "home")) {
    const knownServers = new Set<string>()
    crawl(ns, knownServers)

    nodes = []
    for (const serverName of knownServers) {
      const server = ns.getServer(serverName)
      if (server.hasAdminRights && server.maxRam >= 16 && serverName !== "home") {
        nodes.push(serverName)
      }
    }
  }

  return nodes
}

export function purchaseAdditionalServers(ns: NS): number {
  if (!ns.serverExists("node00")) return 0

  const maxRam = ns.getPurchasedServerMaxRam()
  const currentRam = ns.getServerMaxRam("node00")

  if (currentRam < maxRam) return 0

  const cost = ns.getPurchasedServerCost(maxRam)
  let money = ns.getPlayer().money
  let purchaseCount = 0

  // Buy or upgrade as many maxed servers as we can afford
  for (let i = 1; i < 25; i++) {
    const nodeName = "node" + String(i).padStart(2, "0")

    if (!ns.serverExists(nodeName) && money >= cost) {
      ns.purchaseServer(nodeName, maxRam)
      ns.tprint(`Bought new maxed server: ${nodeName} (${maxRam} GB)`)
      money -= cost
      purchaseCount++
    } else if (ns.serverExists(nodeName) && ns.getServerMaxRam(nodeName) < maxRam && money >= cost) {
      ns.killall(nodeName)
      ns.deleteServer(nodeName)
      ns.purchaseServer(nodeName, maxRam)
      ns.tprint(`Upgraded ${nodeName} to max RAM (${maxRam} GB)`)
      money -= cost
      purchaseCount++
    }
  }

  return purchaseCount
}

export function findNodeWithRam(ns: NS, nodes: string[], requiredRam: number): string | null {
  for (const node of nodes) {
    const availableRam = ns.getServerMaxRam(node) - ns.getServerUsedRam(node)
    // ns.tprint(`Node ${node} has ${availableRam.toFixed(2)} GB available RAM (requires ${requiredRam.toFixed(2)} GB)`)
    if (availableRam >= requiredRam) {
      return node
    }
  }
  return null
}
