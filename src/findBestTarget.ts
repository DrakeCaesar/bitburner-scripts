import { NS } from "@ns"
import {
  calculateGrowThreads,
  calculateHackThreads,
  calculateWeakThreads,
  growServerInstance,
  hackServerInstance,
  wkn1ServerInstance,
  wkn2ServerInstance,
} from "./batchCalculations.js"
import { crawl } from "./crawl.js"

export interface BestTargetResult {
  serverName: string
  hackThreshold: number
  moneyPerSecond: number
}

export interface ServerProfitability {
  serverName: string
  hackLevel: number
  moneyMax: number
  weakenTime: number
  optimalThreshold: number
  moneyPerSecond: number
  batchRam: number
  batches: number
}

/**
 * Analyze all hackable servers and return detailed profitability data
 * @param totalMaxRam - Total RAM across all nodes (for calculating total batches)
 * @param minNodeRam - Minimum RAM of the smallest node (constrains single operation size)
 * @param includePrepTime - If true, includes server prep time in profitability calculation (default: false)
 * @returns Array of servers sorted by profitability (best first)
 */
export function analyzeAllServers(
  ns: NS,
  totalMaxRam: number,
  minNodeRam: number,
  myCores: number,
  batchDelay: number,
  playerHackLevel?: number,
  includePrepTime: Boolean = false
): ServerProfitability[] {
  // Get all servers
  const knownServers = new Set<string>()
  crawl(ns, knownServers)

  const player = ns.getPlayer()
  const maxHackLevel = playerHackLevel ?? player.skills.hacking

  // Get constants
  const hackScriptRam = ns.getScriptRam("/hacking/hack.js")
  const weakenScriptRam = ns.getScriptRam("/hacking/weaken.js")
  const growScriptRam = ns.getScriptRam("/hacking/grow.js")

  // Filter servers we can hack
  const hackableServers = Array.from(knownServers).filter((serverName) => {
    const server = ns.getServer(serverName)
    return server.requiredHackingSkill! <= maxHackLevel && server.moneyMax! > 0 && server.hasAdminRights
  })

  const profitabilityData: ServerProfitability[] = []

  for (const targetName of hackableServers) {
    // Calculate prep time if requested
    let prepTime = 0
    if (includePrepTime) {
      const actualServer = ns.getServer(targetName)
      const securityDiff = (actualServer.hackDifficulty ?? 0) - (actualServer.minDifficulty ?? 0)
      const moneyRatio = (actualServer.moneyAvailable ?? 0) / (actualServer.moneyMax ?? 1)

      // Estimate prep time:
      // - If security is above minimum OR money is below max, we need to prep
      // - Prep requires weaken (if security high) + grow (if money low) + weaken (after grow)
      // - Worst case: full weaken time (they run in parallel but weaken is longest)
      const needsPrep = securityDiff > 0 || moneyRatio < 1
      prepTime = needsPrep ? ns.formulas.hacking.weakenTime(actualServer, player) : 0
    }

    // Simulate prepared server
    const server = ns.getServer(targetName)
    server.hackDifficulty = server.minDifficulty
    server.moneyAvailable = server.moneyMax
    const moneyMax = server.moneyMax!

    const weakenTime = ns.formulas.hacking.weakenTime(server, player)

    // Test different thresholds for this server
    let serverBestMoneyPerSecond = 0
    let serverBestThreshold = 0.5
    let serverBestBatchRam = 0
    let serverBestBatches = 0

    const steps = 100
    for (let i = 1; i <= steps - 1; i++) {
      const testThreshold = i / steps

      // Calculate threads for this threshold
      const { server: hackServer, player: hackPlayer } = hackServerInstance(server, player)
      const hackThreads = calculateHackThreads(hackServer, hackPlayer, moneyMax, testThreshold, ns)

      const { server: wkn1Server, player: wkn1Player } = wkn1ServerInstance(server, player, hackThreads, ns)
      const wkn1Threads = calculateWeakThreads(wkn1Server, wkn1Player, myCores)

      const { server: growServer, player: growPlayer } = growServerInstance(server, player, testThreshold)
      const growThreads = calculateGrowThreads(growServer, growPlayer, moneyMax, myCores, ns)

      const { server: wkn2Server, player: wkn2Player } = wkn2ServerInstance(server, player, growThreads, ns, myCores)
      const wkn2Threads = calculateWeakThreads(wkn2Server, wkn2Player, myCores)

      // Calculate RAM usage for each operation
      const hackRam = hackScriptRam * hackThreads
      const wkn1Ram = weakenScriptRam * wkn1Threads
      const growRam = growScriptRam * growThreads
      const wkn2Ram = weakenScriptRam * wkn2Threads
      const totalBatchRam = hackRam + wkn1Ram + growRam + wkn2Ram

      // Check if the largest single operation fits in the smallest node
      const maxOperationRam = Math.max(hackRam, wkn1Ram, growRam, wkn2Ram)
      if (maxOperationRam > minNodeRam) {
        // Skip this threshold - operations too large for smallest node
        continue
      }

      const batches = Math.floor((totalMaxRam / totalBatchRam) * 0.9)

      // Calculate total money per cycle
      const moneyPerBatch = moneyMax * (1 - testThreshold)
      const totalMoneyPerCycle = moneyPerBatch * batches

      // Calculate cycle time (including prep time)
      const lastBatchOffset = (batches - 1) * batchDelay * 4
      const lastOperationFinishTime = weakenTime + 2 * batchDelay + lastBatchOffset
      const batchCycleTime = lastOperationFinishTime
      const totalCycleTime = batchCycleTime + prepTime
      const moneyPerSecond = (totalMoneyPerCycle / totalCycleTime) * 1000

      if (moneyPerSecond > serverBestMoneyPerSecond) {
        serverBestMoneyPerSecond = moneyPerSecond
        serverBestThreshold = testThreshold
        serverBestBatchRam = totalBatchRam
        serverBestBatches = batches
      }
    }

    profitabilityData.push({
      serverName: targetName,
      hackLevel: server.requiredHackingSkill!,
      moneyMax: moneyMax,
      weakenTime: weakenTime,
      optimalThreshold: serverBestThreshold,
      moneyPerSecond: serverBestMoneyPerSecond,
      batchRam: serverBestBatchRam,
      batches: serverBestBatches,
    })
  }

  // Sort by money per second (descending)
  profitabilityData.sort((a, b) => b.moneyPerSecond - a.moneyPerSecond)

  return profitabilityData
}

