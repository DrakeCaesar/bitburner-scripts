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
const THRESHOLD_SWEEP_STEPS = 200
/** Fraction of money left after hack — edge bands [0, 1%] and [99%, 100%]. */
const THRESHOLD_EDGE_BAND = 0.01
const THRESHOLD_EDGE_SAMPLES = 80

function linspaceThresholds(min: number, max: number, count: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [(min + max) / 2]
  const thresholds: number[] = []
  for (let i = 0; i < count; i++) {
    thresholds.push(min + (i / (count - 1)) * (max - min))
  }
  return thresholds
}

/**
 * Most samples in 0–1% and 99–100%; the 1–99% range gets the remainder (sparse).
 */
export function generateSweepThresholds(count = THRESHOLD_SWEEP_STEPS - 1): number[] {
  const edgeSamples = Math.min(
    THRESHOLD_EDGE_SAMPLES,
    Math.floor((count - 1) / 2)
  )
  const middleSamples = count - edgeSamples * 2

  const lowMin = 0.001
  const lowMax = THRESHOLD_EDGE_BAND
  const highMin = 1 - THRESHOLD_EDGE_BAND
  const highMax = 0.999

  const low = linspaceThresholds(lowMin, lowMax, edgeSamples)
  const middle =
    middleSamples > 0
      ? Array.from({ length: middleSamples }, (_, j) => {
          const t = (j + 1) / (middleSamples + 1)
          return lowMax + t * (highMin - lowMax)
        })
      : []
  const high = linspaceThresholds(highMin, highMax, edgeSamples)

  return [...low, ...middle, ...high].map((t) => Math.min(0.999, Math.max(0.001, t)))
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

/** Sweep hack thresholds for one prepared server; same model as batch cycle planning. */
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
  let optimalThreshold = 0.5
  let bestMoneyPerSecond = 0
  let bestMoneyPerSecondPrepped = 0
  let bestBatchRam = 0
  let bestBatches = 0

  const sweepThresholds = generateSweepThresholds()

  for (const testThreshold of sweepThresholds) {
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

    if (totalBatchRam > nodeRamLimit) continue

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

    rows.push({
      threshold: testThreshold,
      cycleTime,
      moneyPerBatch,
      moneyPerCycle,
      moneyPerSecond,
      batches,
      batchRam: totalBatchRam,
    })

    if (moneyPerSecond > bestMoneyPerSecond) {
      bestMoneyPerSecond = moneyPerSecond
      optimalThreshold = testThreshold
      bestBatchRam = totalBatchRam
      bestBatches = batches
    }

    if (moneyPerSecondPrepped > bestMoneyPerSecondPrepped) {
      bestMoneyPerSecondPrepped = moneyPerSecondPrepped
    }
  }

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
