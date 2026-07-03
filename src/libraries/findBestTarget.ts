import { NS, Player, Server } from "@ns"
import {
  calculateGrowThreads,
  calculateHackThreads,
  calculateWeakThreads,
  growServerInstance,
  hackServerInstance,
  prepareServerMultiNode,
  wkn1ServerInstance,
  wkn2ServerInstance,
} from "./batchCalculations.js"
import { calculateBatchTimings } from "./batchExecution.js"
import { crawl } from "./crawl.js"
import { formatGameTimeMs } from "./format.js"
import { distributeBatchesAcrossNodes, getAllNodes } from "./serverManagement.js"
import { buildTable } from "./tableBuilder.js"
import { col, W, type ReactTableConfig } from "./scriptLogUiLayout.js"
import { getEffectiveMaxRam } from "./ramUtils.js"

const DEFAULT_PROFITABILITY_TABLE_ROWS = 20

const PROFIT_WITH_PREP_COL = 4
const PROFIT_PREPPED_COL = 5

export function buildProfitabilityTableConfig(
  ns: NS,
  servers: ServerProfitability[],
  maxRows = DEFAULT_PROFITABILITY_TABLE_ROWS
): ReactTableConfig {
  const shown = servers.slice(0, maxRows)

  let bestWithPrep = -1
  let bestPrepped = -1
  let bestWithPrepServer = ""
  let bestPreppedServer = ""
  for (const server of shown) {
    if (server.moneyPerSecond > bestWithPrep) {
      bestWithPrep = server.moneyPerSecond
      bestWithPrepServer = server.serverName
    }
    if (server.moneyPerSecondPrepped > bestPrepped) {
      bestPrepped = server.moneyPerSecondPrepped
      bestPreppedServer = server.serverName
    }
  }

  const highlightCells = new Set<string>()
  const activeHeaderColumns = new Set([PROFIT_WITH_PREP_COL, PROFIT_PREPPED_COL])
  shown.forEach((server, rowIdx) => {
    if (server.serverName === bestWithPrepServer) highlightCells.add(`${rowIdx},${PROFIT_WITH_PREP_COL}`)
    if (server.serverName === bestPreppedServer) highlightCells.add(`${rowIdx},${PROFIT_PREPPED_COL}`)
  })

  return {
    title:
      servers.length > maxRows
        ? `Targets (top ${maxRows} of ${servers.length} hackable)`
        : `Targets (${servers.length} hackable)`,
    columns: [
      col("Server", "left", W.server),
      col("Lvl", "right"),
      col("Max Money", "right"),
      col("Threshold", "right"),
      col("$/sec", "right"),
      col("Prepped $/s", "right"),
      col("Weaken", "right"),
      col("Batch RAM", "right"),
      col("Batches", "right"),
    ],
    rows: shown.map((server) => [
      server.serverName,
      server.hackLevel.toString(),
      ns.format.number(server.moneyMax),
      `${(server.optimalThreshold * 100).toFixed(2)}%`,
      `${ns.format.number(server.moneyPerSecond)}/s`,
      `${ns.format.number(server.moneyPerSecondPrepped)}/s`,
      ns.format.time(server.weakenTime),
      ns.format.ram(server.batchRam),
      server.batches.toString(),
    ]),
    highlightCells,
    activeHeaderColumns,
  }
}

export interface ThresholdComparisonRow {
  threshold: number
  cycleTime: number
  moneyPerBatch: number
  moneyPerCycle: number
  moneyPerSecond: number
  batches: number
  batchRam: number
}

export interface BestTargetResult {
  serverName: string
  hackThreshold: number
  moneyPerSecond: number
  servers: ServerProfitability[]
  thresholdComparison: ThresholdComparisonRow[]
}

export interface ServerProfitability {
  serverName: string
  hackLevel: number
  moneyMax: number
  weakenTime: number
  optimalThreshold: number
  /** $/s amortizing one prep over batchCycles */
  moneyPerSecond: number
  /** $/s if the server is already prepped (no prep time in denominator) */
  moneyPerSecondPrepped: number
  batchRam: number
  batches: number
}

// Configuration constants for optimization fallback
const MAX_BATCHES_FOR_SIMULATION = 1000
const MAX_RAM_FOR_SIMULATION = Math.pow(2, 20) // 1,048,576 GB
/** Money-left fraction just above 0% (steal ~100%). */
const THRESHOLD_MIN = 1e-12
/** Money-left fraction just below 100% (steal ~0%). */
const THRESHOLD_MAX = 1 - 1e-12
const THRESHOLD_SEARCH_MAX_STEPS = 100

/** Keep thresholds in (0, 1) for formulas; only clamps numerical drift. */
function sanitizeThreshold(t: number): number {
  if (t <= 0) return THRESHOLD_MIN
  if (t >= 1) return THRESHOLD_MAX
  return t
}

