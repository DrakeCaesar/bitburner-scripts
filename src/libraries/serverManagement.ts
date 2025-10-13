import { NS } from "@ns"
import { crawl } from "./crawl"
import { getEffectiveMaxRam } from "./ramUtils.js"

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
  const purchasedTotalRam = purchasedServers.reduce((sum, node) => sum + getEffectiveMaxRam(ns, node), 0)
  const nukedTotalRam = nukedServers.reduce((sum, node) => sum + getEffectiveMaxRam(ns, node), 0)
  const homeRemainingRam = getEffectiveMaxRam(ns, "home") - ns.getServerUsedRam("home")

  let nodes: string[] = []
  nodes = ["home", ...purchasedServers, ...nukedServers]

  return nodes
}

export function purchaseAdditionalServers(ns: NS): number {
  if (!ns.serverExists("node00")) return 0

  const maxRam = ns.getPurchasedServerMaxRam()
  const currentRam = getEffectiveMaxRam(ns, "node00")

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
    } else if (ns.serverExists(nodeName) && getEffectiveMaxRam(ns, nodeName) < maxRam && money >= cost) {
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
    const availableRam = getEffectiveMaxRam(ns, node) - ns.getServerUsedRam(node)
    // ns.tprint(`Node ${node} has ${availableRam.toFixed(2)} GB available RAM (requires ${requiredRam.toFixed(2)} GB)`)
    if (availableRam >= requiredRam) {
      return node
    }
  }
  return null
}

/**
 * Distributes batches across nodes using a greedy knapsack approach.
 * Fast O(n*m) algorithm that fits as many COMPLETE batches (sets of 4 operations) as possible.
 * If we can only fit partial batches, we exclude the incomplete set.
 *
 * This is a first-fit descending heuristic - fast but not guaranteed optimal.
 */
export function distributeBatchesAcrossNodes(
  ns: NS,
  nodes: string[],
  allOperations: Array<{ ram: number; scriptPath: string; args: any[]; threads: number; batchIndex: number }>
): {
  assignments: Array<{ node: string; operation: { ram: number; scriptPath: string; args: any[]; threads: number } }>
  completeBatches: number
} {
  const operationsPerBatch = 4

  // Get available RAM for each node
  const nodeCapacity = nodes.map((node) => ({
    name: node,
    available: getEffectiveMaxRam(ns, node) - ns.getServerUsedRam(node),
  }))

  // Sort nodes by available RAM (descending) for greedy allocation
  nodeCapacity.sort((a, b) => b.available - a.available)

  const assignments: Array<{
    node: string
    operation: { ram: number; scriptPath: string; args: any[]; threads: number }
  }> = []
  let operationsFitted = 0

  // Try to fit operations one by one
  for (const operation of allOperations) {
    let assigned = false
    for (const node of nodeCapacity) {
      if (node.available >= operation.ram) {
        assignments.push({ node: node.name, operation })
        node.available -= operation.ram
        assigned = true
        operationsFitted++
        break
      }
    }
    if (!assigned) {
      // Cannot fit this operation, stop here
      break
    }
  }

  // Calculate how many complete batches we fitted
  const completeBatches = Math.floor(operationsFitted / operationsPerBatch)
  const completeOperations = completeBatches * operationsPerBatch

  // Trim assignments to only include complete batches
  const finalAssignments = assignments.slice(0, completeOperations)

  return {
    assignments: finalAssignments,
    completeBatches,
  }
}
