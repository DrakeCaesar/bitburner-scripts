import { NS, Player, Server } from "@ns"
import {
  calculateOperationXp,
  createKahanSum,
  kahanAdd,
  prepareServerMultiNode,
  updatePlayerWithKahanXp,
} from "./batchCalculations.js"
import { crawl, isHackableNetworkServer } from "./crawl.js"
import { getAvailableRam } from "./ramUtils.js"
import { BatchWorkerMode } from "./serverManagement.js"

export const GRIND_LOOP_SCRIPT = "/hacking/grindLoop.js"
const HACK_SCRIPT = "/hacking/hack.js"
const GROW_SCRIPT = "/hacking/grow.js"
const WEAKEN_SCRIPT = "/hacking/weaken.js"

const GRIND_SCRIPTS = [GRIND_LOOP_SCRIPT, HACK_SCRIPT, GROW_SCRIPT, WEAKEN_SCRIPT]

const EXCLUDED_HOSTS = new Set([
  "home",
  "darkweb",
  "w0r1d_d43m0n",
  "CSEC",
  "I.I.I.I",
  "run4theh111z",
  "The-Cave",
  "avmnite-02h",
])

export type HackGrindMode = "weaken" | "hack" | "grow" | "auto"
export type GrindOp = "hack" | "grow" | "weaken"

export interface HackGrindOptions {
  mode: HackGrindMode
  target?: string
  workers: BatchWorkerMode
  excludeHacknet: boolean
}

export interface GrindDeployment {
  hack: number
  grow: number
  weaken: number
}

export interface GrindSimTimelinePoint {
  elapsedMs: number
  totalXp: number
  level: number
  xpPerSecondAvg: number
}

export interface GrindSimResult {
  xpPerSecond: number
  simDurationMs: number
  totalXp: number
  startLevel: number
  endLevel: number
  deployment: GrindDeployment
  timeline: GrindSimTimelinePoint[]
}

export interface GrindStrategyTimelineRow {
  elapsedMs: number
  weakenXp: number
  hackXp: number
  growXp: number
  weakenLevel: number
  hackLevel: number
  growLevel: number
}

export interface GrindValidationSnapshot {
  elapsedMs: number
  predictedXp: number
  actualXp: number
  predictedLevel: number
  actualLevel: number
  predictedXpPerSecond: number
  actualXpPerSecond: number
  xpDelta: number
  xpTotalPercentDiff: string
  xpRatePercentDiff: string
  levelDelta: number
}

export interface GrindActualSample {
  elapsedMs: number
  totalXp: number
  level: number
  xpPerSecondAvg: number
}

export interface GrindTargetComparison {
  hostname: string
  hackLevel: number
  minSecurity: number
  weaken: GrindSimResult
  hack: GrindSimResult
  grow: GrindSimResult
}

export interface ActiveGrindPlan {
  mode: Exclude<HackGrindMode, "auto">
  target: string
  comparison: GrindTargetComparison
  simulatedXpPerSecond: number
  leaderboard: GrindTargetComparison[]
}

function bestSimXpPerSecond(comparison: GrindTargetComparison): number {
  return Math.max(comparison.weaken.xpPerSecond, comparison.hack.xpPerSecond, comparison.grow.xpPerSecond)
}

function buildLeaderboard(comparisons: GrindTargetComparison[], limit = 8): GrindTargetComparison[] {
  return [...comparisons].sort((a, b) => bestSimXpPerSecond(b) - bestSimXpPerSecond(a)).slice(0, limit)
}

export interface HackGrindMaintenance {
  threadsForFullHack: number
  growThreads: number
  weakenThreads: number
  hackTime: number
  growTime: number
  weakenTime: number
}

const GROW_SCHEDULE_COUNT = 8
const WEAKEN_SCHEDULE_COUNT = 12
const MONEY_TOLERANCE = 0.999
const SECURITY_EPSILON = 0.001
const SIM_DURATION_MS = 120_000
const SIM_MAX_EVENTS = 5_000
const SIM_CANDIDATE_LIMIT = 25
export const GRIND_TIMELINE_STEP_MS = 10_000