/** Geometric midpoint in log-space between two money-left thresholds. */
function geometricMidThreshold(lo: number, hi: number): number {
  return sanitizeThreshold(Math.sqrt(lo * hi))
}

/** Ternary-search split points between lo and hi in log-space (1/3 and 2/3 along the ratio). */
function geometricTernarySplit(lo: number, hi: number): { m1: number; m2: number } {
  const ratio = hi / lo
  const m1 = sanitizeThreshold(lo * Math.pow(ratio, 1 / 3))
  const m2 = sanitizeThreshold(lo * Math.pow(ratio, 2 / 3))
  return { m1, m2 }
}

export interface AnalyzeServerThresholdsOptions {
  totalMaxRam: number
  nodeRamLimit: number
  myCores: number
  batchDelay: number
  nodes: string[]
  prepTime: number
  batchCycles: number
  player: Player
  hackScriptRam: number
  weakenScriptRam: number
  growScriptRam: number
}

export interface ServerThresholdAnalysis {
  rows: ThresholdComparisonRow[]
  optimalThreshold: number
  bestMoneyPerSecond: number
  bestMoneyPerSecondPrepped: number
  bestBatchRam: number
  bestBatches: number
}

/** Find best hack threshold via log-space ternary search (~0% .. ~100% money left). */
export function analyzeServerThresholds(
  ns: NS,
  server: Server,
  options: AnalyzeServerThresholdsOptions
): ServerThresholdAnalysis {
  const {
    totalMaxRam,
    nodeRamLimit,
    myCores,
    batchDelay,
    nodes,
    prepTime,
    batchCycles,
    player,
    hackScriptRam,
    weakenScriptRam,
    growScriptRam,
  } = options

  const moneyMax = server.moneyMax!
  const timings = calculateBatchTimings(ns, server, player, batchDelay)
  const { effectiveBatchDelay } = timings

  const rows: ThresholdComparisonRow[] = []
  const rowByThreshold = new Map<string, ThresholdComparisonRow>()
  let optimalThreshold = THRESHOLD_MIN
  let bestMoneyPerSecond = 0
  let bestMoneyPerSecondPrepped = 0
  let bestBatchRam = 0
  let bestBatches = 0

  const evaluateThreshold = (testThreshold: number): ThresholdComparisonRow | null => {
    const key = testThreshold.toFixed(9)
    const cached = rowByThreshold.get(key)
    if (cached) return cached

    const { server: hackServer, player: hackPlayer } = hackServerInstance(server, player)
    const hackThreads = calculateHackThreads(hackServer, hackPlayer, moneyMax, testThreshold, ns)

    const { server: wkn1Server, player: wkn1Player } = wkn1ServerInstance(server, player, hackThreads, ns)
    const wkn1Threads = calculateWeakThreads(wkn1Server, wkn1Player, myCores)

    const { server: growServer, player: growPlayer } = growServerInstance(server, player, testThreshold)
    const growThreads = calculateGrowThreads(growServer, growPlayer, moneyMax, myCores, ns)

    const { server: wkn2Server, player: wkn2Player } = wkn2ServerInstance(server, player, growThreads, ns, myCores)
    const wkn2Threads = calculateWeakThreads(wkn2Server, wkn2Player, myCores)

    const totalBatchRam =
      hackScriptRam * hackThreads +
      weakenScriptRam * wkn1Threads +
      growScriptRam * growThreads +
      weakenScriptRam * wkn2Threads

    if (totalBatchRam > nodeRamLimit) return null

    const estimatedBatches = Math.floor(totalMaxRam / totalBatchRam)
    let batches: number

    if (estimatedBatches > MAX_BATCHES_FOR_SIMULATION || totalMaxRam > MAX_RAM_FOR_SIMULATION) {
      batches = estimatedBatches
    } else {
      const testOperations: Array<{
        ram: number
        scriptPath: string
        args: unknown[]
        threads: number
        batchIndex: number
      }> = []

      for (let b = 0; b < estimatedBatches; b++) {
        testOperations.push(
          { ram: hackScriptRam * hackThreads, scriptPath: "/hacking/hack.js", args: [], threads: hackThreads, batchIndex: b },
          { ram: weakenScriptRam * wkn1Threads, scriptPath: "/hacking/weaken.js", args: [], threads: wkn1Threads, batchIndex: b },
          { ram: growScriptRam * growThreads, scriptPath: "/hacking/grow.js", args: [], threads: growThreads, batchIndex: b },
          { ram: weakenScriptRam * wkn2Threads, scriptPath: "/hacking/weaken.js", args: [], threads: wkn2Threads, batchIndex: b }
        )
      }

      batches = distributeBatchesAcrossNodes(ns, nodes, testOperations).completeBatches
    }

    const moneyPerBatch = moneyMax * (1 - testThreshold)
    const moneyPerCycle = moneyPerBatch * batches
    const lastBatchOffset = (batches - 1) * effectiveBatchDelay * 4
    const cycleTime = timings.weakenTime + 2 * effectiveBatchDelay + lastBatchOffset

    const totalTime = prepTime + cycleTime * batchCycles
    const totalMoney = moneyPerCycle * batchCycles
    const batchRunTime = cycleTime * batchCycles
    const moneyPerSecond = totalTime > 0 ? (totalMoney / totalTime) * 1000 : 0
    const moneyPerSecondPrepped = batchRunTime > 0 ? (totalMoney / batchRunTime) * 1000 : 0

    const row: ThresholdComparisonRow = {
      threshold: testThreshold,
      cycleTime,
      moneyPerBatch,
      moneyPerCycle,
      moneyPerSecond,
      batches,
      batchRam: totalBatchRam,
    }
    rowByThreshold.set(key, row)
    rows.push(row)

    if (moneyPerSecond > bestMoneyPerSecond) {
      bestMoneyPerSecond = moneyPerSecond
      optimalThreshold = testThreshold
      bestBatchRam = totalBatchRam
      bestBatches = batches
    }

    if (moneyPerSecondPrepped > bestMoneyPerSecondPrepped) {
      bestMoneyPerSecondPrepped = moneyPerSecondPrepped
    }

    return row
  }

  const moneyPerSecondAt = (t: number): number => evaluateThreshold(t)?.moneyPerSecond ?? -1

  // Log-space ternary search from ~0% .. ~100% money left (steal ~100% .. ~0%).
  let lo = THRESHOLD_MIN
  let hi = THRESHOLD_MAX
  evaluateThreshold(lo)
  evaluateThreshold(hi)

  let evaluations = 2
  while (evaluations < THRESHOLD_SEARCH_MAX_STEPS && hi / lo > 1 + 1e-9) {
    const { m1, m2 } = geometricTernarySplit(lo, hi)
    if (m1 <= lo || m2 >= hi || m2 <= m1) break

    const mps1 = moneyPerSecondAt(m1)
    evaluations++
    const mps2 = moneyPerSecondAt(m2)
    evaluations++

    if (mps1 < 0 && mps2 < 0) {
      lo = m1
      if (hi / lo <= 1 + 1e-9) break
      continue
    }
    if (mps1 < 0) {
      lo = m1
      continue
    }
    if (mps2 < 0) {
      hi = m2
      continue
    }

    if (mps1 < mps2) lo = m1
    else hi = m2
  }

  // Final midpoint check when search stalls on an edge.
  if (evaluations < THRESHOLD_SEARCH_MAX_STEPS && hi / lo > 1 + 1e-9) {
    evaluateThreshold(geometricMidThreshold(lo, hi))
  }

  rows.sort((a, b) => a.threshold - b.threshold)

  return {
    rows,
    optimalThreshold,
    bestMoneyPerSecond,
    bestMoneyPerSecondPrepped,
    bestBatchRam,
    bestBatches,
  }
}

