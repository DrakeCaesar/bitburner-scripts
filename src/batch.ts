import { NS } from "@ns"
import { copyRequiredScripts, killOtherInstances, prepareServerMultiNode } from "./libraries/batchCalculations.js"
import { autoNuke } from "./autoNuke.js"
import { calculateBatchThreads, calculateBatchTimings, executeBatches } from "./libraries/batchExecution.js"
import { buildProfitabilityTableConfig, findBestTarget } from "./libraries/findBestTarget.js"
import { purchasePrograms, purchaseTorRouter } from "./libraries/purchasePrograms.js"
import { purchaseServers } from "./libraries/purchaseServer.js"
import { getAvailableRam, getEffectiveMaxRam } from "./libraries/ramUtils.js"
import {
  TabbedScriptLogBuilder,
  initScriptLogTail,
  type ReactTableConfig,
  type TabDefinition,
  type TableLayout,
} from "./libraries/scriptLogUi.js"
import { getNodesForBatching } from "./libraries/serverManagement.js"

const BATCH_LAYOUT: Partial<TableLayout> = {
  tableWidthPx: 720,
  fontSizePx: 14,
}

const BATCH_TABS: TabDefinition[] = [
  { id: "setup", label: "Setup" },
  { id: "targets", label: "Targets" },
  { id: "prep", label: "Prep" },
  { id: "batch", label: "Batch" },
  { id: "results", label: "Results" },
]

export async function main(ns: NS) {
  const playerHackLevel = ns.args[0] ? Number(ns.args[0]) : undefined

  initScriptLogTail(ns, "Batch", BATCH_LAYOUT)
  ns.ui.resizeTail(BATCH_LAYOUT.tableWidthPx ?? 720, 640)

  const tabbedLog = new TabbedScriptLogBuilder(BATCH_TABS, BATCH_LAYOUT)
  const renderLog = () => tabbedLog.render(ns)

  const logSetup = (message: string) => {
    tabbedLog.setActiveTab("setup").tab("setup").text(message)
    renderLog()
  }

  // Append only during prep sim — re-render at phase boundaries so React tab clicks are not reset every line
  const prepLogOptions = {
    logMessage: (message: string) => {
      tabbedLog.setActiveTab("prep").tab("prep").text(message)
    },
    logTable: (config: ReactTableConfig) => {
      tabbedLog.setActiveTab("prep").tab("prep").table({ tableWidth: BATCH_LAYOUT.tableWidthPx, ...config })
    },
  }

  const logBatch = (message: string) => {
    tabbedLog.setActiveTab("batch").tab("batch").text(message)
    renderLog()
  }

  await killOtherInstances(ns)

  while (true) {
    tabbedLog.reset()

    const invitations = ns.singularity.checkFactionInvitations()
    for (const inv of invitations) {
      ns.singularity.joinFaction(inv)
    }

    ns.scriptKill("autoWorkFactions.js", "home")
    ns.exec("contractSolver.js", "home", 1, "solve")

    tabbedLog.setActiveTab("setup")
    purchaseTorRouter(ns, logSetup)
    purchasePrograms(ns, logSetup)
    await autoNuke(ns, logSetup)

    const wasUpgraded = purchaseServers(ns)
    if (wasUpgraded) {
      tabbedLog.tab("setup").text("Server was purchased/upgraded, restarting batch cycle...")
      renderLog()
    }

    const nodes = getNodesForBatching(ns)

    if (nodes.length === 0) {
      tabbedLog.tab("setup").text("ERROR: No nodes with root access found")
      renderLog()
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
      10
    )
    const player = ns.getPlayer()

    tabbedLog.setActiveTab("targets")
    tabbedLog.tab("targets").keyValueTable({
      tableWidth: BATCH_LAYOUT.tableWidthPx,
      title: "Batch Nodes",
      rows: [
        { label: "Worker Nodes", value: nodes.length.toString() },
        { label: "Total RAM", value: ns.format.ram(totalMaxRam) },
        { label: "Min Node RAM", value: ns.format.ram(nodeRamLimit) },
      ],
    })
    tabbedLog.tab("targets").table({
      ...buildProfitabilityTableConfig(ns, target.servers),
      tableWidth: BATCH_LAYOUT.tableWidthPx,
      selectedRowIndex: 0,
    })
    renderLog()

    const server = ns.getServer(target.serverName)
    server.hackDifficulty = server.minDifficulty
    server.moneyAvailable = server.moneyMax

    const debug = true

    tabbedLog.setActiveTab("prep")
    const calcStartTime = Date.now()
    const prepEstimate = await prepareServerMultiNode(ns, nodes, target.serverName, {
      dryRun: true,
      showVerbose: debug,
      ...prepLogOptions,
    })
    const calcEndTime = Date.now()
    const calcDuration = calcEndTime - calcStartTime

    if (debug) {
      tabbedLog.tab("prep").text(`Prep calculation took: ${calcDuration}ms`)
    }

    if (prepEstimate.totalTime > 0) {
      tabbedLog.tab("prep").text(`Preparing ${target.serverName}... (estimated time: ${ns.format.time(prepEstimate.totalTime)})`)
    } else {
      tabbedLog.tab("prep").text(`${target.serverName} is already prepared!`)
    }
    renderLog()

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
      tabbedLog.tab("prep").text(
        `=== TOTAL PREP TIME ===\n` +
          `Estimated: ${ns.format.time(prepEstimate.totalTime)}\n` +
          `Actual: ${ns.format.time(actualPrepTime)}\n` +
          `Difference: ${Math.abs(timeDiff).toFixed(0)}ms (${percentDiff}%)`
      )
    }
    renderLog()

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
      logMessage: logBatch,
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

    tabbedLog.setActiveTab("batch")
    tabbedLog.tab("batch").keyValueTable({
      tableWidth: BATCH_LAYOUT.tableWidthPx,
      title: "Batch Configuration",
      rows: configRows,
      separatorAfter: [5],
    })
    tabbedLog.tab("batch").threeColumnTable({
      tableWidth: BATCH_LAYOUT.tableWidthPx,
      title: "Thread Distribution & Timing",
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
      tabbedLog.tab("batch").text(
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
      tabbedLog.tab("batch").text(`WARNING: ${target.serverName} security above minimum by ${securityDiff.toFixed(2)}`)
    }

    renderLog()

    const batchStartTime = Date.now()
    const completedBatches = await executeBatches(ns, batchConfig, threads, timings, batches)
    if (completedBatches == 0) {
      tabbedLog.setActiveTab("results").tab("results").text("ERROR: No batches were executed. Exiting.")
      renderLog()
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

    tabbedLog.setActiveTab("results")
    tabbedLog.tab("results").keyValueTable({
      tableWidth: BATCH_LAYOUT.tableWidthPx,
      title: "Batch Execution Results",
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
      tabbedLog.tab("results").text(
        `=== BATCH CYCLE TIME ===\n` +
          `Predicted: ${ns.format.time(predictedBatchCycleTime)}\n` +
          `Actual: ${ns.format.time(actualBatchCycleTime)}\n` +
          `Difference: ${Math.abs(batchTimeDiff).toFixed(0)}ms (${batchPercentDiff}%)`
      )
    }

    renderLog()
  }
}
