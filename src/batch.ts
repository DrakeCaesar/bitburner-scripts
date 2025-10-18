import { NS } from "@ns"
import { copyRequiredScripts, killOtherInstances, prepareServerMultiNode } from "./libraries/batchCalculations.js"
// import { initBatchVisualiser, logBatchOperation } from "./batchVisualiser.js"
import { autoNuke } from "./autoNuke.js"
import { calculateBatchThreads, calculateBatchTimings, executeBatches } from "./libraries/batchExecution.js"
import { findBestTarget } from "./libraries/findBestTarget.js"
import { purchasePrograms, purchaseTorRouter } from "./libraries/purchasePrograms.js"
import { purchaseServers } from "./libraries/purchaseServer.js"
import { getEffectiveMaxRam } from "./libraries/ramUtils.js"
import { getNodesForBatching } from "./libraries/serverManagement.js"
import { buildKeyValueTable, buildThreeColumnTable } from "./libraries/tableBuilder.js"

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
    const wasUpgraded = purchaseServers(ns)
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

    const batchDelay = 5
    const ramThreshold = 1

    // Calculate total RAM across all nodes and find minimum node RAM
    // For home, subtract used RAM since this script is running there
    const totalMaxRam = nodes.reduce((sum, node) => {
      if (node === "home") {
        return sum + (getEffectiveMaxRam(ns, node) - ns.getServerUsedRam(node))
      }
      return sum + getEffectiveMaxRam(ns, node)
    }, 0)

    // Use median of available servers
    const nodeRamValues = nodes.map((node) => getEffectiveMaxRam(ns, node)).sort((a, b) => a - b)
    const middle = Math.floor(nodeRamValues.length / 2)
    let nodeRamLimit =
      nodeRamValues.length % 2 === 0 ? (nodeRamValues[middle - 1] + nodeRamValues[middle]) / 2 : nodeRamValues[middle]
    nodeRamLimit *= 1.0 // DEBUG: Adjust to test different scenarios
    nodeRamLimit = Infinity

    ns.tprint(`Minimum node RAM: ${ns.formatRam(nodeRamLimit)}`)
    const myCores = ns.getServer(nodes[0]).cpuCores

    // Find best target automatically (constrained by smallest node RAM)
    const target = await findBestTarget(ns, totalMaxRam, nodeRamLimit, myCores, batchDelay, nodes, playerHackLevel, 10)
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
    const prepEstimate = await prepareServerMultiNode(ns, nodes, target.serverName, {
      dryRun: true,
      showVerbose: debug,
    })
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
    await prepareServerMultiNode(ns, nodes, target.serverName, {
      dryRun: false,
      predictedIterations: prepEstimate.iterationDetails,
      debug,
    })
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

    const configTable = buildKeyValueTable({
      title: "Batch Configuration",
      rows: configRows,
      separatorAfter: [5], // Separator after Money/Second
    })
    ns.tprint(configTable)

    // Table 2: Thread Distribution & Timing
    const timingTable = buildThreeColumnTable({
      title: "Thread Distribution & Timing",
      headers: ["Operation", "Threads", "RAM"],
      rows: [
        [
          "Hack Threads",
          threads.hackThreads.toString(),
          ns.formatRam(ns.getScriptRam("/hacking/hack.js") * threads.hackThreads),
        ],
        [
          "Weaken 1 Threads",
          threads.wkn1Threads.toString(),
          ns.formatRam(ns.getScriptRam("/hacking/weaken.js") * threads.wkn1Threads),
        ],
        [
          "Grow Threads",
          threads.growThreads.toString(),
          ns.formatRam(ns.getScriptRam("/hacking/grow.js") * threads.growThreads),
        ],
        [
          "Weaken 2 Threads",
          threads.wkn2Threads.toString(),
          ns.formatRam(ns.getScriptRam("/hacking/weaken.js") * threads.wkn2Threads),
        ],
        ["Total Batch RAM", "", ns.formatRam(threads.totalBatchRam)],
        ["Weaken Time", ns.tFormat(timings.weakenTime), ""],
        [
          "Batch Delay",
          ns.tFormat(timings.effectiveBatchDelay),
          timings.effectiveBatchDelay !== batchDelay ? "(adjusted)" : "",
        ],
        ["Batch Interval", ns.tFormat(timings.effectiveBatchDelay * 4), ""],
        ["Cycle Time", ns.tFormat(predictedBatchCycleTime), ""],
      ],
      separatorAfter: [4], // Separator after Total Batch RAM
      align: ["left", "right", "right"],
    })
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
