import { NS } from "@ns"
import { copyRequiredScripts, killOtherInstances, prepareServerMultiNode } from "./libraries/batchCalculations.js"
import { autoNuke } from "./autoNuke.js"
import { calculateBatchThreads, calculateBatchTimings, executeBatches } from "./libraries/batchExecution.js"
import { buildProfitabilityTableConfig, findBestTarget } from "./libraries/findBestTarget.js"
import { purchasePrograms, purchaseTorRouter } from "./libraries/purchasePrograms.js"
import { purchaseServers } from "./libraries/purchaseServer.js"
import { sumBatchWorkerRam } from "./libraries/ramUtils.js"
import {
  TabbedScriptLogBuilder,
  initScriptLogTail,
  type ReactTableConfig,
  type TabDefinition,
  type TableLayout,
} from "./libraries/scriptLogUi.js"
import {
  getNodesForBatching,
  killHackingScriptsForTarget,
  parseBatchArgs,
} from "./libraries/serverManagement.js"
import { joinWorthyFactionInvitations } from "./libraries/factionInvites.js"

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
  const batchOptions = parseBatchArgs(ns.args)
  const playerHackLevel = batchOptions.playerHackLevel

  initScriptLogTail(ns, "Batch", BATCH_LAYOUT)

  const tabbedLog = new TabbedScriptLogBuilder(BATCH_TABS, BATCH_LAYOUT)
  const renderLog = () => tabbedLog.render(ns)

  const logSetup = (message: string) => {
    tabbedLog.tab("setup").text(message)
  }

  // Append only during prep sim — re-render at phase boundaries so React tab clicks are not reset every line
  const prepLogOptions = {
    logMessage: (message: string) => {
      tabbedLog.tab("prep").text(message)
    },
    logTable: (config: ReactTableConfig) => {
      tabbedLog.tab("prep").table(config)
    },
  }

  const logBatch = (message: string) => {
    tabbedLog.tab("batch").text(message)
  }

  await killOtherInstances(ns)

  while (true) {
    tabbedLog.clearPanelsExcept(["results", "batch"])

    const joinedFactions = joinWorthyFactionInvitations(ns)
    if (joinedFactions.length > 0) {
      tabbedLog.tab("setup").text(`Joined factions: ${joinedFactions.join(", ")}`)
    }

    // ns.scriptKill("autoWorkFactions.js", "home") — batch does not start it; leave faction work running if launched elsewhere
    ns.scriptKill("contractSolver.js", "home")
    ns.exec("contractSolver.js", "home", 1, "solve", "quiet")

    purchaseTorRouter(ns, logSetup)
    purchasePrograms(ns, logSetup)
    await autoNuke(ns, logSetup)
    await renderLog()

    const wasUpgraded = purchaseServers(ns)
    if (wasUpgraded) {
      tabbedLog.tab("setup").text("Server was purchased/upgraded, restarting batch cycle...")
      await renderLog()
    }

    const nodes = getNodesForBatching(ns, batchOptions)

    if (nodes.length === 0) {
      tabbedLog.tab("setup").text("ERROR: No nodes with root access found")
      await renderLog()
      await ns.sleep(1000)
      continue
    }

    for (const node of nodes) {
      ns.scriptKill("libraries/shareRam.js", node)
      await copyRequiredScripts(ns, node)
    }

    const batchDelay = 5
    const ramThreshold = 1
    const nodeRamLimit = Infinity

    const myCores = ns.getServer(nodes[0]).cpuCores
    const target = await findBestTarget(
      ns,
      sumBatchWorkerRam(ns, nodes),
      nodeRamLimit,
      myCores,
      batchDelay,
      nodes,
      playerHackLevel,
      10
    )
    killHackingScriptsForTarget(ns, nodes, target.serverName)
    let totalMaxRam = sumBatchWorkerRam(ns, nodes)
    const player = ns.getPlayer()

    const workerModeLabel =
      batchOptions.workers === "auto"
        ? batchOptions.excludeHacknet
          ? "auto (no hacknet)"
          : "auto"
        : batchOptions.excludeHacknet
          ? `${batchOptions.workers} (no hacknet)`
          : batchOptions.workers

    tabbedLog.tab("targets").keyValueTable({
      title: "Batch Nodes",
      rows: [
        { label: "Workers", value: workerModeLabel },
        { label: "Worker Nodes", value: nodes.length.toString() },
        { label: "Total RAM", value: ns.format.ram(totalMaxRam) },
        { label: "Min Node RAM", value: ns.format.ram(nodeRamLimit) },
        ...(playerHackLevel != null ? [{ label: "Hack Level Cap", value: String(playerHackLevel) }] : []),
      ],
    })
    tabbedLog.tab("targets").table({
      ...buildProfitabilityTableConfig(ns, target.servers),
      selectedRowIndex: 0,
    })
    await renderLog()

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
      tabbedLog.tab("prep").text(`Prep calculation took: ${calcDuration}ms`)
    }

    if (prepEstimate.totalTime > 0) {
      tabbedLog.tab("prep").text(`Preparing ${target.serverName}... (estimated time: ${ns.format.time(prepEstimate.totalTime)})`)
    } else {
      tabbedLog.tab("prep").text(`${target.serverName} is already prepared!`)
    }
    await renderLog()

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
    await renderLog()

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

    tabbedLog.tab("batch").reset().keyValueTable({
      title: "Batch Configuration",
      rows: configRows,
      separatorAfter: [5],
    })
    tabbedLog.tab("batch").threeColumnTable({
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

    await renderLog()

    const batchStartTime = Date.now()
    const { completeBatches, actualHackIncome } = await executeBatches(ns, batchConfig, threads, timings, batches)
    if (completeBatches == 0) {
      tabbedLog.tab("results").reset().text("ERROR: No batches were executed. Exiting.")
      await renderLog()
      await ns.sleep(1000)
      continue
    }

    const batchEndTime = Date.now()
    const actualBatchCycleTime = batchEndTime - batchStartTime
    const actualCycleMoney = actualHackIncome

    const predictedCycleMoney = moneyPerBatch * completeBatches
    const moneyDelta = actualCycleMoney - predictedCycleMoney
    const moneyPercentDiff =
      predictedCycleMoney > 0 ? ((moneyDelta / predictedCycleMoney) * 100).toFixed(1) : "n/a"

    const predictedMoneyPerSecond =
      predictedBatchCycleTime > 0 ? (predictedCycleMoney / predictedBatchCycleTime) * 1000 : 0
    const actualMoneyPerSecond = actualBatchCycleTime > 0 ? (actualCycleMoney / actualBatchCycleTime) * 1000 : 0
    const moneyPerSecondDelta = actualMoneyPerSecond - predictedMoneyPerSecond
    const moneyPerSecondPercentDiff =
      predictedMoneyPerSecond > 0 ? ((moneyPerSecondDelta / predictedMoneyPerSecond) * 100).toFixed(1) : "n/a"

    const batchTimeDiff = actualBatchCycleTime - predictedBatchCycleTime
    const batchPercentDiff =
      predictedBatchCycleTime > 0 ? ((batchTimeDiff / predictedBatchCycleTime) * 100).toFixed(1) : "n/a"

    const finalSecurity = ns.getServerSecurityLevel(target.serverName)
    const currentMoney = ns.getServerMoneyAvailable(target.serverName)
    const maxMoney = ns.getServerMaxMoney(target.serverName)
    const moneyPercent = (currentMoney / maxMoney) * 100

    tabbedLog.tab("results").reset().keyValueTable({
      title: "Last Cycle — Predicted vs Actual",
      rows: [
        { label: "Batches", value: `${completeBatches} / ${batches} planned` },
        { label: "Cycle time", value: `${ns.format.time(predictedBatchCycleTime)} / ${ns.format.time(actualBatchCycleTime)}` },
        { label: "Cycle time Δ", value: `${batchTimeDiff >= 0 ? "+" : ""}${ns.format.time(Math.abs(batchTimeDiff))} (${batchPercentDiff}%)` },
        {
          label: "Hack $ / cycle",
          value: `${ns.format.number(predictedCycleMoney)} / ${ns.format.number(actualCycleMoney)}`,
        },
        {
          label: "Hack $ Δ",
          value: `${moneyDelta >= 0 ? "+" : ""}${ns.format.number(moneyDelta)} (${moneyPercentDiff}%)`,
        },
        {
          label: "$ / second",
          value: `${ns.format.number(predictedMoneyPerSecond)}/s / ${ns.format.number(actualMoneyPerSecond)}/s`,
        },
        {
          label: "$ / second Δ",
          value: `${moneyPerSecondDelta >= 0 ? "+" : ""}${ns.format.number(moneyPerSecondDelta)}/s (${moneyPerSecondPercentDiff}%)`,
        },
      ],
      separatorAfter: [6],
    })
    tabbedLog.tab("results").keyValueTable({
      title: "Target State After Cycle",
      rows: [
        { label: "Status", value: "All batches completed" },
        {
          label: "Security",
          value: `${finalSecurity.toFixed(2)} / ${minSecurity.toFixed(2)} (+${(finalSecurity - minSecurity).toFixed(2)})`,
        },
        {
          label: "Server money",
          value: `${moneyPercent.toFixed(2)}% (${ns.format.number(currentMoney)} / ${ns.format.number(maxMoney)})`,
        },
      ],
    })

    if (debug) {
      const walletDelta = ns.getPlayer().money
      tabbedLog.tab("results").text(
        `[Debug] Hack income from port sum: ${ns.format.number(actualHackIncome)}\n` +
          `(Wallet may differ if other income ran during the cycle.)`
      )
    }

    await renderLog()
  }
}
