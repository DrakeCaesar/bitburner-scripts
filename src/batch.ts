import { NS } from "@ns"
import {
  calculatePrepTime,
  copyRequiredScripts,
  killOtherInstances,
  prepareServerMultiNode,
} from "./libraries/batchCalculations.js"
// import { initBatchVisualiser, logBatchOperation } from "./batchVisualiser.js"
import { autoNuke } from "./autoNuke.js"
import { calculateBatchThreads, calculateBatchTimings, executeBatches } from "./libraries/batchExecution.js"
import { upgradeServer } from "./libraries/buyServer.js"
import { findBestTarget } from "./libraries/findBestTarget.js"
import { purchasePrograms, purchaseTorRouter } from "./libraries/purchasePrograms.js"
import { getNodesForBatching } from "./libraries/serverManagement.js"

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

    // Try to purchase or upgrade servers
    const wasUpgraded = upgradeServer(ns)
    if (wasUpgraded) {
      ns.tprint("Server was purchased/upgraded, restarting batch cycle...")
    }

    // Get nodes for batching (purchased servers or all nuked servers)
    const nodes = getNodesForBatching(ns)

    if (nodes.length === 0) {
      ns.tprint("ERROR: No nodes with root access found")
      return
    }

    // Kill all scripts on all nodes and copy required scripts
    for (const node of nodes) {
      ns.scriptKill("hacking/hack.js", node)
      ns.scriptKill("hacking/grow.js", node)
      ns.scriptKill("hacking/weaken.js", node)
      await copyRequiredScripts(ns, node)
    }

    const batchDelay = 20
    const ramThreshold = 1

    // Calculate total RAM across all nodes and find minimum node RAM
    // For home, subtract used RAM since this script is running there
    const totalMaxRam = nodes.reduce((sum, node) => {
      if (node === "home") {
        return sum + (ns.getServerMaxRam(node) - ns.getServerUsedRam(node))
      }
      return sum + ns.getServerMaxRam(node)
    }, 0)

    // Use median of available servers
    const nodeRamValues = nodes.map((node) => ns.getServerMaxRam(node)).sort((a, b) => a - b)
    const middle = Math.floor(nodeRamValues.length / 2)
    let nodeRamLimit =
      nodeRamValues.length % 2 === 0 ? (nodeRamValues[middle - 1] + nodeRamValues[middle]) / 2 : nodeRamValues[middle]
    nodeRamLimit *= 1.0 // DEBUG: Adjust to test different scenarios

    ns.tprint(`Minimum node RAM: ${ns.formatRam(nodeRamLimit)}`)
    const myCores = ns.getServer(nodes[0]).cpuCores

    // Find best target automatically (constrained by smallest node RAM)
    const target = findBestTarget(ns, totalMaxRam, nodeRamLimit, myCores, batchDelay, nodes, playerHackLevel)
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
      nodeRamLimit,
    }

    const threads = calculateBatchThreads(ns, batchConfig)
    const timings = calculateBatchTimings(ns, server, player, batchDelay)
    const batchConfigEndTime = Date.now()
    const batchConfigDuration = batchConfigEndTime - batchConfigStartTime
    const prepToBatchGap = batchConfigStartTime - prepEndTime

    const maxBatches = Math.floor((totalMaxRam / threads.totalBatchRam) * ramThreshold)
    const batches = maxBatches

    // Calculate predicted batch cycle time and money
    const lastBatchOffset = (batches - 1) * timings.effectiveBatchDelay * 4
    const lastOperationFinishTime = timings.weakenTime + 2 * timings.effectiveBatchDelay + lastBatchOffset
    const predictedBatchCycleTime = lastOperationFinishTime
    const targetMaxMoney = ns.getServerMaxMoney(target.serverName)
    const moneyPerBatch = targetMaxMoney * (1 - threads.actualThreshold)
    const totalMoneyPerCycle = moneyPerBatch * batches
    const moneyPerSecond = predictedBatchCycleTime > 0 ? (totalMoneyPerCycle / predictedBatchCycleTime) * 1000 : 0

    // Table 1: Batch Configuration
    const configRows = [
      { label: "Target Server", value: target.serverName },
      { label: "Hack Threshold", value: `${(threads.actualThreshold * 100).toFixed(2)}%` },
      { label: "Max Money", value: ns.formatNumber(targetMaxMoney) },
      { label: "Money/Batch", value: ns.formatNumber(moneyPerBatch) },
      { label: "Money/Cycle", value: ns.formatNumber(totalMoneyPerCycle) },
      { label: "Money/Second", value: `${ns.formatNumber(moneyPerSecond)}/s` },
      { label: "Parallel Batches", value: batches.toString() },
      { label: "Total Nodes", value: nodes.length.toString() },
      { label: "Total RAM", value: ns.formatRam(totalMaxRam) },
    ]

    if (threads.actualThreshold !== target.hackThreshold) {
      configRows.splice(1, 0, {
        label: "Original Threshold",
        value: `${(target.hackThreshold * 100).toFixed(2)}% (adjusted to fit)`,
      })
    }

    let labelLen = Math.max(...configRows.map((r) => r.label.length))
    let valueLen = Math.max(...configRows.map((r) => r.value.length))

    let configTable = `\n═══ Batch Configuration ═══\n`
    configTable += `┏━${"━".repeat(labelLen)}━┳━${"━".repeat(valueLen)}━┓\n`
    for (let i = 0; i < configRows.length; i++) {
      const row = configRows[i]
      configTable += `┃ ${row.label.padEnd(labelLen)} ┃ ${row.value.padStart(valueLen)} ┃\n`
      if (i === 5) {
        // Add separator after Money/Second
        configTable += `┣━${"━".repeat(labelLen)}━╋━${"━".repeat(valueLen)}━┫\n`
      }
    }
    configTable += `┗━${"━".repeat(labelLen)}━┻━${"━".repeat(valueLen)}━┛`
    ns.tprint(configTable)

    // Table 2: Thread Distribution & Timing
    const timingRows = [
      {
        label: "Hack Threads",
        value: threads.hackThreads.toString(),
        ram: ns.formatRam(ns.getScriptRam("/hacking/hack.js") * threads.hackThreads),
      },
      {
        label: "Weaken 1 Threads",
        value: threads.wkn1Threads.toString(),
        ram: ns.formatRam(ns.getScriptRam("/hacking/weaken.js") * threads.wkn1Threads),
      },
      {
        label: "Grow Threads",
        value: threads.growThreads.toString(),
        ram: ns.formatRam(ns.getScriptRam("/hacking/grow.js") * threads.growThreads),
      },
      {
        label: "Weaken 2 Threads",
        value: threads.wkn2Threads.toString(),
        ram: ns.formatRam(ns.getScriptRam("/hacking/weaken.js") * threads.wkn2Threads),
      },
      { label: "Total Batch RAM", value: "", ram: ns.formatRam(threads.totalBatchRam) },
      { label: "Weaken Time", value: ns.tFormat(timings.weakenTime), ram: "" },
      {
        label: "Batch Delay",
        value: ns.tFormat(timings.effectiveBatchDelay),
        ram: timings.effectiveBatchDelay !== batchDelay ? "(adjusted)" : "",
      },
      { label: "Batch Interval", value: ns.tFormat(timings.effectiveBatchDelay * 4), ram: "" },
      { label: "Cycle Time", value: ns.tFormat(predictedBatchCycleTime), ram: "" },
    ]

    labelLen = Math.max(...timingRows.map((r) => r.label.length))
    valueLen = Math.max(...timingRows.map((r) => r.value.length))
    let ramLen = Math.max(...timingRows.map((r) => r.ram.length), 6)

    let timingTable = `\n═══ Thread Distribution & Timing ═══\n`
    timingTable += `┏━${"━".repeat(labelLen)}━┳━${"━".repeat(valueLen)}━┳━${"━".repeat(ramLen)}━┓\n`
    timingTable += `┃ ${"Operation".padEnd(labelLen)} ┃ ${"Threads".padStart(valueLen)} ┃ ${"RAM".padStart(ramLen)} ┃\n`
    timingTable += `┣━${"━".repeat(labelLen)}━╋━${"━".repeat(valueLen)}━╋━${"━".repeat(ramLen)}━┫\n`
    for (let i = 0; i < timingRows.length; i++) {
      const row = timingRows[i]
      timingTable += `┃ ${row.label.padEnd(labelLen)} ┃ ${row.value.padStart(valueLen)} ┃ ${row.ram.padStart(ramLen)} ┃\n`
      if (i === 4 || i === 4) {
        // Add separator after RAM total and before timing section
        timingTable += `┣━${"━".repeat(labelLen)}━╋━${"━".repeat(valueLen)}━╋━${"━".repeat(ramLen)}━┫\n`
      }
    }
    timingTable += `┗━${"━".repeat(labelLen)}━┻━${"━".repeat(valueLen)}━┻━${"━".repeat(ramLen)}━┛`
    ns.tprint(timingTable)

    if (debug) {
      ns.tprint(
        `\n[Timing Debug]\n` +
          `  Prep calculation: ${calcDuration}ms\n` +
          `  Prep execution: ${ns.tFormat(actualPrepTime)}\n` +
          `  Prep→Batch gap: ${prepToBatchGap}ms\n` +
          `  Batch config: ${batchConfigDuration}ms`
      )
    }

    // Security checks
    const minSecurity = ns.getServerMinSecurityLevel(target.serverName)
    const currentSecurity = ns.getServerSecurityLevel(target.serverName)
    const securityDiff = currentSecurity - minSecurity
    if (securityDiff > 0) {
      ns.tprint(`WARNING: ${target.serverName} security above minimum by ${securityDiff.toFixed(2)}`)
    }

    // Execute batches with timing measurement
    const batchStartTime = Date.now()
    const completedBatches = await executeBatches(ns, batchConfig, threads, timings, batches)
    if (completedBatches == 0) {
      ns.tprint("ERROR: No batches were executed. Exiting.")
      return
    }

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
