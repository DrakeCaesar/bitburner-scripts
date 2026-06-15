import { NS } from "@ns"
import { killOtherInstances } from "./libraries/batchCalculations.js"
import { formatGameTimeMs } from "./libraries/format.js"
import {
  ActiveGrindPlan,
  buildStrategyTimelineRows,
  buildValidationSnapshot,
  buildValidationTimelineRows,
  copyGrindScripts,
  countActiveGrindThreads,
  deployGrowGrind,
  deployHackGrind,
  deployWeakenGrind,
  ensureTargetPrepared,
  GrindActualSample,
  GRIND_TIMELINE_STEP_MS,
  grindNeedsRedeploy,
  HackGrindMode,
  killGrindScripts,
  parseGrindArgs,
  resolveGrindPlan,
  simResultForMode,
  totalWorkerRamGb,
} from "./libraries/hackGrind.js"
import {
  createTabbedTailLog,
  openTailLog,
  renderTabbedTailLog,
  sleepUntilTabLayoutRefresh,
  type ReactTableConfig,
  type TabDefinition,
} from "./libraries/scriptLogUiLayout.js"
import { getNodesForBatching } from "./libraries/serverManagement.js"

const REDEPLOY_CHECK_MS = 5_000
const AUTO_REPLAN_MS = 60_000

const GRIND_TABS: TabDefinition[] = [
  { id: "status", label: "Status" },
  { id: "strategies", label: "Strategies" },
  { id: "validation", label: "Validation" },
  { id: "leaderboard", label: "Leaderboard" },
]

interface GrindRunTracking {
  deployedAt: number
  startXp: number
  startLevel: number
  mode: ActiveGrindPlan["mode"]
  target: string
  actualSamples: GrindActualSample[]
  lastSampleElapsedMs: number
}

function modeLabel(mode: HackGrindMode): string {
  if (mode === "weaken") return "Weaken spam"
  if (mode === "hack") return "Hack burst"
  if (mode === "grow") return "Grow spam"
  return "Auto"
}

function fmtTime(ns: NS, ms: number): string {
  return formatGameTimeMs(ms, (value) => ns.format.time(value))
}

function recordActualSample(tracking: GrindRunTracking, playerXp: number, playerLevel: number, now: number): void {
  const elapsedMs = now - tracking.deployedAt
  const stepElapsed = Math.floor(elapsedMs / GRIND_TIMELINE_STEP_MS) * GRIND_TIMELINE_STEP_MS
  if (stepElapsed <= tracking.lastSampleElapsedMs) return

  const totalXp = playerXp - tracking.startXp
  tracking.actualSamples.push({
    elapsedMs: stepElapsed,
    totalXp,
    level: playerLevel,
    xpPerSecondAvg: stepElapsed > 0 ? (totalXp / stepElapsed) * 1000 : 0,
  })
  tracking.lastSampleElapsedMs = stepElapsed
}

function buildStrategySummaryTable(ns: NS, comparison: ActiveGrindPlan["comparison"], activeMode: string): ReactTableConfig {
  const modes = ["weaken", "hack", "grow"] as const
  let bestIdx = 0
  let bestXp = -1
  modes.forEach((mode, idx) => {
    const xp = comparison[mode].xpPerSecond
    if (xp > bestXp) {
      bestXp = xp
      bestIdx = idx
    }
  })

  const highlightCells = new Set<string>()
  modes.forEach((mode, rowIdx) => {
    if (mode === activeMode) highlightCells.add(`${rowIdx},0`)
    if (rowIdx === bestIdx) highlightCells.add(`${rowIdx},2`)
  })

  return {
    title: `${comparison.hostname} strategy summary (120s sim)`,
    columns: [
      { header: "Mode", align: "left" },
      { header: "Threads H/G/W", align: "right" },
      { header: "XP / sec", align: "right" },
      { header: "Total XP", align: "right" },
      { header: "Levels", align: "right" },
      { header: "Sim time", align: "right" },
    ],
    rows: modes.map((mode) => {
      const sim = comparison[mode]
      const dep = sim.deployment
      return [
        mode,
        `${dep.hack}/${dep.grow}/${dep.weaken}`,
        `${ns.format.number(sim.xpPerSecond)}/s`,
        ns.format.number(sim.totalXp),
        sim.endLevel > sim.startLevel ? `+${sim.endLevel - sim.startLevel}` : "0",
        fmtTime(ns, sim.simDurationMs),
      ]
    }),
    highlightCells,
    activeHeaderColumns: new Set([2]),
  }
}