function findOptimalThresholdRowIndex(rows: ThresholdComparisonRow[], optimalThreshold: number): number {
  if (rows.length === 0) return -1
  let bestIdx = 0
  let bestDist = Math.abs(rows[0].threshold - optimalThreshold)
  for (let i = 1; i < rows.length; i++) {
    const dist = Math.abs(rows[i].threshold - optimalThreshold)
    if (dist < bestDist) {
      bestDist = dist
      bestIdx = i
    }
  }
  return bestIdx
}

export function buildThresholdComparisonTableConfig(
  ns: NS,
  serverName: string,
  rows: ThresholdComparisonRow[],
  optimalThreshold: number
): ReactTableConfig {
  const optimalDisplayIndex = findOptimalThresholdRowIndex(rows, optimalThreshold)
  const fmtTime = (ms: number) => formatGameTimeMs(ms, (m) => ns.format.time(m))

  return {
    title: `${serverName} threshold comparison (${rows.length} thresholds)`,
    columns: [
      { header: "Threshold", align: "right" },
      { header: "Cycle Time", align: "right" },
      { header: "$/Batch", align: "right" },
      { header: "$/Cycle", align: "right" },
      { header: "Batches", align: "right" },
      { header: "Batch RAM", align: "right" },
      { header: "$/sec", align: "right" },
    ],
    rows: rows.map((row) => [
      `${(row.threshold * 100).toFixed(2)}%`,
      fmtTime(row.cycleTime),
      ns.format.number(row.moneyPerBatch),
      ns.format.number(row.moneyPerCycle),
      row.batches.toString(),
      ns.format.ram(row.batchRam),
      `${ns.format.number(row.moneyPerSecond)}/s`,
    ]),
    selectedRowIndex: optimalDisplayIndex >= 0 ? optimalDisplayIndex : undefined,
    highlightCells:
      optimalDisplayIndex >= 0 ? new Set([`${optimalDisplayIndex},6`]) : undefined,
    activeHeaderColumns: new Set([6]),
  }
}