export function parseGrindArgs(args: (string | number | boolean)[]): HackGrindOptions {
  let mode: HackGrindMode = "auto"
  let target: string | undefined
  let workers: BatchWorkerMode = "auto"
  let excludeHacknet = false

  for (const raw of args) {
    const token = String(raw).trim().toLowerCase()
    if (token === "") continue

    if (token === "weaken" || token === "hack" || token === "grow" || token === "auto") {
      mode = token
      continue
    }
    if (token === "home") workers = "home"
    else if (token === "nuked") workers = "nuked"
    else if (token === "purchased" || token === "nodes") workers = "purchased"
    else if (token === "no-hacknet" || token === "nohacknet") excludeHacknet = true
    else if (!token.includes(" ") && Number.isNaN(Number(token))) {
      target = String(raw)
    }
  }

  return { mode, target, workers, excludeHacknet }
}

function isGrindCandidate(hostname: string, player: Player, ns: NS): boolean {
  if (!isHackableNetworkServer(hostname)) return false
  if (EXCLUDED_HOSTS.has(hostname)) return false
  if (hostname.includes("node")) return false

  const server = ns.getServer(hostname)
  return (
    server.hasAdminRights &&
    (server.moneyMax ?? 0) > 0 &&
    (server.requiredHackingSkill ?? Infinity) <= player.skills.hacking
  )
}

function serverAtMinSecurity(server: Server): Server {
  return {
    ...server,
    hackDifficulty: server.minDifficulty,
  }
}

function serverPreppedForGrow(server: Server): Server {
  return {
    ...server,
    hackDifficulty: server.minDifficulty,
    moneyAvailable: server.moneyMax,
  }
}

function serverForGrindOp(server: Server, op: GrindOp): Server {
  return op === "grow" ? serverPreppedForGrow(server) : serverAtMinSecurity(server)
}

function clonePlayer(player: Player): Player {
  return {
    ...player,
    exp: { ...player.exp },
    skills: { ...player.skills },
  }
}

function opDurationMs(ns: NS, op: GrindOp, server: Server, player: Player): number {
  if (op === "hack") return ns.formulas.hacking.hackTime(server, player)
  if (op === "grow") return ns.formulas.hacking.growTime(server, player)
  return ns.formulas.hacking.weakenTime(server, player)
}

function sortedNodesByRam(ns: NS, nodes: string[]): string[] {
  return [...nodes].sort((a, b) => getAvailableRam(ns, b) - getAvailableRam(ns, a))
}

function quickXpPerSecondEstimate(ns: NS, hostname: string, player: Player): number {
  const server = ns.getServer(hostname)
  const atMin = serverAtMinSecurity(server)
  const xpPerThread = ns.formulas.hacking.hackExp(atMin, player)
  const hackTime = ns.formulas.hacking.hackTime(atMin, player)
  return hackTime > 0 ? (xpPerThread / hackTime) * 1000 : 0
}

function allocateThreads(available: Map<string, number>, host: string, threads: number, ramPerThread: number): number {
  const freeRam = available.get(host) ?? 0
  const actualThreads = Math.min(threads, Math.floor(freeRam / ramPerThread))
  if (actualThreads <= 0) return 0
  available.set(host, freeRam - actualThreads * ramPerThread)
  return actualThreads
}

export function planGrindDeployment(
  ns: NS,
  nodes: string[],
  target: string,
  mode: Exclude<HackGrindMode, "auto">,
  cores: number
): GrindDeployment {
  const ramPerThread = ns.getScriptRam(GRIND_LOOP_SCRIPT)
  const available = new Map(nodes.map((host) => [host, getAvailableRam(ns, host)]))
  const deployment: GrindDeployment = { hack: 0, grow: 0, weaken: 0 }

  if (mode === "weaken" || mode === "grow") {
    const op = mode
    for (const host of nodes) {
      const threads = allocateThreads(available, host, Number.MAX_SAFE_INTEGER, ramPerThread)
      deployment[op] += threads
    }
    return deployment
  }

  const maintenance = calculateHackGrindMaintenance(ns, target, cores)
  const nodesByRam = sortedNodesByRam(ns, nodes)
  const maintenanceHosts = [...nodesByRam].reverse()

  for (let i = 0; i < GROW_SCHEDULE_COUNT; i++) {
    const host = maintenanceHosts[i % maintenanceHosts.length]
    deployment.grow += allocateThreads(available, host, maintenance.growThreads, ramPerThread)
  }

  const weakenThreadsPerLoop = Math.max(1, Math.ceil(maintenance.weakenThreads / WEAKEN_SCHEDULE_COUNT))
  for (let i = 0; i < WEAKEN_SCHEDULE_COUNT; i++) {
    const host = maintenanceHosts[i % maintenanceHosts.length]
    deployment.weaken += allocateThreads(available, host, weakenThreadsPerLoop, ramPerThread)
  }

  for (const host of nodesByRam) {
    deployment.hack += allocateThreads(available, host, Number.MAX_SAFE_INTEGER, ramPerThread)
  }

  return deployment
}

