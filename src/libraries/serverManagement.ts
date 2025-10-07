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
 * - If purchased servers (node00+) have more total RAM than nuked servers, only use purchased servers
 * - Otherwise use all nuked servers
 * - Falls back to home if no purchased servers exist
 */
export function getNodesForBatching(ns: NS): string[] {
  // Get all purchased servers
  const purchasedServers = getAllNodes(ns)

  // Get all nuked servers with RAM
  const knownServers = new Set<string>()
  crawl(ns, knownServers)

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

  // Calculate total RAM for each group
  const purchasedTotalRam = purchasedServers.reduce((sum, node) => sum + ns.getServerMaxRam(node), 0)
  const nukedTotalRam = nukedServers.reduce((sum, node) => sum + ns.getServerMaxRam(node), 0)
  const homeRemainingRam = ns.getServerMaxRam("home") - ns.getServerUsedRam("home")

  let nodes: string[] = []

  // If we have purchased servers and they have more total RAM than nuked servers, use only purchased servers
  if (purchasedServers.length > 0 && purchasedTotalRam >= nukedTotalRam) {
    nodes = [...purchasedServers]
    // add home if it has over 100 GB free RAM
    if (homeRemainingRam >= 128) {
      nodes.push("home")
    }
    ns.tprint(
      `Using ${purchasedServers.length} purchased server(s) (${ns.formatRam(purchasedTotalRam)} total) ` +
        `over ${nukedServers.length} nuked server(s) (${ns.formatRam(nukedTotalRam)} total)`
    )
  } else if (nukedServers.length > 0 && nukedTotalRam > homeRemainingRam) {
    // Use nuked servers if they have more RAM or no purchased servers exist
    nodes = [...nukedServers]
    ns.tprint(
      `Using ${nukedServers.length} nuked server(s) (${ns.formatRam(nukedTotalRam)} total)` +
        (purchasedServers.length > 0
          ? ` over ${purchasedServers.length} purchased server(s) (${ns.formatRam(purchasedTotalRam)} total)`
          : "")
    )
  } else if (purchasedServers.length > 0 && purchasedTotalRam > homeRemainingRam) {
    // Fallback to purchased servers if no nuked servers
    nodes = [...purchasedServers]
    ns.tprint(`Using ${purchasedServers.length} purchased server(s) (${ns.formatRam(purchasedTotalRam)} total)`)
  } else {
    // Last resort: use home
    nodes = ["home"]
    ns.tprint("No purchased or nuked servers found, using home")
  }
  ns.tprint(`Using ${nodes.length} nodes for batching: ${nodes.join(", ")}`)

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