/**
 * Analyze all hackable servers and return detailed profitability data
 * @param totalMaxRam - Total RAM across all nodes (for calculating total batches)
 * @param nodeRamLimit - constrains single operation size
 * @param nodes - Array of node names to use for prep time calculation
 * @param batchCycles - Number of batch cycles to weight against prep time (default: 3)
 * @returns Array of servers sorted by profitability (best first)
 */
export async function analyzeAllServers(
  ns: NS,
  totalMaxRam: number,
  nodeRamLimit: number,
  myCores: number,
  batchDelay: number,
  nodes: string[],
  playerHackLevel?: number,
  batchCycles: number = 20
): Promise<{ servers: ServerProfitability[]; thresholdByServer: Map<string, ThresholdComparisonRow[]> }> {
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
  const thresholdByServer = new Map<string, ThresholdComparisonRow[]>()

  const thresholdOptionsBase = {
    totalMaxRam,
    nodeRamLimit,
    myCores,
    batchDelay,
    nodes,
    batchCycles,
    player,
    hackScriptRam,
    weakenScriptRam,
    growScriptRam,
  }

  for (const targetName of hackableServers) {
    const prepTimeResult = await prepareServerMultiNode(ns, nodes, targetName, { dryRun: true, showVerbose: false })
    const prepTime = prepTimeResult.totalTime

    const server = ns.getServer(targetName)
    server.hackDifficulty = server.minDifficulty
    server.moneyAvailable = server.moneyMax
    const moneyMax = server.moneyMax!

    const weakenTime = ns.formulas.hacking.weakenTime(server, player)

    const analysis = analyzeServerThresholds(ns, server, {
      ...thresholdOptionsBase,
      prepTime,
    })

    thresholdByServer.set(targetName, analysis.rows)

    profitabilityData.push({
      serverName: targetName,
      hackLevel: server.requiredHackingSkill!,
      moneyMax: moneyMax,
      weakenTime: weakenTime,
      optimalThreshold: analysis.optimalThreshold,
      moneyPerSecond: analysis.bestMoneyPerSecond,
      moneyPerSecondPrepped: analysis.bestMoneyPerSecondPrepped,
      batchRam: analysis.bestBatchRam,
      batches: analysis.bestBatches,
    })
  }

  // Sort by money per second (descending)
  profitabilityData.sort((a, b) => b.moneyPerSecond - a.moneyPerSecond)

  return { servers: profitabilityData, thresholdByServer }
}

export async function findBestTarget(
  ns: NS,
  totalMaxRam: number,
  nodeRamLimit: number,
  myCores: number,
  batchDelay: number,
  nodes: string[],
  playerHackLevel?: number,
  batchCycles: number = 3,
  logMessage?: (message: string) => void
): Promise<BestTargetResult> {
  const { servers: profitabilityData, thresholdByServer } = await analyzeAllServers(
    ns,
    totalMaxRam,
    nodeRamLimit,
    myCores,
    batchDelay,
    nodes,
    playerHackLevel,
    batchCycles
  )

  logMessage?.(`Analyzed ${profitabilityData.length} hackable servers`)

  const best = profitabilityData[0]

  if (!best) {
    throw new Error("No hackable servers found!")
  }

  return {
    serverName: best.serverName,
    hackThreshold: best.optimalThreshold,
    moneyPerSecond: best.moneyPerSecond,
    servers: profitabilityData,
    thresholdComparison: thresholdByServer.get(best.serverName) ?? [],
  }
}

export async function main(ns: NS) {
  const playerHackLevel = ns.args[0] ? Number(ns.args[0]) : undefined

  // Get all nodes and calculate total RAM
  const nodes = getAllNodes(ns)
  if (nodes.length === 0) {
    nodes.push("home")
  }

  const totalMaxRam = nodes.reduce((sum, node) => sum + getEffectiveMaxRam(ns, node), 0)
  const nodeRamLimit = Math.min(...nodes.map((node) => getEffectiveMaxRam(ns, node)))
  const myCores = ns.getServer(nodes[0]).cpuCores

  const result = await findBestTarget(ns, totalMaxRam, nodeRamLimit, myCores, 20, nodes, playerHackLevel, 3)

  ns.tprint(buildTable(buildProfitabilityTableConfig(ns, result.servers)))
  ns.tprint("")
  ns.tprint(`Best target: ${result.serverName} (${(result.hackThreshold * 100).toFixed(2)}%, ${ns.format.number(result.moneyPerSecond)}/s)`)
  ns.tprint(`To start batching: run batch.js`)
}