interface GrindSimStream {
  op: GrindOp
  threads: number
  nextFinishMs: number
  launchPlayer: Player
}

function emptyTimeline(startLevel: number): GrindSimTimelinePoint[] {
  return [{ elapsedMs: 0, totalXp: 0, level: startLevel, xpPerSecondAvg: 0 }]
}

function appendTimelineSamples(
  timeline: GrindSimTimelinePoint[],
  nextSampleMs: number,
  simTimeMs: number,
  startXp: number,
  xpSum: number,
  level: number,
  stepMs: number,
  maxDurationMs: number
): number {
  while (nextSampleMs <= simTimeMs && nextSampleMs <= maxDurationMs) {
    const totalXp = xpSum - startXp
    timeline.push({
      elapsedMs: nextSampleMs,
      totalXp,
      level,
      xpPerSecondAvg: nextSampleMs > 0 ? (totalXp / nextSampleMs) * 1000 : 0,
    })
    nextSampleMs += stepMs
  }
  return nextSampleMs
}

export function interpolateSimAt(
  sim: GrindSimResult,
  elapsedMs: number
): { totalXp: number; level: number; xpPerSecondAvg: number } {
  if (elapsedMs <= 0) {
    return { totalXp: 0, level: sim.startLevel, xpPerSecondAvg: 0 }
  }

  const timeline = sim.timeline
  if (timeline.length === 0) {
    const ratio = sim.simDurationMs > 0 ? Math.min(1, elapsedMs / sim.simDurationMs) : 0
    return {
      totalXp: sim.totalXp * ratio,
      level: sim.startLevel + Math.round((sim.endLevel - sim.startLevel) * ratio),
      xpPerSecondAvg: sim.xpPerSecond,
    }
  }

  let idx = 0
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i].elapsedMs <= elapsedMs) {
      idx = i
      break
    }
  }

  const point = timeline[idx]
  const next = timeline[idx + 1]
  if (!next || elapsedMs >= next.elapsedMs) {
    if (elapsedMs <= sim.simDurationMs || sim.simDurationMs <= 0) {
      return {
        totalXp: point.totalXp,
        level: point.level,
        xpPerSecondAvg: point.xpPerSecondAvg,
      }
    }

    const extraMs = elapsedMs - sim.simDurationMs
    const totalXp = sim.totalXp + (sim.xpPerSecond * extraMs) / 1000
    return {
      totalXp,
      level: sim.endLevel,
      xpPerSecondAvg: elapsedMs > 0 ? (totalXp / elapsedMs) * 1000 : 0,
    }
  }

  const span = next.elapsedMs - point.elapsedMs
  const frac = span > 0 ? (elapsedMs - point.elapsedMs) / span : 0
  const totalXp = point.totalXp + (next.totalXp - point.totalXp) * frac
  const level = Math.round(point.level + (next.level - point.level) * frac)
  return {
    totalXp,
    level,
    xpPerSecondAvg: elapsedMs > 0 ? (totalXp / elapsedMs) * 1000 : 0,
  }
}

