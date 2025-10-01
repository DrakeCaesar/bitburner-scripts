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

interface BestTargetResult {
  serverName: string
  hackThreshold: number
  moneyPerSecond: number
}

export function findBestTarget(
  ns: NS,
  totalMaxRam: number,
  myCores: number,
  batchDelay: number,
  playerHackLevel?: number
): BestTargetResult {
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

  ns.tprint(`Found ${hackableServers.length} hackable servers, analyzing profitability...`)

  let bestServer = ""
  let bestMoneyPerSecond = 0
  let bestThreshold = 0.5

  for (const targetName of hackableServers) {
    // Simulate prepared server
    const server = ns.getServer(targetName)
    server.hackDifficulty = server.minDifficulty
    server.moneyAvailable = server.moneyMax
    const moneyMax = server.moneyMax!

    const weakenTime = ns.formulas.hacking.weakenTime(server, player)

    // Test different thresholds for this server
    let serverBestMoneyPerSecond = 0
    let serverBestThreshold = 0.5

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

      // Calculate RAM usage
      const totalBatchRam =
        hackScriptRam * hackThreads +
        weakenScriptRam * wkn1Threads +
        growScriptRam * growThreads +
        weakenScriptRam * wkn2Threads

      const batches = Math.floor((totalMaxRam / totalBatchRam) * 0.9)

      // Calculate total money per cycle
      const moneyPerBatch = moneyMax * (1 - testThreshold)
      const totalMoneyPerCycle = moneyPerBatch * batches

      // Calculate cycle time
      const lastBatchOffset = (batches - 1) * batchDelay * 4
      const lastOperationFinishTime = weakenTime + 2 * batchDelay + lastBatchOffset
      const cycleTime = lastOperationFinishTime
      const moneyPerSecond = (totalMoneyPerCycle / cycleTime) * 1000

      if (moneyPerSecond > serverBestMoneyPerSecond) {
        serverBestMoneyPerSecond = moneyPerSecond
        serverBestThreshold = testThreshold
      }
    }

    // Track best overall server
    if (serverBestMoneyPerSecond > bestMoneyPerSecond) {
      bestMoneyPerSecond = serverBestMoneyPerSecond
      bestServer = targetName
      bestThreshold = serverBestThreshold
    }
  }

  ns.tprint("")
  ns.tprint("=".repeat(60))
  ns.tprint(`Best target: ${bestServer}`)
  ns.tprint(`Optimal hack threshold: ${(bestThreshold * 100).toFixed(2)}%`)
  ns.tprint(`Expected income: ${ns.formatNumber(bestMoneyPerSecond)}/sec`)
  ns.tprint("=".repeat(60))

  return {
    serverName: bestServer,
    hackThreshold: bestThreshold,
    moneyPerSecond: bestMoneyPerSecond,
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
  const myCores = nodes.length > 0 ? ns.getServer(nodes[0]).cpuCores : 1

  const result = findBestTarget(ns, totalMaxRam, myCores, playerHackLevel)

  ns.tprint("")
  ns.tprint(`To start batching: run batch.js`)
}
