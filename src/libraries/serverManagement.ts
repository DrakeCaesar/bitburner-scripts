import { NS } from "@ns"
import { crawl } from "./crawl.js"
import { getEffectiveMaxRam } from "./ramUtils.js"

/** How batch/analyzeTargets choose worker hosts (args: home, nuked, purchased, no-hacknet, or a hack level number). */
export type BatchWorkerMode = "auto" | "home" | "nuked" | "purchased"

export interface BatchRunOptions {
  playerHackLevel?: number
  /** Second numeric arg (e.g. analyzeTargets batch cycle count). */
  batchCycles?: number
  workers: BatchWorkerMode
  excludeHacknet: boolean
  /** Use *Debug hacking scripts and verbose prep/timing logs. */
  debug: boolean
  /** Skip hack-income port I/O for lower overhead (no per-hack $ collection). */
  disablePorts: boolean
}

/**
 * Parse batch script args in any order: numbers + keywords.
 * Examples: `home`, `home 200`, `200 home`, `nuked 150`, `purchased no-hacknet`, `debug`, `home debug`
 * By default ports are disabled for speed. Pass `ports` to enable per-hack income tracking.
 */
export function parseBatchArgs(args: (string | number | boolean)[]): BatchRunOptions {
  const numbers: number[] = []
  let workers: BatchWorkerMode = "auto"
  let excludeHacknet = false
  let debug = false
  let disablePorts = true

  for (const raw of args) {
    const token = String(raw).trim().toLowerCase()
    if (token === "") continue

    const asNum = Number(token)
    if (Number.isFinite(asNum)) {
      numbers.push(asNum)
      continue
    }

    if (token === "home") workers = "home"
    else if (token === "nuked") workers = "nuked"
    else if (token === "purchased" || token === "nodes") workers = "purchased"
    else if (token === "no-hacknet" || token === "nohacknet") excludeHacknet = true
    else if (token === "debug") debug = true
    else if (token === "no-ports" || token === "noports") disablePorts = true
    else if (token === "ports") disablePorts = false
  }

  return {
    playerHackLevel: numbers[0],
    batchCycles: numbers[1],
    workers,
    excludeHacknet,
    debug,
    disablePorts,
  }
}

export function getPurchasedNodes(ns: NS, excludeHacknet = false): string[] {
  const nodes: string[] = []
  for (let i = 0; i < 25; i++) {
    const nodeName = "node" + String(i).padStart(2, "0")
    if (ns.serverExists(nodeName)) {
      nodes.push(nodeName)
    }
  }
  if (!excludeHacknet) {
    for (let i = 0; i < 25; i++) {
      const nodeName = "hacknet-server-" + String(i)
      if (ns.serverExists(nodeName)) {
        nodes.push(nodeName)
      }
    }
  }
  return nodes
}

export function getAllNodes(ns: NS): string[] {
  return getPurchasedNodes(ns, false)
}

function getNukedServersForBatching(ns: NS, purchasedServers: string[]): string[] {
  const knownServers = new Set<string>()
  crawl(ns, knownServers)

  const nukedServers: string[] = []
  for (const serverName of knownServers) {
    const server = ns.getServer(serverName)
    if (serverName === "home" || purchasedServers.includes(serverName) || serverName.startsWith("hacknet")) {
      continue
    }
    if (server.hasAdminRights && server.maxRam > 0) {
      nukedServers.push(serverName)
    }
  }
  return nukedServers
}

/**
 * Get worker hosts for batching.
 * Default (auto): purchased pool if it beats nuked RAM, else nuked; always includes home except `home` mode.
 */
export function getNodesForBatching(ns: NS, options?: Partial<BatchRunOptions>): string[] {
  const workers = options?.workers ?? "auto"
  const excludeHacknet = options?.excludeHacknet ?? false
  const purchasedServers = getPurchasedNodes(ns, excludeHacknet)
  const nukedServers = getNukedServersForBatching(ns, purchasedServers)

  if (workers === "home") {
    return ["home"]
  }

  if (workers === "nuked") {
    return ["home", ...nukedServers]
  }

  if (workers === "purchased") {
    return purchasedServers.length > 0 ? ["home", ...purchasedServers] : ["home"]
  }

  const purchasedTotalRam = purchasedServers.reduce((sum, node) => sum + getEffectiveMaxRam(ns, node), 0)
  const nukedTotalRam = nukedServers.reduce((sum, node) => sum + getEffectiveMaxRam(ns, node), 0)

  if (purchasedServers.length === 0) {
    return ["home", ...nukedServers]
  }

  if (purchasedTotalRam > nukedTotalRam) {
    return ["home", ...purchasedServers]
  }

  return ["home", ...nukedServers]
}

const TARGETED_HACKING_SCRIPT_SUFFIXES = [
  "hack.js",
  "grow.js",
  "weaken.js",
  "hackDebug.js",
  "growDebug.js",
  "weakenDebug.js",
]

function isTargetedHackingScript(filename: string): boolean {
  return TARGETED_HACKING_SCRIPT_SUFFIXES.some((suffix) => filename.endsWith(suffix))
}

/** Kill all hack/grow/weaken scripts on worker hosts (any target). */
export function killAllHackingScriptsOnNodes(ns: NS, hosts: string[]): number {
  let killed = 0
  for (const host of hosts) {
    for (const proc of ns.ps(host)) {
      if (!isTargetedHackingScript(proc.filename)) continue
      ns.kill(proc.pid)
      killed++
    }
  }
  return killed
}

/** Kill hack/grow/weaken on worker hosts only when their first arg matches `target`. */
export function killHackingScriptsForTarget(ns: NS, hosts: string[], target: string): number {
  let killed = 0
  for (const host of hosts) {
    for (const proc of ns.ps(host)) {
      if (!isTargetedHackingScript(proc.filename)) continue
      if (String(proc.args[0]) !== target) continue
      ns.kill(proc.pid)
      killed++
    }
  }
  return killed
}

export function purchaseAdditionalServers(ns: NS): number {
  if (!ns.serverExists("node00")) return 0

  const maxRam = ns.cloud.getRamLimit()
  const currentRam = getEffectiveMaxRam(ns, "node00")

  if (currentRam < maxRam) return 0

  const cost = ns.cloud.getServerCost(maxRam)
  let money = ns.getPlayer().money
  let purchaseCount = 0

  // Buy or upgrade as many maxed servers as we can afford
  for (let i = 1; i < 25; i++) {
    const nodeName = "node" + String(i).padStart(2, "0")

    if (!ns.serverExists(nodeName) && money >= cost) {
      ns.cloud.purchaseServer(nodeName, maxRam)
      ns.tprint(`Bought new maxed server: ${nodeName} (${maxRam} GB)`)
      money -= cost
      purchaseCount++
    } else if (ns.serverExists(nodeName) && getEffectiveMaxRam(ns, nodeName) < maxRam && money >= cost) {
      ns.killall(nodeName)
      ns.cloud.deleteServer(nodeName)
      ns.cloud.purchaseServer(nodeName, maxRam)
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