export function buildStrategyTimelineRows(comparison: GrindTargetComparison): GrindStrategyTimelineRow[] {
  const maxDuration = Math.max(
    comparison.weaken.simDurationMs,
    comparison.hack.simDurationMs,
    comparison.grow.simDurationMs,
    GRIND_TIMELINE_STEP_MS
  )

  const rows: GrindStrategyTimelineRow[] = []
  for (let elapsedMs = 0; elapsedMs <= maxDuration; elapsedMs += GRIND_TIMELINE_STEP_MS) {
    const weaken = interpolateSimAt(comparison.weaken, elapsedMs)
    const hack = interpolateSimAt(comparison.hack, elapsedMs)
    const grow = interpolateSimAt(comparison.grow, elapsedMs)
    rows.push({
      elapsedMs,
      weakenXp: weaken.totalXp,
      hackXp: hack.totalXp,
      growXp: grow.totalXp,
      weakenLevel: weaken.level,
      hackLevel: hack.level,
      growLevel: grow.level,
    })
  }

  return rows
}

export function buildValidationSnapshot(
  predicted: GrindSimResult,
  elapsedMs: number,
  startXp: number,
  startLevel: number,
  currentXp: number,
  currentLevel: number
): GrindValidationSnapshot {
  const predictedAt = interpolateSimAt(predicted, elapsedMs)
  const actualXp = currentXp - startXp
  const actualXpPerSecond = elapsedMs > 0 ? (actualXp / elapsedMs) * 1000 : 0
  const xpDelta = actualXp - predictedAt.totalXp
  const xpRateDelta = actualXpPerSecond - predictedAt.xpPerSecondAvg
  const xpTotalPercentDiff =
    predictedAt.totalXp > 0 ? ((xpDelta / predictedAt.totalXp) * 100).toFixed(1) : actualXp > 0 ? "n/a" : "0.0"
  const xpRatePercentDiff =
    predictedAt.xpPerSecondAvg > 0
      ? ((xpRateDelta / predictedAt.xpPerSecondAvg) * 100).toFixed(1)
      : actualXpPerSecond > 0
        ? "n/a"
        : "0.0"

  return {
    elapsedMs,
    predictedXp: predictedAt.totalXp,
    actualXp,
    predictedLevel: predictedAt.level,
    actualLevel: currentLevel,
    predictedXpPerSecond: predictedAt.xpPerSecondAvg,
    actualXpPerSecond,
    xpDelta,
    xpTotalPercentDiff,
    xpRatePercentDiff,
    levelDelta: currentLevel - predictedAt.level,
  }
}

export function buildValidationTimelineRows(
  predicted: GrindSimResult,
  actualSamples: GrindActualSample[],
  startXp: number,
  startLevel: number
): Array<{
  elapsedMs: number
  predictedXp: number
  actualXp: number
  predictedLevel: number
  actualLevel: number
  xpDelta: number
}> {
  const elapsedSet = new Set<number>([0])
  for (const sample of actualSamples) elapsedSet.add(sample.elapsedMs)
  for (const point of predicted.timeline) elapsedSet.add(point.elapsedMs)
  if (predicted.simDurationMs > 0) elapsedSet.add(predicted.simDurationMs)

  const elapsedValues = Array.from(elapsedSet).sort((a, b) => a - b)
  const actualByElapsed = new Map(actualSamples.map((sample) => [sample.elapsedMs, sample]))

  return elapsedValues.map((elapsedMs) => {
    const predictedAt = interpolateSimAt(predicted, elapsedMs)
    const actualSample = actualByElapsed.get(elapsedMs)
    const actualXp = actualSample?.totalXp ?? (elapsedMs === 0 ? 0 : undefined)

    let resolvedActualXp = actualXp
    let resolvedActualLevel = actualSample?.level
    if (resolvedActualXp == null) {
      const latest = [...actualSamples].reverse().find((sample) => sample.elapsedMs <= elapsedMs)
      if (latest) {
        resolvedActualXp = latest.totalXp
        resolvedActualLevel = latest.level
      } else {
        resolvedActualXp = 0
        resolvedActualLevel = startLevel
      }
    }

    return {
      elapsedMs,
      predictedXp: predictedAt.totalXp,
      actualXp: resolvedActualXp,
      predictedLevel: predictedAt.level,
      actualLevel: resolvedActualLevel ?? startLevel,
      xpDelta: resolvedActualXp - predictedAt.totalXp,
    }
  })
}

/**
 * Event-driven XP simulation using the same helpers as batch planning:
 * hackExp per thread, level-ups via updatePlayerWithKahanXp, op times from formulas at launch.
 */
