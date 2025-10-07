import { NS } from "@ns"
import { crawl } from "../crawl.js"

export function getAllNodes(ns: NS): string[] {
  const nodes: string[] = []
  // return nodes //debug
  for (let i = 0; i < 25; i++) {
    const nodeName = "node" + String(i).padStart(2, "0")
    if (ns.serverExists(nodeName)) {
      nodes.push(nodeName)
    }
  }
  return nodes
}

/**
 * Get all available nodes for batching:
 * - Always includes home
 * - Includes all purchased servers (node00-node24)
 * - Includes all nuked servers with RAM
 */
export function getNodesForBatching(ns: NS): string[] {
  const nodes: string[] = []

  // Add all purchased servers
  const purchasedServers = getAllNodes(ns)
  if (purchasedServers.length == 0) {
    nodes.push("home")
  }

  nodes.push(...purchasedServers)

  // Add all nuked servers with RAM
  const knownServers = new Set<string>()
  crawl(ns, knownServers)

  for (const serverName of knownServers) {
    const server = ns.getServer(serverName)
    // Skip home (already added) and purchased servers (already added)
    if (serverName === "home" || purchasedServers.includes(serverName)) {
      continue
    }
    // Add servers that are nuked and have RAM
    if (server.hasAdminRights && server.maxRam > 0) {
      nodes.push(serverName)
    }
  }

  ns.tprint(`Nodes for batching: ${nodes.join(", ")}`)
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