function buildStrategyTimelineTable(ns: NS, comparison: ActiveGrindPlan["comparison"]): ReactTableConfig {
  const rows = buildStrategyTimelineRows(comparison)
  return {
    title: "Cumulative XP over simulated time (all strategies)",
    columns: [
      { header: "Elapsed", align: "right" },
      { header: "Weaken XP", align: "right" },
      { header: "Hack XP", align: "right" },
      { header: "Grow XP", align: "right" },
      { header: "W Lvl", align: "right" },
      { header: "H Lvl", align: "right" },
      { header: "G Lvl", align: "right" },
    ],
    rows: rows.map((row) => [
      fmtTime(ns, row.elapsedMs),
      ns.format.number(row.weakenXp),
      ns.format.number(row.hackXp),
      ns.format.number(row.growXp),
      String(row.weakenLevel),
      String(row.hackLevel),
      String(row.growLevel),
    ]),
  }
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("sleep")
  const options = parseGrindArgs(ns.args)
  await killOtherInstances(ns)

  openTailLog(ns, `Hack Grind (${options.mode})`)

  const tabbedLog = createTabbedTailLog(GRIND_TABS)
  const renderLog = () => renderTabbedTailLog(ns, tabbedLog)

  const nodes = getNodesForBatching(ns, {
    workers: options.workers,
    excludeHacknet: options.excludeHacknet,
  })

  if (nodes.length === 0) {
    ns.tprint("ERROR: No worker nodes found")
    return
  }

  copyGrindScripts(ns, nodes)
  ns.atExit(() => {
    killGrindScripts(ns, nodes)
  })

  let activePlan: ActiveGrindPlan | null = null
  let deployedPlan: ActiveGrindPlan | null = null
  let runTracking: GrindRunTracking | null = null
  let lastAutoReplan = Date.now()
  const cores = ns.getServer(nodes[0]).cpuCores

  while (true) {
    await tabbedLog.refreshLayoutIfPending(ns)
    const totalRam = totalWorkerRamGb(ns, nodes)
    const now = Date.now()
    const shouldReplanAuto = options.mode === "auto" && now - lastAutoReplan >= AUTO_REPLAN_MS
    const shouldResolvePlan = activePlan == null || shouldReplanAuto

    if (shouldResolvePlan) {
      activePlan = resolveGrindPlan(ns, options, nodes, cores)
      if (shouldReplanAuto) lastAutoReplan = now
    }

    const plan = activePlan

    if (plan == null) {
      tabbedLog.clearPanelsExcept([])
      tabbedLog.tab("status").text("No hackable grind targets found. Nuke more servers or raise hacking level.")
      await renderLog()
      await sleepUntilTabLayoutRefresh(ns, tabbedLog, REDEPLOY_CHECK_MS)
      continue
    }

    const planChanged =
      deployedPlan == null || plan.mode !== deployedPlan.mode || plan.target !== deployedPlan.target
    const needsDeploy = planChanged || grindNeedsRedeploy(ns, nodes, plan, cores)

    if (needsDeploy) {
      killGrindScripts(ns, nodes)
      await ensureTargetPrepared(ns, nodes, plan.target, plan.mode)

      let launched = 0
      if (plan.mode === "weaken") {
        launched = deployWeakenGrind(ns, nodes, plan.target, cores)
      } else if (plan.mode === "grow") {
        launched = deployGrowGrind(ns, nodes, plan.target, cores)
      } else {
        launched = deployHackGrind(ns, nodes, plan.target, cores)
      }

      if (launched === 0) {
        tabbedLog.clearPanelsExcept([])
        tabbedLog.tab("status").text(`Failed to launch grind on ${plan.target} (no free RAM on workers).`)
        await renderLog()
        await sleepUntilTabLayoutRefresh(ns, tabbedLog, REDEPLOY_CHECK_MS)
        continue
      }

      deployedPlan = plan
      const player = ns.getPlayer()
      runTracking = {
        deployedAt: now,
        startXp: player.exp.hacking,
        startLevel: player.skills.hacking,
        mode: plan.mode,
        target: plan.target,
        actualSamples: [{ elapsedMs: 0, totalXp: 0, level: player.skills.hacking, xpPerSecondAvg: 0 }],
        lastSampleElapsedMs: 0,
      }
    }

    const player = ns.getPlayer()
    if (runTracking) {
      recordActualSample(runTracking, player.exp.hacking, player.skills.hacking, now)
    }

    const active = countActiveGrindThreads(ns, nodes, plan.target)
    const sim = simResultForMode(plan.comparison, plan.mode)
    const comparison = plan.comparison

    tabbedLog.clearPanelsExcept([])

    tabbedLog.tab("status").keyValueTable({
      title: "Hack Grind",
      rows: [
        { label: "Mode", value: `${plan.mode} (${modeLabel(plan.mode)})` },
        { label: "Target", value: plan.target },
        { label: "Sim XP / sec", value: `${ns.format.number(plan.simulatedXpPerSecond)}/s` },
        { label: "Hack Level", value: String(player.skills.hacking) },
        { label: "Hack XP", value: ns.format.number(player.exp.hacking) },
        { label: "Worker RAM", value: ns.format.ram(totalRam) },
        { label: "Workers", value: String(nodes.length) },
      ],
    })

    tabbedLog.tab("status").keyValueTable({
      title: "Active Deployment",
      rows: [
        { label: "Hack threads", value: String(active.hack) },
        { label: "Grow threads", value: String(active.grow) },
        { label: "Weaken threads", value: String(active.weaken) },
        { label: "Planned H/G/W", value: `${sim.deployment.hack}/${sim.deployment.grow}/${sim.deployment.weaken}` },
      ],
    })

    tabbedLog.tab("strategies").table(buildStrategySummaryTable(ns, comparison, plan.mode))
    tabbedLog.tab("strategies").table(buildStrategyTimelineTable(ns, comparison))

    if (runTracking) {
      const elapsedMs = now - runTracking.deployedAt
      const predicted = simResultForMode(comparison, runTracking.mode)
      const snapshot = buildValidationSnapshot(
        predicted,
        elapsedMs,
        runTracking.startXp,
        runTracking.startLevel,
        player.exp.hacking,
        player.skills.hacking
      )

      tabbedLog.tab("validation").keyValueTable({
        title: `${runTracking.mode} on ${runTracking.target} — predicted vs actual`,
        rows: [
          { label: "Elapsed", value: fmtTime(ns, elapsedMs) },
          { label: "XP / sec", value: `${ns.format.number(snapshot.predictedXpPerSecond)}/s / ${ns.format.number(snapshot.actualXpPerSecond)}/s` },
          {
            label: "XP / sec delta",
            value: `${snapshot.actualXpPerSecond - snapshot.predictedXpPerSecond >= 0 ? "+" : ""}${ns.format.number(snapshot.actualXpPerSecond - snapshot.predictedXpPerSecond)}/s (${snapshot.xpRatePercentDiff}%)`,
          },
          {
            label: "Total XP",
            value: `${ns.format.number(snapshot.predictedXp)} / ${ns.format.number(snapshot.actualXp)}`,
          },
          {
            label: "Total XP delta",
            value: `${snapshot.xpDelta >= 0 ? "+" : ""}${ns.format.number(snapshot.xpDelta)} (${snapshot.xpTotalPercentDiff}%)`,
          },
          {
            label: "Level",
            value: `${snapshot.predictedLevel} / ${snapshot.actualLevel}`,
          },
          {
            label: "Level delta",
            value: snapshot.levelDelta >= 0 ? `+${snapshot.levelDelta}` : String(snapshot.levelDelta),
          },
        ],
        separatorAfter: [5],
      })

      const validationRows = buildValidationTimelineRows(predicted, runTracking.actualSamples, runTracking.startXp, runTracking.startLevel)
      tabbedLog.tab("validation").table({
        title: "XP gain over time (predicted vs actual)",
        columns: [
          { header: "Elapsed", align: "right" },
          { header: "Pred XP", align: "right" },
          { header: "Actual XP", align: "right" },
          { header: "XP Delta", align: "right" },
          { header: "Pred Lvl", align: "right" },
          { header: "Actual Lvl", align: "right" },
        ],
        rows: validationRows.map((row) => [
          fmtTime(ns, row.elapsedMs),
          ns.format.number(row.predictedXp),
          ns.format.number(row.actualXp),
          `${row.xpDelta >= 0 ? "+" : ""}${ns.format.number(row.xpDelta)}`,
          String(row.predictedLevel),
          String(row.actualLevel),
        ]),
      })
    } else {
      tabbedLog.tab("validation").text("Deploy a grind run to compare predicted vs actual XP gains.")
    }

    tabbedLog.tab("leaderboard").table({
      title: "Top targets (simulated XP/s, 120s window)",
      columns: [
        { header: "Server", align: "left", minWidth: 14 },
        { header: "Lvl", align: "right" },
        { header: "Wkn XP/s", align: "right" },
        { header: "Hack XP/s", align: "right" },
        { header: "Grow XP/s", align: "right" },
      ],
      rows: plan.leaderboard.map((row) => [
        row.hostname,
        String(row.hackLevel),
        ns.format.number(row.weaken.xpPerSecond),
        ns.format.number(row.hack.xpPerSecond),
        ns.format.number(row.grow.xpPerSecond),
      ]),
      highlightCells: new Set(
        plan.leaderboard
          .map((row, idx) => (row.hostname === plan.target ? `${idx},0` : null))
          .filter((cell): cell is string => cell != null)
      ),
    })

    tabbedLog.tab("leaderboard").text(
      "Args: weaken | hack | grow | auto, optional target, home | nuked | purchased, no-hacknet"
    )

    await renderLog()
    await sleepUntilTabLayoutRefresh(ns, tabbedLog, REDEPLOY_CHECK_MS)
  }
}