export function simulateGrindXpRate(
  ns: NS,
  target: string,
  mode: Exclude<HackGrindMode, "auto">,
  nodes: string[],
  cores: number,
  simDurationMs = SIM_DURATION_MS
): GrindSimResult {
  const deployment = planGrindDeployment(ns, nodes, target, mode, cores)
  const totalThreads = deployment.hack + deployment.grow + deployment.weaken
  let simPlayer = clonePlayer(ns.getPlayer())
  const startLevel = simPlayer.skills.hacking
  const startXp = simPlayer.exp.hacking

  if (totalThreads === 0) {
    return {
      xpPerSecond: 0,
      simDurationMs: 0,
      totalXp: 0,
      startLevel,
      endLevel: startLevel,
      deployment,
      timeline: emptyTimeline(startLevel),
    }
  }

  const baseServer = ns.getServer(target)
  const streams: GrindSimStream[] = []
  for (const op of ["hack", "grow", "weaken"] as const) {
    const threads = deployment[op]
    if (threads <= 0) continue
    const server = serverForGrindOp(baseServer, op)
    streams.push({
      op,
      threads,
      nextFinishMs: opDurationMs(ns, op, server, simPlayer),
      launchPlayer: clonePlayer(simPlayer),
    })
  }

  let xpKahan = createKahanSum(startXp)
  let simTimeMs = 0
  let eventCount = 0
  const timeline: GrindSimTimelinePoint[] = emptyTimeline(startLevel)
  let nextSampleMs = GRIND_TIMELINE_STEP_MS

  while (simTimeMs < simDurationMs && eventCount < SIM_MAX_EVENTS && streams.length > 0) {
    let nextIdx = 0
    for (let i = 1; i < streams.length; i++) {
      if (streams[i].nextFinishMs < streams[nextIdx].nextFinishMs) nextIdx = i
    }

    const stream = streams[nextIdx]
    simTimeMs = stream.nextFinishMs
    eventCount++

    const server = serverForGrindOp(baseServer, stream.op)
    const xp = calculateOperationXp(server, stream.launchPlayer, stream.threads, ns)
    xpKahan = kahanAdd(xpKahan, xp)
    simPlayer = updatePlayerWithKahanXp(simPlayer, xpKahan, ns)

    stream.launchPlayer = clonePlayer(simPlayer)
    stream.nextFinishMs = simTimeMs + opDurationMs(ns, stream.op, server, simPlayer)

    nextSampleMs = appendTimelineSamples(
      timeline,
      nextSampleMs,
      simTimeMs,
      startXp,
      xpKahan.sum,
      simPlayer.skills.hacking,
      GRIND_TIMELINE_STEP_MS,
      simDurationMs
    )
  }

  const xpGained = xpKahan.sum - startXp

  if (timeline[timeline.length - 1].elapsedMs !== simTimeMs && simTimeMs > 0) {
    timeline.push({
      elapsedMs: simTimeMs,
      totalXp: xpGained,
      level: simPlayer.skills.hacking,
      xpPerSecondAvg: (xpGained / simTimeMs) * 1000,
    })
  }

  return {
    xpPerSecond: simTimeMs > 0 ? (xpGained / simTimeMs) * 1000 : 0,
    simDurationMs: simTimeMs,
    totalXp: xpGained,
    startLevel,
    endLevel: simPlayer.skills.hacking,
    deployment,
    timeline,
  }
}

export function compareGrindTarget(
  ns: NS,
  hostname: string,
  nodes: string[],
  cores: number
): GrindTargetComparison | null {
  const player = ns.getPlayer()
  if (!isGrindCandidate(hostname, player, ns)) return null

  const server = ns.getServer(hostname)
  return {
    hostname,
    hackLevel: server.requiredHackingSkill ?? 0,
    minSecurity: server.minDifficulty ?? 0,
    weaken: simulateGrindXpRate(ns, hostname, "weaken", nodes, cores),
    hack: simulateGrindXpRate(ns, hostname, "hack", nodes, cores),
    grow: simulateGrindXpRate(ns, hostname, "grow", nodes, cores),
  }
}

