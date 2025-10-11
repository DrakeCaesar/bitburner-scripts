import { NS } from "@ns"
import {
  calculateGrowThreads,
  calculateHackThreads,
  calculatePrepTime,
  calculateWeakThreads,
  growServerInstance,
  hackServerInstance,
  wkn1ServerInstance,
  wkn2ServerInstance,
} from "./batchCalculations.js"
import { crawl } from "./crawl.js"
import { distributeBatchesAcrossNodes, getAllNodes } from "./serverManagement.js"
import { buildTable } from "./tableBuilder.js"

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
 * @param nodeRamLimit - constrains single operation size
 * @param nodes - Array of node names to use for prep time calculation
 * @param batchCycles - Number of batch cycles to weight against prep time (default: 3)
 * @returns Array of servers sorted by profitability (best first)
 */
export function analyzeAllServers(
  ns: NS,
  totalMaxRam: number,
  nodeRamLimit: number,
  myCores: number,
  batchDelay: number,
  nodes: string[],
  playerHackLevel?: number,
  batchCycles: number = 20
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
    // Calculate accurate prep time using the same function as batch.ts
    const prepTimeResult = calculatePrepTime(ns, nodes, targetName, false)
    const prepTime = prepTimeResult.totalTime

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

    // Store results for table output
    const thresholdResults: Array<{
      threshold: number
      cycleTime: number
      moneyPerCycle: number
      moneyPerSecond: number
      batches: number
      batchRam: number
    }> = []

    // Use logarithmic distribution: more samples near 1.0 (99-100%) than near 0
    // This gives us finer granularity where it matters most
    const totalSteps = 200
    for (let i = 1; i < totalSteps; i++) {
      // Map i logarithmically: threshold = 1 - 10^(-x)
      // When i=0: threshold ≈ 0, when i→totalSteps: threshold → 1
      const logScale = i / totalSteps // 0 to ~1
      const testThreshold = 1 - Math.pow(10, -logScale * 3) // Maps to ~0.001 to 0.999
      // ns.tprint(`Testing ${targetName} at threshold ${(testThreshold * 100).toFixed(2)}%`)

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

      // Check if the total batch RAM fits in the smallest node
      if (totalBatchRam > nodeRamLimit) {
        // Skip this threshold - batch too large for smallest node
        continue
      }

      // Use knapsack algorithm to determine realistic batch count
      // This accounts for RAM fragmentation and distribution inefficiencies
      const estimatedBatches = Math.floor(totalMaxRam / totalBatchRam)
      const testOperations: Array<{
        ram: number
        scriptPath: string
        args: any[]
        threads: number
        batchIndex: number
      }> = []

      // Create mock operations for estimated batches
      for (let b = 0; b < estimatedBatches; b++) {
        testOperations.push(
          { ram: hackRam, scriptPath: "/hacking/hack.js", args: [], threads: hackThreads, batchIndex: b },
          { ram: wkn1Ram, scriptPath: "/hacking/weaken.js", args: [], threads: wkn1Threads, batchIndex: b },
          { ram: growRam, scriptPath: "/hacking/grow.js", args: [], threads: growThreads, batchIndex: b },
          { ram: wkn2Ram, scriptPath: "/hacking/weaken.js", args: [], threads: wkn2Threads, batchIndex: b }
        )
      }

      // Simulate knapsack distribution to get realistic batch count
      const { completeBatches: batches } = distributeBatchesAcrossNodes(ns, nodes, testOperations)

      // Calculate total money per cycle
      const moneyPerBatch = moneyMax * (1 - testThreshold)
      const totalMoneyPerCycle = moneyPerBatch * batches

      // Calculate cycle time
      const lastBatchOffset = (batches - 1) * batchDelay * 4
      const lastOperationFinishTime = weakenTime + 2 * batchDelay + lastBatchOffset
      const batchCycleTime = lastOperationFinishTime

      // Weight prep time vs batch cycles:
      // Prep happens once, batches run multiple times (batchCycles parameter, default 3)
      // Total time = prepTime + (batchCycleTime * batchCycles)
      // Total money = totalMoneyPerCycle * batchCycles
      const totalTime = prepTime + batchCycleTime * batchCycles
      const totalMoney = totalMoneyPerCycle * batchCycles
      const moneyPerSecond = totalTime > 0 ? (totalMoney / totalTime) * 1000 : 0

      // Store result for this threshold
      thresholdResults.push({
        threshold: testThreshold,
        cycleTime: batchCycleTime,
        moneyPerCycle: totalMoneyPerCycle,
        moneyPerSecond: moneyPerSecond,
        batches: batches,
        batchRam: totalBatchRam,
      })

      if (moneyPerSecond > serverBestMoneyPerSecond) {
        serverBestMoneyPerSecond = moneyPerSecond
        serverBestThreshold = testThreshold
        serverBestBatchRam = totalBatchRam
        serverBestBatches = batches
      }
    }

    // Print table for this server using the table builder
    const serverTable = buildTable({
      title: `${targetName} (Level ${server.requiredHackingSkill}, Max: ${ns.formatNumber(moneyMax)})`,
      columns: [
        { header: "Threshold", align: "right" },
        { header: "Cycle Time", align: "right" },
        { header: "Money/Cycle", align: "right" },
        { header: "Money/Sec", align: "right" },
        { header: "Batches", align: "right" },
      ],
      rows: thresholdResults
        .filter((_, i) => i % 10 === 0) // Print every 10th result to keep output manageable
        .map((result) => [
          `${(result.threshold * 100).toFixed(2)}%`,
          ns.tFormat(result.cycleTime),
          ns.formatNumber(result.moneyPerCycle),
          ns.formatNumber(result.moneyPerSecond),
          result.batches.toString(),
        ]),
    })
    ns.tprint(serverTable)

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
  nodeRamLimit: number,
  myCores: number,
  batchDelay: number,
  nodes: string[],
  playerHackLevel?: number,
  batchCycles: number = 3
): BestTargetResult {
  // Use the analysis function to get all server profitability data
  const profitabilityData = analyzeAllServers(
    ns,
    totalMaxRam,
    nodeRamLimit,
    myCores,
    batchDelay,
    nodes,
    playerHackLevel,
    batchCycles
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
  const nodes = getAllNodes(ns)
  if (nodes.length === 0) {
    nodes.push("home")
  }

  const totalMaxRam = nodes.reduce((sum, node) => sum + ns.getServerMaxRam(node), 0)
  const nodeRamLimit = Math.min(...nodes.map((node) => ns.getServerMaxRam(node)))
  const myCores = ns.getServer(nodes[0]).cpuCores

  findBestTarget(ns, totalMaxRam, nodeRamLimit, myCores, 20, nodes, playerHackLevel)

  ns.tprint("")
  ns.tprint(`To start batching: run batch.js`)
}
