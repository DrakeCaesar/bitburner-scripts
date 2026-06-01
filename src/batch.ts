import { NS } from "@ns"
import { copyRequiredScripts, killOtherInstances, prepareServerMultiNode } from "./libraries/batchCalculations.js"
import { autoNuke } from "./autoNuke.js"
import { calculateBatchThreads, calculateBatchTimings, executeBatches } from "./libraries/batchExecution.js"
import { findBestTarget } from "./libraries/findBestTarget.js"
import { purchasePrograms, purchaseTorRouter } from "./libraries/purchasePrograms.js"
import { purchaseServers } from "./libraries/purchaseServer.js"
import { getAvailableRam, getEffectiveMaxRam } from "./libraries/ramUtils.js"
import { ScriptLogBuilder, initScriptLogTail, type ReactTableConfig, type TableLayout } from "./libraries/scriptLogUi.js"
import { getNodesForBatching } from "./libraries/serverManagement.js"

const BATCH_LAYOUT: Partial<TableLayout> = {
  tableWidthPx: 720,
}

export async function main(ns: NS) {
  const playerHackLevel = ns.args[0] ? Number(ns.args[0]) : undefined

  initScriptLogTail(ns, "Batch", BATCH_LAYOUT)
  ns.ui.resizeTail(BATCH_LAYOUT.tableWidthPx ?? 720, 640)

  const scriptLog = new ScriptLogBuilder(BATCH_LAYOUT)
  const flushLog = () => scriptLog.render(ns)
  const logMessage = (message: string) => {
    scriptLog.text(message)
    flushLog()
  }
  const prepLogOptions = {
    logMessage,
    logTable: (config: ReactTableConfig) => {
      scriptLog.table({ tableWidth: BATCH_LAYOUT.tableWidthPx, ...config })
      flushLog()
    },
  }

  await killOtherInstances(ns)

  while (true) {
    scriptLog.reset()

    const invitations = ns.singularity.checkFactionInvitations()
    for (const inv of invitations) {
      ns.singularity.joinFaction(inv)
    }

    ns.scriptKill("autoWorkFactions.js", "home")
    ns.exec("contractSolver.js", "home", 1, "solve")

    purchaseTorRouter(ns, logMessage)
    purchasePrograms(ns, logMessage)
    await autoNuke(ns, logMessage)

    const wasUpgraded = purchaseServers(ns)
    if (wasUpgraded) {
      scriptLog.text("Server was purchased/upgraded, restarting batch cycle...")
      flushLog()
    }

    const nodes = getNodesForBatching(ns)

    if (nodes.length === 0) {
      scriptLog.text("ERROR: No nodes with root access found")
      flushLog()
      await ns.sleep(1000)
      continue
    }

    for (const node of nodes) {
      ns.scriptKill("hacking/hack.js", node)
      ns.scriptKill("hacking/grow.js", node)
      ns.scriptKill("hacking/weaken.js", node)
      ns.scriptKill("libraries/shareRam.js", node)

      await copyRequiredScripts(ns, node)
    }

    const batchDelay = 5
    const ramThreshold = 1

    const totalMaxRam = nodes.reduce((sum, node) => {
      if (node === "home") {
        return sum + getAvailableRam(ns, node)
      }
      return sum + getEffectiveMaxRam(ns, node)
    }, 0)

    const nodeRamValues = nodes.map((node) => getEffectiveMaxRam(ns, node)).sort((a, b) => a - b)
    const middle = Math.floor(nodeRamValues.length / 2)
    let nodeRamLimit =
      nodeRamValues.length % 2 === 0 ? (nodeRamValues[middle - 1] + nodeRamValues[middle]) / 2 : nodeRamValues[middle]
    nodeRamLimit *= 1.0
    nodeRamLimit = Infinity

    const myCores = ns.getServer(nodes[0]).cpuCores
    const target = await findBestTarget(
      ns,
      totalMaxRam,
      nodeRamLimit,
      myCores,
      batchDelay,
      nodes,
      playerHackLevel,
      10,
      logMessage
    )
    const player = ns.getPlayer()

    scriptLog.section("Target")
    scriptLog
      .keyValueTable({
        tableWidth: BATCH_LAYOUT.tableWidthPx,
        rows: [
          { label: "Server", value: target.serverName },
          { label: "Min Node RAM", value: ns.format.ram(nodeRamLimit) },
          { label: "Nodes", value: nodes.length.toString() },
          { label: "Total RAM", value: ns.format.ram(totalMaxRam) },
          {
            label: "Hack Threshold",
            value: `${(target.hackThreshold * 100).toFixed(2)}% (${ns.format.number(target.moneyPerSecond)}/sec)`,
          },
        ],
      })
      .render(ns)

    const server = ns.getServer(target.serverName)
    server.hackDifficulty = server.minDifficulty
    server.moneyAvailable = server.moneyMax

    const debug = true

    const calcStartTime = Date.now()
    const prepEstimate = await prepareServerMultiNode(ns, nodes, target.serverName, {
      dryRun: true,
      showVerbose: debug,
      ...prepLogOptions,
    })
    const calcEndTime = Date.now()
    const calcDuration = calcEndTime - calcStartTime

    if (debug) {
      scriptLog.text(`Prep calculation took: ${calcDuration}ms`)
    }

    if (prepEstimate.totalTime > 0) {
      scriptLog.text(`Preparing ${target.serverName}... (estimated time: ${ns.format.time(prepEstimate.totalTime)})`)
    } else {
      scriptLog.text(`${target.serverName} is already prepared!`)
    }
    flushLog()

    const prepStartTime = Date.now()
    await prepareServerMultiNode(ns, nodes, target.serverName, {
      dryRun: false,
      predictedIterations: prepEstimate.iterationDetails,
      debug,
      ...prepLogOptions,
    })
    const prepEndTime = Date.now()
    const actualPrepTime = prepEndTime - prepStartTime

    const timeDiff = actualPrepTime - prepEstimate.totalTime
    const percentDiff = prepEstimate.totalTime > 0 ? ((timeDiff / prepEstimate.totalTime) * 100).toFixed(1) : "0.0"
    if (debug) {
      scriptLog.text(
        `=== TOTAL PREP TIME ===\n` +
          `Estimated: ${ns.format.time(prepEstimate.totalTime)}\n` +
          `Actual: ${ns.format.time(actualPrepTime)}\n` +
          `Difference: ${Math.abs(timeDiff).toFixed(0)}ms (${percentDiff}%)`
      )
    }

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
      logMessage,
    }

    const threads = calculateBatchThreads(ns, batchConfig)
    const timings = calculateBatchTimings(ns, server, player, batchDelay)
    const batchConfigEndTime = Date.now()
    const batchConfigDuration = batchConfigEndTime - batchConfigStartTime
    const prepToBatchGap = batchConfigStartTime - prepEndTime

    const maxBatches = Math.floor((totalMaxRam / threads.totalBatchRam) * ramThreshold)
    const batches = maxBatches

    const lastBatchOffset = (batches - 1) * timings.effectiveBatchDelay * 4
    const lastOperationFinishTime = timings.weakenTime + 2 * timings.effectiveBatchDelay + lastBatchOffset
    const predictedBatchCycleTime = lastOperationFinishTime
    const targetMaxMoney = ns.getServerMaxMoney(target.serverName)
    const moneyPerBatch = targetMaxMoney * (1 - threads.actualThreshold)
    const totalMoneyPerCycle = moneyPerBatch * batches
    const moneyPerSecond = predictedBatchCycleTime > 0 ? (totalMoneyPerCycle / predictedBatchCycleTime) * 1000 : 0

    const configRows = [
      { label: "Target Server", value: target.serverName },
      { label: "Hack Threshold", value: `${(threads.actualThreshold * 100).toFixed(2)}%` },
      { label: "Max Money", value: ns.format.number(targetMaxMoney) },
      { label: "Money/Batch", value: ns.format.number(moneyPerBatch) },
      { label: "Money/Cycle", value: ns.format.number(totalMoneyPerCycle) },
      { label: "Money/Second", value: `${ns.format.number(moneyPerSecond)}/s` },
      { label: "Parallel Batches", value: batches.toString() },
      { label: "Total Nodes", value: nodes.length.toString() },
      { label: "Total RAM", value: ns.format.ram(totalMaxRam) },
    ]

    if (threads.actualThreshold !== target.hackThreshold) {
      configRows.splice(1, 0, {
        label: "Original Threshold",
        value: `${(target.hackThreshold * 100).toFixed(2)}% (adjusted to fit)`,
      })
    }

    scriptLog.section("Batch Configuration")
    scriptLog.keyValueTable({
      tableWidth: BATCH_LAYOUT.tableWidthPx,
      rows: configRows,
      separatorAfter: [5],
    })

    scriptLog.section("Thread Distribution & Timing")
    scriptLog.threeColumnTable({
      tableWidth: BATCH_LAYOUT.tableWidthPx,
      headers: ["Operation", "Threads", "RAM"],
      rows: [
        [
          "Hack Threads",
          threads.hackThreads.toString(),
          ns.format.ram(ns.getScriptRam("/hacking/hack.js") * threads.hackThreads),
        ],
        [
          "Weaken 1 Threads",
          threads.wkn1Threads.toString(),
          ns.format.ram(ns.getScriptRam("/hacking/weaken.js") * threads.wkn1Threads),
        ],
        [
          "Grow Threads",
          threads.growThreads.toString(),
          ns.format.ram(ns.getScriptRam("/hacking/grow.js") * threads.growThreads),
        ],
        [
          "Weaken 2 Threads",
          threads.wkn2Threads.toString(),
          ns.format.ram(ns.getScriptRam("/hacking/weaken.js") * threads.wkn2Threads),
        ],
        ["Total Batch RAM", "", ns.format.ram(threads.totalBatchRam)],
        ["Weaken Time", ns.format.time(timings.weakenTime), ""],
        [
          "Batch Delay",
          ns.format.time(timings.effectiveBatchDelay),
          timings.effectiveBatchDelay !== batchDelay ? "(adjusted)" : "",
        ],
        ["Batch Interval", ns.format.time(timings.effectiveBatchDelay * 4), ""],
        ["Cycle Time", ns.format.time(predictedBatchCycleTime), ""],
      ],
      separatorAfter: [4],
      align: ["left", "right", "right"],
    })

    if (debug) {
      scriptLog.text(
        `[Timing Debug]\n` +
          `  Prep calculation: ${calcDuration}ms\n` +
          `  Prep execution: ${ns.format.time(actualPrepTime)}\n` +
          `  Prep->Batch gap: ${prepToBatchGap}ms\n` +
          `  Batch config: ${batchConfigDuration}ms`
      )
    }

    const minSecurity = ns.getServerMinSecurityLevel(target.serverName)
    const currentSecurity = ns.getServerSecurityLevel(target.serverName)
    const securityDiff = currentSecurity - minSecurity
    if (securityDiff > 0) {
      scriptLog.text(`WARNING: ${target.serverName} security above minimum by ${securityDiff.toFixed(2)}`)
    }

    flushLog()

    const batchStartTime = Date.now()
    const completedBatches = await executeBatches(ns, batchConfig, threads, timings, batches)
    if (completedBatches == 0) {
      scriptLog.text("ERROR: No batches were executed. Exiting.")
      flushLog()
      await ns.sleep(1000)
      continue
    }

    const batchEndTime = Date.now()
    const actualBatchCycleTime = batchEndTime - batchStartTime

    const finalSecurity = ns.getServerSecurityLevel(target.serverName)
    const currentMoney = ns.getServerMoneyAvailable(target.serverName)
    const maxMoney = ns.getServerMaxMoney(target.serverName)
    const moneyPercent = (currentMoney / maxMoney) * 100

    const batchTimeDiff = actualBatchCycleTime - predictedBatchCycleTime
    const batchPercentDiff =
      predictedBatchCycleTime > 0 ? ((batchTimeDiff / predictedBatchCycleTime) * 100).toFixed(1) : "0.0"

    scriptLog.section("Batch Execution Results")
    scriptLog
      .keyValueTable({
        tableWidth: BATCH_LAYOUT.tableWidthPx,
        rows: [
          { label: "Status", value: "All batches completed" },
          {
            label: "Security",
            value: `${finalSecurity.toFixed(2)} / ${minSecurity.toFixed(2)} (+${(finalSecurity - minSecurity).toFixed(2)})`,
          },
          {
            label: "Money",
            value: `${moneyPercent.toFixed(2)}% (${ns.format.number(currentMoney)} / ${ns.format.number(maxMoney)})`,
          },
        ],
      })

    if (debug) {
      scriptLog.text(
        `=== BATCH CYCLE TIME ===\n` +
          `Predicted: ${ns.format.time(predictedBatchCycleTime)}\n` +
          `Actual: ${ns.format.time(actualBatchCycleTime)}\n` +
          `Difference: ${Math.abs(batchTimeDiff).toFixed(0)}ms (${batchPercentDiff}%)`
      )
    }

    flushLog()
  }
}