export function listGrindComparisons(ns: NS, nodes: string[], cores: number): GrindTargetComparison[] {
  const player = ns.getPlayer()
  const knownServers = new Set<string>()
  crawl(ns, knownServers)

  const candidates = Array.from(knownServers)
    .filter((hostname) => isGrindCandidate(hostname, player, ns))
    .map((hostname) => ({ hostname, estimate: quickXpPerSecondEstimate(ns, hostname, player) }))
    .sort((a, b) => b.estimate - a.estimate)
    .slice(0, SIM_CANDIDATE_LIMIT)
    .map((row) => row.hostname)

  const comparisons: GrindTargetComparison[] = []
  for (const hostname of candidates) {
    const comparison = compareGrindTarget(ns, hostname, nodes, cores)
    if (comparison) comparisons.push(comparison)
  }

  return comparisons
}

export function simResultForMode(
  comparison: GrindTargetComparison,
  mode: Exclude<HackGrindMode, "auto">
): GrindSimResult {
  return comparison[mode]
}

export function bestComparisonForMode(
  comparisons: GrindTargetComparison[],
  mode: Exclude<HackGrindMode, "auto">
): GrindTargetComparison | null {
  if (comparisons.length === 0) return null
  return comparisons.reduce((best, current) =>
    simResultForMode(current, mode).xpPerSecond > simResultForMode(best, mode).xpPerSecond ? current : best
  )
}

export function chooseAutoMode(
  comparisons: GrindTargetComparison[]
): { mode: Exclude<HackGrindMode, "auto">; comparison: GrindTargetComparison } | null {
  const bestWeaken = bestComparisonForMode(comparisons, "weaken")
  const bestHack = bestComparisonForMode(comparisons, "hack")
  const bestGrow = bestComparisonForMode(comparisons, "grow")
  if (!bestWeaken || !bestHack || !bestGrow) return null

  const ranked = [
    { mode: "hack" as const, comparison: bestHack, xpPerSecond: bestHack.hack.xpPerSecond },
    { mode: "grow" as const, comparison: bestGrow, xpPerSecond: bestGrow.grow.xpPerSecond },
    { mode: "weaken" as const, comparison: bestWeaken, xpPerSecond: bestWeaken.weaken.xpPerSecond },
  ].sort((a, b) => b.xpPerSecond - a.xpPerSecond)

  return { mode: ranked[0].mode, comparison: ranked[0].comparison }
}

export function resolveGrindPlan(
  ns: NS,
  options: HackGrindOptions,
  nodes: string[],
  cores: number
): ActiveGrindPlan | null {
  const comparisons = listGrindComparisons(ns, nodes, cores)
  if (comparisons.length === 0) return null

  if (options.target) {
    const comparison = comparisons.find((row) => row.hostname === options.target) ?? compareGrindTarget(ns, options.target, nodes, cores)
    if (!comparison) return null

    if (options.mode === "auto") {
      const ranked = [
        { mode: "hack" as const, xpPerSecond: comparison.hack.xpPerSecond },
        { mode: "grow" as const, xpPerSecond: comparison.grow.xpPerSecond },
        { mode: "weaken" as const, xpPerSecond: comparison.weaken.xpPerSecond },
      ].sort((a, b) => b.xpPerSecond - a.xpPerSecond)
      const mode = ranked[0].xpPerSecond > 0 ? ranked[0].mode : "weaken"
      return {
        mode,
        target: comparison.hostname,
        comparison,
        simulatedXpPerSecond: simResultForMode(comparison, mode).xpPerSecond,
        leaderboard: buildLeaderboard(comparisons),
      }
    }

    return {
      mode: options.mode,
      target: comparison.hostname,
      comparison,
      simulatedXpPerSecond: simResultForMode(comparison, options.mode).xpPerSecond,
      leaderboard: buildLeaderboard(comparisons),
    }
  }

  if (options.mode === "auto") {
    const auto = chooseAutoMode(comparisons)
    if (!auto) return null
    return {
      mode: auto.mode,
      target: auto.comparison.hostname,
      comparison: auto.comparison,
      simulatedXpPerSecond: simResultForMode(auto.comparison, auto.mode).xpPerSecond,
      leaderboard: buildLeaderboard(comparisons),
    }
  }

  const best = bestComparisonForMode(comparisons, options.mode)
  if (!best) return null
  return {
    mode: options.mode,
    target: best.hostname,
    comparison: best,
    simulatedXpPerSecond: simResultForMode(best, options.mode).xpPerSecond,
    leaderboard: buildLeaderboard(comparisons),
  }
}