export function findBestTarget(
  ns: NS,
  totalMaxRam: number,
  minNodeRam: number,
  myCores: number,
  batchDelay: number,
  playerHackLevel?: number,
  includePrepTime = false
): BestTargetResult {
  // Use the analysis function to get all server profitability data
  const profitabilityData = analyzeAllServers(
    ns,
    totalMaxRam,
    minNodeRam,
    myCores,
    batchDelay,
    playerHackLevel,
    includePrepTime
  )

  ns.tprint(`Found ${profitabilityData.length} hackable servers, analyzing profitability...`)

  // Best server is the first one (already sorted by profitability)
  const best = profitabilityData[0]

  if (!best) {
    throw new Error("No hackable servers found!")
  }

  ns.tprint("")
  ns.tprint("=".repeat(60))
  ns.tprint(`Best target: ${best.serverName}`)
  ns.tprint(`Optimal hack threshold: ${(best.optimalThreshold * 100).toFixed(2)}%`)
  ns.tprint(`Expected income: ${ns.formatNumber(best.moneyPerSecond)}/sec`)
  ns.tprint("=".repeat(60))

  return {
    serverName: best.serverName,
    hackThreshold: best.optimalThreshold,
    moneyPerSecond: best.moneyPerSecond,
  }
}

export async function main(ns: NS) {
  const playerHackLevel = ns.args[0] ? Number(ns.args[0]) : undefined

  // Get all nodes and calculate total RAM
  const nodes: string[] = []
  for (let i = 0; i < 25; i++) {
    const nodeName = "node" + String(i).padStart(2, "0")
    if (ns.serverExists(nodeName)) {
      nodes.push(nodeName)
    }
  }

  const totalMaxRam = nodes.reduce((sum, node) => sum + ns.getServerMaxRam(node), 0)
  const minNodeRam =
    nodes.length > 0 ? Math.min(...nodes.map((node) => ns.getServerMaxRam(node))) : ns.getServerMaxRam("home")
  const myCores = nodes.length > 0 ? ns.getServer(nodes[0]).cpuCores : 1

  const result = findBestTarget(ns, totalMaxRam, minNodeRam, myCores, 20, playerHackLevel)

  ns.tprint("")
  ns.tprint(`To start batching: run batch.js`)
}
