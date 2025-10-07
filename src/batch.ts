import { NS } from "@ns"
import {
  calculatePrepTime,
  copyRequiredScripts,
  killOtherInstances,
  prepareServerMultiNode,
} from "./batchCalculations.js"
// import { initBatchVisualiser, logBatchOperation } from "./batchVisualiser.js"
import { main as autoNuke } from "./autoNuke.js"
// import { upgradeServer } from "./buyServer.js"
import { upgradeServer } from "./buyServer.js"
import { findBestTarget } from "./findBestTarget.js"
import { calculateBatchThreads, calculateBatchTimings, executeBatches } from "./libraries/batchExecution.js"
import { purchasePrograms, purchaseTorRouter } from "./libraries/purchasePrograms.js"
import { getNodesForBatching, purchaseAdditionalServers } from "./libraries/serverManagement.js"

export async function main(ns: NS) {
  const playerHackLevel = ns.args[0] ? Number(ns.args[0]) : undefined

  await killOtherInstances(ns)

  while (true) {
    // initBatchVisualiser()

    // Purchase TOR router and programs
    purchaseTorRouter(ns)
    purchasePrograms(ns)

    // Run autoNuke to gain access to new servers
    await autoNuke(ns)

    // Try to upgrade node00 first
    const wasUpgraded = upgradeServer(ns, "node00")
    if (wasUpgraded) {
      ns.tprint("Server was upgraded, restarting batch cycle...")
    }

    // If node00 is maxed out, try to buy additional servers
    purchaseAdditionalServers(ns)

    // Get nodes for batching (purchased servers or all nuked servers)
    const nodes = getNodesForBatching(ns)

    if (nodes.length === 0) {
      ns.tprint("ERROR: No nodes with root access found")
      return
    }

    // Kill all scripts on all nodes and copy required scripts
    for (const node of nodes) {
      ns.killall(node)
      await copyRequiredScripts(ns, node)
    }

    const batchDelay = 50
    const ramThreshold = 0.9

    // Calculate total RAM across all nodes and find minimum node RAM
    // For home, subtract used RAM since this script is running there
    const totalMaxRam = nodes.reduce((sum, node) => {
      if (node === "home") {
        return sum + (ns.getServerMaxRam(node) - ns.getServerUsedRam(node))
      }
      return sum + ns.getServerMaxRam(node)
    }, 0)
    const minNodeRam = Math.max(
      16,
      Math.min(
        ...nodes.map((node) => {
          return ns.getServerMaxRam(node)
        })
      )
    )
    ns.tprint(`Minimum node RAM: ${ns.formatRam(minNodeRam)}`)
    const myCores = ns.getServer(nodes[0]).cpuCores

    // Find best target automatically (constrained by smallest node RAM)
    const target = findBestTarget(ns, totalMaxRam, minNodeRam, myCores, batchDelay, nodes, playerHackLevel)
    const player = ns.getPlayer()

    ns.tprint(`Target: ${target.serverName}`)
    ns.tprint(`Using ${nodes.length} node(s) with ${ns.formatRam(totalMaxRam)} total RAM`)
    ns.tprint(
      `Using optimal hack threshold: ${(target.hackThreshold * 100).toFixed(2)}% (${ns.formatNumber(target.moneyPerSecond)}/sec)`
    )

    // Create a simulated prepared server (min security, max money)
    const server = ns.getServer(target.serverName)
    server.hackDifficulty = server.minDifficulty
    server.moneyAvailable = server.moneyMax

    // Debug flag - set to true for verbose prep output
    const debug = true

    // Calculate and show estimated prep time based on available RAM across all nodes
    const calcStartTime = Date.now()
    const prepEstimate = calculatePrepTime(ns, nodes, target.serverName, debug) // Pass debug flag
    const calcEndTime = Date.now()
    const calcDuration = calcEndTime - calcStartTime

    if (debug) {
      ns.tprint(`Prep calculation took: ${calcDuration}ms`)
    }

    if (prepEstimate.totalTime > 0) {
      ns.tprint(`Preparing ${target.serverName}... (estimated time: ${ns.tFormat(prepEstimate.totalTime)})`)
    } else {
      ns.tprint(`${target.serverName} is already prepared!`)
    }

    // Use multi-node prep to distribute operations across all available nodes
    // Pass predicted iterations for comparison
    const prepStartTime = Date.now()
    await prepareServerMultiNode(ns, nodes, target.serverName, prepEstimate.iterationDetails, debug)
    const prepEndTime = Date.now()
    const actualPrepTime = prepEndTime - prepStartTime

    // Print timing comparison
    const timeDiff = actualPrepTime - prepEstimate.totalTime
    const percentDiff = ((timeDiff / prepEstimate.totalTime) * 100).toFixed(1)
    if (debug) {
      ns.tprint(
        `\n=== TOTAL PREP TIME ===\n` +
          `Estimated: ${ns.tFormat(prepEstimate.totalTime)}\n` +
          `Actual: ${ns.tFormat(actualPrepTime)}\n` +
          `Difference: ${Math.abs(timeDiff).toFixed(0)}ms (${percentDiff}%)`
      )
    }

    // return //debug

    // Calculate batch configuration
    const batchConfigStartTime = Date.now()
    const batchConfig = {
      target: target.serverName,
      server,
      player,
      hackThreshold: target.hackThreshold,
      batchDelay,
      myCores,
      nodes,
      totalMaxRam,
      ramThreshold,
      minNodeRam,
    }

    const threads = calculateBatchThreads(ns, batchConfig)
    const timings = calculateBatchTimings(ns, server, player, batchDelay)
    const batchConfigEndTime = Date.now()
    const batchConfigDuration = batchConfigEndTime - batchConfigStartTime
    const prepToBatchGap = batchConfigStartTime - prepEndTime

    ns.tprint(
      `\n=== Timing Summary ===\n` +
        `Prep calculation: ${calcDuration}ms\n` +
        `Actual prep execution: ${ns.tFormat(actualPrepTime)}\n` +
        `Gap between prep end and batch config start: ${prepToBatchGap}ms\n` +
        `Batch configuration calculation: ${batchConfigDuration}ms`
    )

    ns.tprint(`Requested batch delay: ${ns.tFormat(batchDelay)}`)
    if (timings.effectiveBatchDelay !== batchDelay) {
      ns.tprint(`Effective batch delay: ${ns.tFormat(timings.effectiveBatchDelay)} (adjusted due to low weaken time)`)
    }
    if (threads.actualThreshold !== target.hackThreshold) {
      ns.tprint(
        `Adjusted hack threshold from ${(target.hackThreshold * 100).toFixed(2)}% to ${(threads.actualThreshold * 100).toFixed(2)}% to fit in ${ns.formatRam(minNodeRam)} nodes`
      )
    }
    ns.tprint(
      `Batch RAM: ${threads.totalBatchRam.toFixed(2)} GB - Threads (H:${threads.hackThreads} W1:${threads.wkn1Threads} G:${threads.growThreads} W2:${threads.wkn2Threads})`
    )
    const maxBatches = Math.floor((totalMaxRam / threads.totalBatchRam) * ramThreshold)
    // const batches = Math.min(10, maxBatches) // DEBUG: Limit to 10 batches (40 ops)
    const batches = maxBatches
    ns.tprint(
      `Can run ${maxBatches} batches in parallel, limiting to ${batches} for debugging (${ns.formatRam(totalMaxRam)} total RAM)`
    )
    ns.tprint(`Weaken time: ${ns.tFormat(timings.weakenTime)}`)
    ns.tprint(`Batch interval: ${ns.tFormat(timings.effectiveBatchDelay * 4)}`)

    // Calculate predicted batch cycle time
    const lastBatchOffset = (batches - 1) * timings.effectiveBatchDelay * 4
    const lastOperationFinishTime = timings.weakenTime + 2 * timings.effectiveBatchDelay + lastBatchOffset
    const predictedBatchCycleTime = lastOperationFinishTime
    ns.tprint(`Predicted batch cycle time: ${ns.tFormat(predictedBatchCycleTime)}`)

    // Security checks
    const minSecurity = ns.getServerMinSecurityLevel(target.serverName)
    const currentSecurity = ns.getServerSecurityLevel(target.serverName)
    const securityDiff = currentSecurity - minSecurity
    if (securityDiff > 0) {
      ns.tprint(`WARNING: ${target.serverName} security above minimum by ${securityDiff.toFixed(2)}`)
    }

    // Execute batches with timing measurement
    const batchStartTime = Date.now()
    await executeBatches(ns, batchConfig, threads, timings, batches)
    const batchEndTime = Date.now()
    const actualBatchCycleTime = batchEndTime - batchStartTime

    const finalSecurity = ns.getServerSecurityLevel(target.serverName)
    const currentMoney = ns.getServerMoneyAvailable(target.serverName)
    const maxMoney = ns.getServerMaxMoney(target.serverName)
    const moneyPercent = (currentMoney / maxMoney) * 100

    // Print batch timing comparison
    const batchTimeDiff = actualBatchCycleTime - predictedBatchCycleTime
    const batchPercentDiff = ((batchTimeDiff / predictedBatchCycleTime) * 100).toFixed(1)

    ns.tprint("\n=== BATCH EXECUTION RESULTS ===")
    ns.tprint("SUCCESS: All batches completed")
    ns.tprint(
      `Security: ${finalSecurity.toFixed(2)} / ${minSecurity.toFixed(2)} (+${(finalSecurity - minSecurity).toFixed(2)})`
    )
    ns.tprint(`Money: ${moneyPercent.toFixed(2)}% (${ns.formatNumber(currentMoney)} / ${ns.formatNumber(maxMoney)})`)

    if (debug) {
      ns.tprint(
        `\n=== BATCH CYCLE TIME ===\n` +
          `Predicted: ${ns.tFormat(predictedBatchCycleTime)}\n` +
          `Actual: ${ns.tFormat(actualBatchCycleTime)}\n` +
          `Difference: ${Math.abs(batchTimeDiff).toFixed(0)}ms (${batchPercentDiff}%)`
      )
    }
    // break
  }
}