export function calculateHackGrindMaintenance(ns: NS, target: string, cores: number): HackGrindMaintenance {
  const server = ns.getServer(target)
  const player = ns.getPlayer()
  const prepared = serverAtMinSecurity(server)

  const hackPct = ns.formulas.hacking.hackPercent(prepared, player)
  const threadsForFullHack = Math.max(1, Math.ceil(1 / hackPct))
  const growThreads = 1
  const hackSecurity = ns.hackAnalyzeSecurity(threadsForFullHack, undefined)
  const growSecurity = ns.growthAnalyzeSecurity(growThreads, undefined, cores)
  const weakenPerThread = ns.weakenAnalyze(1, cores)
  const weakenThreads = Math.max(1, Math.ceil((hackSecurity + growSecurity) / weakenPerThread))

  return {
    threadsForFullHack,
    growThreads,
    weakenThreads,
    hackTime: ns.formulas.hacking.hackTime(prepared, player),
    growTime: ns.formulas.hacking.growTime(prepared, player),
    weakenTime: ns.formulas.hacking.weakenTime(prepared, player),
  }
}

export function copyGrindScripts(ns: NS, hosts: string[]): void {
  for (const host of hosts) {
    for (const script of GRIND_SCRIPTS) {
      ns.scp(script, host)
    }
  }
}

export function killGrindScripts(ns: NS, hosts: string[]): void {
  for (const host of hosts) {
    for (const script of GRIND_SCRIPTS) {
      ns.scriptKill(script, host)
    }
  }
}

function execGrindLoop(
  ns: NS,
  host: string,
  threads: number,
  target: string,
  op: GrindOp,
  staggerMs = 0
): number {
  if (threads <= 0) return 0
  const ramPerThread = ns.getScriptRam(GRIND_LOOP_SCRIPT)
  const maxThreads = Math.floor(getAvailableRam(ns, host) / ramPerThread)
  const actualThreads = Math.min(threads, maxThreads)
  if (actualThreads <= 0) return 0
  return ns.exec(GRIND_LOOP_SCRIPT, host, actualThreads, target, op, staggerMs)
}

export async function ensureTargetPrepared(
  ns: NS,
  nodes: string[],
  target: string,
  mode: HackGrindMode
): Promise<void> {
  const server = ns.getServer(target)
  const moneyMax = server.moneyMax ?? 0
  const minSecurity = server.minDifficulty ?? 0
  const currentMoney = server.moneyAvailable ?? 0
  const currentSecurity = server.hackDifficulty ?? 0

  const needsMoney = mode === "grow" ? currentMoney < moneyMax * MONEY_TOLERANCE : false
  const needsSecurity =
    currentSecurity > minSecurity + SECURITY_EPSILON ||
    (mode === "hack" && currentMoney > moneyMax * 0.01)

  if (!needsMoney && !needsSecurity) return

  await prepareServerMultiNode(ns, nodes, target, { dryRun: false })

  if (mode === "hack") {
    const player = ns.getPlayer()
    const prepared = serverAtMinSecurity(ns.getServer(target))
    const hackPct = ns.formulas.hacking.hackPercent(prepared, player)
    const drainThreads = Math.max(1, Math.ceil(0.99 / hackPct))
    const host = sortedNodesByRam(ns, nodes)[0]
    const hackRam = ns.getScriptRam(HACK_SCRIPT)
    const threads = Math.min(drainThreads, Math.floor(getAvailableRam(ns, host) / hackRam))
    if (threads > 0) {
      const pid = ns.exec(HACK_SCRIPT, host, threads, target, 0)
      if (pid > 0) {
        await ns.sleep(ns.formulas.hacking.hackTime(prepared, player) + 100)
      }
    }
  }
}

function deployFromPlan(
  ns: NS,
  nodes: string[],
  target: string,
  mode: Exclude<HackGrindMode, "auto">,
  cores: number
): number {
  const maintenance = mode === "hack" ? calculateHackGrindMaintenance(ns, target, cores) : null
  const nodesByRam = sortedNodesByRam(ns, nodes)
  const maintenanceHosts = [...nodesByRam].reverse()
  const available = new Map(nodes.map((host) => [host, getAvailableRam(ns, host)]))
  const ramPerThread = ns.getScriptRam(GRIND_LOOP_SCRIPT)
  let launched = 0

  const launch = (host: string, threads: number, op: GrindOp, staggerMs = 0) => {
    const freeRam = available.get(host) ?? 0
    const actualThreads = Math.min(threads, Math.floor(freeRam / ramPerThread))
    if (actualThreads <= 0) return
    if (execGrindLoop(ns, host, actualThreads, target, op, staggerMs) > 0) {
      available.set(host, freeRam - actualThreads * ramPerThread)
      launched += actualThreads
    }
  }

  if (mode === "weaken" || mode === "grow") {
    const op = mode
    for (const host of nodes) {
      const threads = Math.floor((available.get(host) ?? 0) / ramPerThread)
      launch(host, threads, op)
    }
    return launched
  }

  for (let i = 0; i < GROW_SCHEDULE_COUNT; i++) {
    const host = maintenanceHosts[i % maintenanceHosts.length]
    const staggerMs = maintenance ? (i * maintenance.growTime) / GROW_SCHEDULE_COUNT : 0
    launch(host, maintenance?.growThreads ?? 1, "grow", staggerMs)
  }

  const weakenThreadsPerLoop = maintenance
    ? Math.max(1, Math.ceil(maintenance.weakenThreads / WEAKEN_SCHEDULE_COUNT))
    : 1
  for (let i = 0; i < WEAKEN_SCHEDULE_COUNT; i++) {
    const host = maintenanceHosts[i % maintenanceHosts.length]
    const staggerMs = maintenance ? (i * maintenance.weakenTime) / WEAKEN_SCHEDULE_COUNT : 0
    launch(host, weakenThreadsPerLoop, "weaken", staggerMs)
  }

  for (const host of nodesByRam) {
    const threads = Math.floor((available.get(host) ?? 0) / ramPerThread)
    launch(host, threads, "hack")
  }

  return launched
}

export function deployWeakenGrind(ns: NS, nodes: string[], target: string, cores: number): number {
  return deployFromPlan(ns, nodes, target, "weaken", cores)
}

export function deployGrowGrind(ns: NS, nodes: string[], target: string, cores: number): number {
  return deployFromPlan(ns, nodes, target, "grow", cores)
}

export function deployHackGrind(ns: NS, nodes: string[], target: string, cores: number): number {
  return deployFromPlan(ns, nodes, target, "hack", cores)
}

export function countActiveGrindThreads(ns: NS, nodes: string[], target: string): {
  hack: number
  grow: number
  weaken: number
} {
  let hack = 0
  let grow = 0
  let weaken = 0

  for (const host of nodes) {
    for (const proc of ns.ps(host)) {
      if (proc.filename !== GRIND_LOOP_SCRIPT || proc.args[0] !== target) continue
      const op = String(proc.args[1] ?? "weaken")
      if (op === "hack") hack += proc.threads
      else if (op === "grow") grow += proc.threads
      else weaken += proc.threads
    }
  }

  return { hack, grow, weaken }
}

export function grindNeedsRedeploy(
  ns: NS,
  nodes: string[],
  plan: ActiveGrindPlan,
  cores: number
): boolean {
  const active = countActiveGrindThreads(ns, nodes, plan.target)
  const total = active.hack + active.grow + active.weaken
  if (total === 0) return true

  const expected = planGrindDeployment(ns, nodes, plan.target, plan.mode, cores)

  if (plan.mode === "weaken") return active.weaken < expected.weaken
  if (plan.mode === "grow") return active.grow < expected.grow

  return (
    active.hack < expected.hack ||
    active.grow < expected.grow ||
    active.weaken < expected.weaken
  )
}

export function totalWorkerRamGb(ns: NS, nodes: string[]): number {
  return nodes.reduce((sum, node) => sum + getAvailableRam(ns, node), 0)
}
