import { NS } from "@ns"
import {
  DARKNET_CRAWL_SCRIPT,
  DARKNET_LORE_FILE,
  DARKWEB,
  CONTROL_PORT,
  PORT_POOL_START,
  PORT_POOL_SIZE,
  LABYRINTH_MODEL_ID,
  safeGetServerDetails,
  tryConnectToSession,
  type CrawlHostReport,
  type CrawlStatusReport,
  type CrawlCacheOpen,
  type ControlMessage,
  type DarknetCrawlApi,
  type DarknetRegistry,
  type CrawlProgressHandler,
  type CrawlErrorHandler,
  type DarknetCrawlResult,
  type DarknetServerDetailsForFormulas,
  type WorkerResponse,
  type WorkerCommandPayload,
  type SolverState,
  type WorkerSnapshot,
  type SolverTiming,
} from "./config"
import {
  saveDarknetRegistry,
  pruneInvalidRegistryHosts,
  applyPasswordIntel,
} from "./registry"
import {
  copyCrawlScript,
  crawlWorkerArgs,
  finalizeArchiveContent,
  loadDarknetTextSet,
  syncDarknetTextFile,
} from "./worker"
import { estimateCommandMs, withCommandDeadline } from "./taskTiming.js"

// ---- control port sync ----

function syncControlPort(
  ns: NS,
  sessionId: number,
  lorePort: number,
): void {
  ns.clearPort(CONTROL_PORT)
  ns.writePort(CONTROL_PORT, JSON.stringify({
    sessionId,
    lorePort,
  } satisfies ControlMessage))
}

// ---- port message parsers ----

function parseCrawlStatus(raw: Record<string, unknown>): CrawlStatusReport | null {
  if (raw.type !== "status") return null
  if (typeof raw.workerHost !== "string" || typeof raw.targetHost !== "string") return null
  if (
    raw.phase !== "auth" &&
    raw.phase !== "heartbleed" &&
    raw.phase !== "probe" &&
    raw.phase !== "spawn" &&
    raw.phase !== "wait"
  ) return null
  if (typeof raw.etaMs !== "number" || !Number.isFinite(raw.etaMs)) return null
  return {
    type: "status",
    workerHost: raw.workerHost,
    targetHost: raw.targetHost,
    phase: raw.phase,
    etaMs: raw.etaMs,
    detail: typeof raw.detail === "string" ? raw.detail : null,
    authGuesses: typeof raw.authGuesses === "number" ? raw.authGuesses : undefined,
  }
}

function parseCrawlReport(raw: unknown): CrawlHostReport | null {
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
    if (typeof parsed !== "object" || parsed === null) return null
    const row = parsed as Record<string, unknown>
    if (row.type === "status" || row.type === "archive" || row.type === "cacheOpen") return null
    if (typeof row.hostname !== "string") return null
    if (row.authenticated !== true && row.authenticated !== false && row.authenticated !== null) return null
    const authGuesses =
      typeof row.authGuesses === "number" ? row.authGuesses
      : row.authGuesses === null ? null
      : undefined
    return {
      type: "host",
      hostname: row.hostname,
      authenticated: row.authenticated,
      password: typeof row.password === "string" || row.password === null ? row.password : null,
      authGuesses,
    }
  } catch { return null }
}

function parseCacheOpen(row: Record<string, unknown>): CrawlCacheOpen | null {
  if (row.type !== "cacheOpen") return null
  if (typeof row.host !== "string" || typeof row.file !== "string" || typeof row.message !== "string") return null
  if (typeof row.karmaLoss !== "number" || !Number.isFinite(row.karmaLoss)) return null
  return {
    host: row.host,
    file: row.file,
    message: row.message,
    karmaLoss: row.karmaLoss,
    openedAt: typeof row.openedAt === "number" && Number.isFinite(row.openedAt) ? row.openedAt : Date.now(),
  }
}

// ---- worker response parser ----

function parseWorkerResponse(raw: unknown): WorkerResponse | null {
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
    if (typeof parsed !== "object" || parsed === null) return null
    const row = parsed as Record<string, unknown>

    switch (row.type) {
      case "ready": {
        if (typeof row.workerHost !== "string" || typeof row.pid !== "number") return null
        return { type: "ready", workerHost: row.workerHost, pid: row.pid }
      }
      case "executing": {
        if (typeof row.workerHost !== "string" || typeof row.commandType !== "string") return null
        return {
          type: "executing",
          workerHost: row.workerHost,
          commandType: row.commandType,
          deadlineAt: typeof row.deadlineAt === "number" ? row.deadlineAt : 0,
        }
      }
      case "guessResult": {
        if (typeof row.target !== "string" || typeof row.solverId !== "string") return null
        if (typeof row.success !== "boolean") return null
        return {
          type: "guessResult",
          target: row.target,
          solverId: row.solverId,
          success: row.success,
          feedback: typeof row.feedback === "string" ? row.feedback : undefined,
          message: typeof row.message === "string" ? row.message : undefined,
        }
      }
      case "heartbleedResult": {
        if (typeof row.target !== "string" || typeof row.solverId !== "string") return null
        if (!Array.isArray(row.logEntries)) return null
        if (row.logEntries.some((e: unknown) => typeof e !== "string")) return null
        return {
          type: "heartbleedResult",
          target: row.target,
          solverId: row.solverId,
          logEntries: row.logEntries as string[],
        }
      }
      case "labreportResult": {
        if (typeof row.target !== "string" || typeof row.solverId !== "string") return null
        if (!Array.isArray(row.coords)) return null
        if (typeof row.north !== "boolean" || typeof row.east !== "boolean" ||
            typeof row.south !== "boolean" || typeof row.west !== "boolean") return null
        return {
          type: "labreportResult",
          target: row.target,
          solverId: row.solverId,
          coords: row.coords as number[],
          north: row.north, east: row.east,
          south: row.south, west: row.west,
        }
      }
      case "probeResult": {
        if (typeof row.workerHost !== "string") return null
        if (!Array.isArray(row.targets) || typeof row.freeRam !== "number") return null
        return {
          type: "probeResult",
          workerHost: row.workerHost,
          targets: row.targets as string[],
          freeRam: row.freeRam,
          blockedRam: typeof row.blockedRam === "number" ? row.blockedRam : 0,
        }
      }
      case "spawnResult": {
        if (typeof row.workerHost !== "string" || typeof row.target !== "string") return null
        if (typeof row.success !== "boolean") return null
        return {
          type: "spawnResult",
          workerHost: row.workerHost,
          target: row.target,
          success: row.success,
          childPid: typeof row.childPid === "number" ? row.childPid : 0,
        }
      }
      case "reallocResult": {
        if (typeof row.workerHost !== "string") return null
        if (typeof row.freeRam !== "number" || typeof row.blockedRam !== "number") return null
        return {
          type: "reallocResult",
          workerHost: row.workerHost,
          freeRam: row.freeRam,
          blockedRam: row.blockedRam,
        }
      }
      case "stasisResult": {
        if (typeof row.workerHost !== "string" || typeof row.success !== "boolean") return null
        return { type: "stasisResult", workerHost: row.workerHost, success: row.success }
      }
      default: return null
    }
  } catch { return null }
}

// ---- port processing ----

function applyCrawlPortMessage(
  ns: NS,
  raw: unknown,
  reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>,
  cacheOpens: CrawlCacheOpen[],
  sessionId: number,
  registry?: DarknetRegistry
): void {
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
    if (typeof parsed !== "object" || parsed === null) return
    const row = parsed as Record<string, unknown>

    const cacheOpen = parseCacheOpen(row)
    if (cacheOpen) { cacheOpens.push(cacheOpen); return }
    if (row.type === "archive" && typeof row.file === "string" && typeof row.content === "string") {
      finalizeArchiveContent(ns, row.file, row.content)
      return
    }
    if (row.type === "passwordIntel" && registry) {
      applyPasswordIntel(registry, parsed)
      return
    }
    const status = parseCrawlStatus(row)
    if (status) { activeOps.set(status.workerHost, status); return }
    const report = parseCrawlReport(parsed)
    if (!report) return
    const existing = reports.get(report.hostname)
    reports.set(report.hostname, {
      hostname: report.hostname,
      authenticated: report.authenticated,
      password: report.password,
      authGuesses: report.authGuesses ?? existing?.authGuesses ?? null,
    })
    for (const [workerHost, op] of activeOps) {
      if (op.targetHost === report.hostname && (op.phase === "auth" || op.phase === "heartbleed")) {
        activeOps.delete(workerHost)
      }
    }
  } catch { /* ignore malformed */ }
}

function drainCrawlPort(
  ns: NS,
  workerRegistry: Map<string, WorkerInfo>,
  reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>,
  cacheOpens: CrawlCacheOpen[],
  sessionId: number,
  registry?: DarknetRegistry,
): void {
  for (const [, wi] of workerRegistry) {
    const port = wi.replyPort
    if (port <= 0) continue
    while (true) {
      const raw = ns.readPort(port)
      if (raw === "NULL PORT DATA") break
      applyCrawlPortMessage(ns, raw, reports, activeOps, cacheOpens, sessionId, registry)
    }
  }
}

function pollCrawlPort(
  ns: NS,
  workerRegistry: Map<string, WorkerInfo>,
  reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>,
  cacheOpens: CrawlCacheOpen[],
  sessionId: number,
  registry?: DarknetRegistry,
): void {
  for (const [, wi] of workerRegistry) {
    const port = wi.replyPort
    if (port <= 0) continue
    while (true) {
      const raw = ns.peek(port)
      if (raw === "NULL PORT DATA") break
      ns.readPort(port)
      applyCrawlPortMessage(ns, raw, reports, activeOps, cacheOpens, sessionId, registry)
    }
  }
}

function pollTextPort(ns: NS, port: number, textSet: Set<string>, file: string): void {
  while (true) {
    const raw = ns.peek(port)
    if (raw === "NULL PORT DATA") break
    ns.readPort(port)
    if (typeof raw !== "string") continue
    if (textSet.has(raw)) continue
    textSet.add(raw)
    syncDarknetTextFile(ns, file, textSet)
  }
}

function drainTextPort(ns: NS, port: number, textSet: Set<string>, file: string): void {
  while (true) {
    const raw = ns.readPort(port)
    if (raw === "NULL PORT DATA") break
    if (typeof raw !== "string") continue
    if (textSet.has(raw)) continue
    textSet.add(raw)
    syncDarknetTextFile(ns, file, textSet)
  }
}

// ---- worker registry ----

interface WorkerInfo {
  pid: number
  port: number       // command port (even) — master writes commands here
  replyPort: number  // reply port (odd = port + 1) — worker writes responses here
  neighbors: string[]
  freeRam: number
  blockedRam: number
  probed: boolean
  idle: boolean
  lastCommand: string | null
  lastCommandDetail: string | null // guess password, spawn target, etc.
  lastCommandAt: number
  lastReply: string | null
  lastReplyAt: number
  lastProbedAt: number
  failures: number
  commandDeadlineAt: number // absolute ms; 0 when idle
}

// ---- port pool ----

let _portPool: number[] | null = null

function initPortPool(): number[] {
  const pool: number[] = []
  // Step by 2: each worker uses a pair (command = even, reply = odd = command+1)
  for (let i = 0; i < PORT_POOL_SIZE * 2; i += 2) {
    pool.push(PORT_POOL_START + i)
  }
  return pool
}

function allocatePort(): number {
  if (!_portPool) _portPool = initPortPool()
  const port = _portPool.shift()
  if (port === undefined) throw new Error("No free ports in pool (all 512 pairs in use)")
  return port
}

function freePort(port: number): void {
  if (!_portPool) _portPool = initPortPool()
  _portPool.push(port)
}

// ---- target state ----

interface TargetState {
  hostname: string
  details: DarknetServerDetailsForFormulas
  solverState: SolverState
  done: boolean
  password: string | null
  pendingGuess: string | null
  pendingWorker: string | null
  pendingAt: number
  startedAt: number
}

// ---- labyrinth stasis ----

function isLabyrinthHost(dnet: DarknetCrawlApi, hostname: string): boolean {
  const details = safeGetServerDetails(dnet, hostname)
  return details?.modelId === LABYRINTH_MODEL_ID
}

function collectLabyrinthHosts(
  dnet: DarknetCrawlApi,
  workerRegistry: Map<string, WorkerInfo>,
  reports: Map<string, CrawlHostReport>,
): Set<string> {
  const labs = new Set<string>()
  const maybeAdd = (hostname: string): void => {
    if (isLabyrinthHost(dnet, hostname)) labs.add(hostname)
  }
  for (const [hostname] of workerRegistry) maybeAdd(hostname)
  for (const [hostname] of reports) maybeAdd(hostname)
  for (const [, wi] of workerRegistry) {
    for (const neighbor of wi.neighbors) maybeAdd(neighbor)
  }
  return labs
}

function labyrinthNeighborHosts(
  labyrinthHosts: Set<string>,
  workerRegistry: Map<string, WorkerInfo>,
): string[] {
  if (labyrinthHosts.size === 0) return []
  const neighbors = new Set<string>()
  for (const [host, wi] of workerRegistry) {
    if (!wi.probed || labyrinthHosts.has(host)) continue
    for (const neighbor of wi.neighbors) {
      if (labyrinthHosts.has(neighbor)) neighbors.add(host)
    }
  }
  return [...neighbors].sort()
}

/** Apply stasis links on authenticated lab neighbors while seats remain. */
function dispatchLabyrinthStasis(
  ns: NS,
  dnet: DarknetCrawlApi,
  workerRegistry: Map<string, WorkerInfo>,
  reports: Map<string, CrawlHostReport>,
): void {
  if (!dnet.setStasisLink || !dnet.getStasisLinkLimit || !dnet.getStasisLinkedServers) return

  const linked = new Set(dnet.getStasisLinkedServers())
  let seats = dnet.getStasisLinkLimit() - linked.size
  if (seats <= 0) return

  const labyrinthHosts = collectLabyrinthHosts(dnet, workerRegistry, reports)
  const candidates = labyrinthNeighborHosts(labyrinthHosts, workerRegistry)
    .filter((host) => !linked.has(host))

  for (const host of candidates) {
    if (seats <= 0) break
    const wi = workerRegistry.get(host)
    if (!wi || !wi.idle || !wi.probed) continue
    const report = reports.get(host)
    if (report?.authenticated !== true) continue
    sendWorkerCommand(ns, dnet, wi, { type: "stasis" })
    seats--
  }
}

// ---- task dispatch ----

const WORKER_MAX_RETRIES = 3 // give up on a worker after this many timeouts
const PROBE_INTERVAL_MS = 3_000 // re-probe idle workers every 3s
/** Fallback when commandDeadlineAt was not set (should not happen in normal operation). */
const WORKER_CMD_FALLBACK_TIMEOUT_MS = 30_000

function sendWorkerCommand(
  ns: NS,
  dnet: DarknetCrawlApi,
  wi: WorkerInfo,
  payload: WorkerCommandPayload,
  now = Date.now(),
): void {
  const command = withCommandDeadline(payload, estimateCommandMs(ns, dnet, payload), now)
  ns.writePort(wi.port, JSON.stringify(command))
  wi.lastCommand = command.type
  wi.lastCommandDetail =
    command.type === "guess" ? command.guess
    : command.type === "spawn" ? command.target
    : command.type === "heartbleed" ? command.target
    : command.type === "labreport" ? command.target
    : null
  wi.lastCommandAt = now
  wi.commandDeadlineAt = command.deadlineAt
  wi.lastReply = null
  wi.idle = false
}

function markWorkerIdle(wi: WorkerInfo, reply: string | null, now: number): void {
  wi.idle = true
  wi.commandDeadlineAt = 0
  if (reply !== null) {
    wi.lastReply = reply
    wi.lastReplyAt = now
  }
}

// ---- solver web worker ----

let _solverWorker: Worker | null = null
let _solverWorkerMsgId = 0
const _solverWorkerPromises = new Map<number, (data: Record<string, unknown>) => void>()

function callSolverWorker(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
  const w = _solverWorker
  if (!w) return Promise.resolve({ error: "no worker" })
  return new Promise((resolve) => {
    const id = ++_solverWorkerMsgId
    _solverWorkerPromises.set(id, resolve)
    w.postMessage({ id, ...msg })
  })
}

async function workerInitSolver(details: DarknetServerDetailsForFormulas): Promise<SolverState | null> {
  const resp = await callSolverWorker({ type: "initSolver", details })
  if (resp.error) return null
  return resp.state as SolverState
}

async function workerNextGuess(state: SolverState, hostname: string, details: DarknetServerDetailsForFormulas): Promise<{ state: SolverState; next: { guess: string; detail: string | null } | null }> {
  const resp = await callSolverWorker({ type: "nextGuess", state, target: hostname, details })
  return { state: (resp.state as SolverState) ?? state, next: resp.next as { guess: string; detail: string | null } | null }
}

async function workerApplyResult(state: SolverState, guess: string, result: { success: boolean; feedback?: string; message?: string }): Promise<SolverState> {
  const resp = await callSolverWorker({ type: "applyResult", state, guess, result })
  return (resp.state as SolverState) ?? state
}

async function workerApplyHeartbleed(state: SolverState, logEntries: string[]): Promise<SolverState> {
  const resp = await callSolverWorker({ type: "applyHeartbleed", state, logEntries })
  return (resp.state as SolverState) ?? state
}

async function workerApplyLabreport(state: SolverState, report: { coords: number[]; north: boolean; east: boolean; south: boolean; west: boolean }): Promise<SolverState> {
  const resp = await callSolverWorker({ type: "applyLabreport", state, report })
  return (resp.state as SolverState) ?? state
}

async function drainReportPort(
  ns: NS,
  targetStates: Map<string, TargetState>,
  solverTimings: Map<string, { count: number; totalMs: number }>,
  workerRegistry: Map<string, WorkerInfo>,
  spawning: Set<string>,
  reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>,
  cacheOpens: CrawlCacheOpen[],
  sessionId: number,
  registry?: DarknetRegistry,
): Promise<void> {
  for (const [, wi] of workerRegistry) {
    const port = wi.replyPort
    if (port <= 0) continue
    while (true) {
      const raw = ns.readPort(port)
      if (raw === "NULL PORT DATA") break
    try {
      const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
      if (typeof parsed !== "object" || parsed === null) continue

      // Worker responses (new)
      const workerResp = parseWorkerResponse(parsed)
      if (workerResp) {
        const now = Date.now()

        if (workerResp.type === "executing") {
          const wi = workerRegistry.get(workerResp.workerHost)
          if (wi) {
            wi.lastReply = `executing:${workerResp.commandType}`
            wi.lastReplyAt = now
            wi.failures = 0
          }
          continue
        }

        if (workerResp.type === "ready") {
          const existingWi = workerRegistry.get(workerResp.workerHost)
          if (existingWi) {
            existingWi.pid = workerResp.pid
            existingWi.idle = true
            existingWi.commandDeadlineAt = 0
            existingWi.lastReply = "ready"
            existingWi.lastReplyAt = now
            existingWi.failures = 0
          }
          continue
        }

        if (workerResp.type === "probeResult") {
          const existingWi = workerRegistry.get(workerResp.workerHost)
          const wi: WorkerInfo = existingWi ?? { pid: 0, port: 0, replyPort: 0, neighbors: [], freeRam: 0, blockedRam: 0, probed: false, idle: false, lastCommand: null, lastCommandDetail: null, lastCommandAt: 0, lastReply: null, lastReplyAt: 0, lastProbedAt: 0, failures: 0, commandDeadlineAt: 0 }
          if (!existingWi) workerRegistry.set(workerResp.workerHost, wi)
          wi.neighbors = workerResp.targets
          wi.freeRam = workerResp.freeRam
          wi.blockedRam = workerResp.blockedRam
          wi.probed = true
          wi.lastProbedAt = now
          wi.failures = 0
          markWorkerIdle(wi, "probeResult", now)
          continue
        }

        if (workerResp.type === "spawnResult") {
          const parentWi = workerRegistry.get(workerResp.workerHost)
          if (parentWi) {
            parentWi.failures = 0
            markWorkerIdle(parentWi, workerResp.success ? "spawnResult:ok" : "spawnResult:fail", now)
          }

          spawning.delete(workerResp.target)
          if (workerResp.success) {
            const childWi = workerRegistry.get(workerResp.target)
            if (childWi) {
              childWi.pid = workerResp.childPid
              childWi.idle = true
              childWi.commandDeadlineAt = 0
            }
          } else {
            const targetWi = workerRegistry.get(workerResp.target)
            if (targetWi) {
              freePort(targetWi.port)
              workerRegistry.delete(workerResp.target)
            }
            // Remove authenticated report for the target so the spawn section
            // doesn't immediately re-dispatch (would cause an infinite retry loop).
            // The target will be re-reported the next time a neighbor re-probes.
            const report = reports.get(workerResp.target)
            if (report?.authenticated === true) {
              reports.delete(workerResp.target)
            }
          }
          continue
        }

        if (workerResp.type === "reallocResult") {
          const wi = workerRegistry.get(workerResp.workerHost)
          if (wi) {
            wi.freeRam = workerResp.freeRam
            wi.blockedRam = workerResp.blockedRam
            wi.failures = 0
            markWorkerIdle(wi, "reallocResult", now)
          }
          continue
        }

        if (workerResp.type === "stasisResult") {
          const wi = workerRegistry.get(workerResp.workerHost)
          if (wi) {
            wi.failures = 0
            markWorkerIdle(wi, workerResp.success ? "stasisResult:ok" : "stasisResult:fail", now)
          }
          continue
        }

        // guessResult / heartbleedResult / labreportResult
        if (workerResp.type === "guessResult" && workerResp.message === "notNeighbor") {
          // Worker cannot reach the target (stale probe data). Clear pending
          // without advancing solver state so the guess is retried on a capable worker.
          const target = targetStates.get(workerResp.target)
          if (target) {
            const completedWorker = target.pendingWorker
            target.pendingGuess = null
            target.pendingWorker = null
            if (completedWorker) {
              const wi = workerRegistry.get(completedWorker)
              if (wi) {
                wi.failures = 0
                markWorkerIdle(wi, "notNeighbor", Date.now())
              }
            }
          }
          continue
        }
        await applyTaskResult(workerResp, targetStates, solverTimings, workerRegistry)
        continue
      }

      // Legacy crawl messages (archive, passwordIntel, host/status reports)
      applyCrawlPortMessage(ns, parsed, reports, activeOps, cacheOpens, sessionId, registry)
    } catch { /* malformed */ }
    }
  }
}

async function applyTaskResult(
  result: WorkerResponse & { type: "guessResult" | "heartbleedResult" | "labreportResult" },
  targetStates: Map<string, TargetState>,
  solverTimings: Map<string, { count: number; totalMs: number }>,
  workerRegistry: Map<string, WorkerInfo>,
): Promise<void> {
  const target = targetStates.get(result.target)
  if (!target) return
  if ((target.solverState as unknown as Record<string, unknown>).type !== result.solverId) return

  const dispatchedGuess = target.pendingGuess
  const completedWorker = target.pendingWorker
  target.pendingGuess = null
  target.pendingWorker = null

  // Accumulate timing for this solver step
  if (target.pendingAt > 0) {
    const elapsed = Date.now() - target.pendingAt
    const id = (target.solverState as unknown as Record<string, unknown>).type as string
    let t = solverTimings.get(id)
    if (!t) { t = { count: 0, totalMs: 0 }; solverTimings.set(id, t) }
    t.count++
    t.totalMs += elapsed
  }

  // Mark the worker idle again with reply tracking
  if (completedWorker) {
    const wi = workerRegistry.get(completedWorker)
    if (wi) {
      wi.failures = 0
      markWorkerIdle(wi, result.type, Date.now())
    }
  }

  if (result.type === "guessResult") {
    if (result.success) {
      target.done = true
      target.password = result.feedback || dispatchedGuess
      return
    }
    target.solverState = await workerApplyResult(
      target.solverState,
      dispatchedGuess ?? "",
      { success: false, feedback: result.feedback, message: result.message },
    )
  } else if (result.type === "heartbleedResult") {
    target.solverState = await workerApplyHeartbleed(target.solverState, result.logEntries)
  } else if (result.type === "labreportResult") {
    target.solverState = await workerApplyLabreport(target.solverState, {
      coords: result.coords,
      north: result.north, east: result.east,
      south: result.south, west: result.west,
    })
  }
}

function handleWorkerTimeouts(
  ns: NS,
  workerRegistry: Map<string, WorkerInfo>,
  spawning: Set<string>,
): void {
  const now = Date.now()
  for (const [workerHost, wi] of workerRegistry) {
    // Primary liveness check: if we know the PID, verify the script is still running
    if (wi.pid > 0 && !ns.isRunning(wi.pid)) {
      freePort(wi.port)
      spawning.delete(workerHost)
      workerRegistry.delete(workerHost)
      continue
    }

    if (wi.idle) continue

    const deadline = wi.commandDeadlineAt > 0
      ? wi.commandDeadlineAt
      : wi.lastCommandAt + WORKER_CMD_FALLBACK_TIMEOUT_MS
    if (now < deadline) continue

    wi.failures++
    if (wi.failures > WORKER_MAX_RETRIES) {
      // Worker appears dead — remove from registry, free its port
      freePort(wi.port)
      spawning.delete(workerHost)
      workerRegistry.delete(workerHost)
      continue
    }
    // Retry: mark idle, the loop will send probe/auth again
    markWorkerIdle(wi, "timeout", now)
  }
}

async function dispatchTasks(
  ns: NS,
  dnet: DarknetCrawlApi,
  targetStates: Map<string, TargetState>,
  workerRegistry: Map<string, WorkerInfo>,
): Promise<void> {
  const now = Date.now()

  // Timeout stale pending guesses when the assigned worker missed its deadline
  for (const [, target] of targetStates) {
    if (target.done) continue
    if (!target.pendingGuess || !target.pendingWorker) continue
    const wi = workerRegistry.get(target.pendingWorker)
    if (!wi || wi.idle) continue
    const deadline = wi.commandDeadlineAt > 0
      ? wi.commandDeadlineAt
      : (target.pendingAt ?? wi.lastCommandAt) + WORKER_CMD_FALLBACK_TIMEOUT_MS
    if (now < deadline) continue
    markWorkerIdle(wi, "timeout", now)
    target.pendingGuess = null
    target.pendingWorker = null
  }

  // Build reverse index: worker -> targets it can reach (from neighbor sets)
  const workerReach: Map<string, Set<string>> = new Map()
  for (const [workerHost, wi] of workerRegistry) {
    if (!wi.probed || !wi.idle) continue
    for (const t of wi.neighbors) {
      let s = workerReach.get(workerHost)
      if (!s) { s = new Set(); workerReach.set(workerHost, s) }
      s.add(t)
    }
  }

  // Collect all targets that need nextGuess, dispatch them in parallel via worker
  const pending: { hostname: string; target: TargetState }[] = []
  for (const [hostname, target] of targetStates) {
    if (target.done || target.pendingGuess !== null) continue
    pending.push({ hostname, target })
  }

  if (pending.length > 0 && _solverWorker) {
    const results = await Promise.all(pending.map(({ hostname, target }) =>
      workerNextGuess(target.solverState, hostname, target.details).then(
        ({ state, next }) => {
          target.solverState = state
          return { hostname, target, next }
        }
      )
    ))

    for (const { hostname, target, next } of results) {
      if (!next) {
        const s = target.solverState as unknown as Record<string, unknown>
        if (s.phase === "labreport" || (s.phase === "move" && !s.coords)) {
          for (const [workerHost, reach] of workerReach) {
            if (reach.has(hostname)) {
              const wi = workerRegistry.get(workerHost)!
              const solverId = (target.solverState as unknown as Record<string, unknown>).type as string
              sendWorkerCommand(ns, dnet, wi, { type: "labreport", target: hostname, solverId })
              target.pendingGuess = "labreport"
              target.pendingWorker = workerHost
              target.pendingAt = now
              break
            }
          }
          continue
        }

        if (s.needsRecheck === true) continue

        target.done = true
        target.pendingGuess = "EXHAUSTED"
        continue
      }

      for (const [workerHost, reach] of workerReach) {
        if (reach.has(hostname)) {
          const wi = workerRegistry.get(workerHost)!
          const taskType: "guess" | "heartbleed" =
            next.detail?.startsWith("heartbleed") ? "heartbleed" : "guess"

          if (next.detail?.startsWith("labreport")) {
            const solverId = (target.solverState as unknown as Record<string, unknown>).type as string
            sendWorkerCommand(ns, dnet, wi, { type: "labreport", target: hostname, solverId })
          } else {
            const solverId = (target.solverState as unknown as Record<string, unknown>).type as string
            sendWorkerCommand(ns, dnet, wi, { type: taskType, target: hostname, solverId, guess: next.guess, detail: next.detail })
          }

          target.pendingGuess = next.guess
          target.pendingWorker = workerHost
          target.pendingAt = now
          break
        }
      }
    }
  }
}

async function registerTarget(
  targetStates: Map<string, TargetState>,
  dnet: DarknetCrawlApi,
  hostname: string,
): Promise<void> {
  if (targetStates.has(hostname)) return
  const details = dnet.getServerDetails(hostname)
  if (!details || details.hasSession || !_solverWorker) return

  let solverState = await workerInitSolver(details)
  if (!solverState) return

  targetStates.set(hostname, {
    hostname,
    details,
    solverState,
    done: false,
    password: null,
    pendingGuess: null,
    pendingWorker: null,
    pendingAt: 0,
    startedAt: Date.now(),
  })
}

// ---- worker management ----

async function authenticateDarkwebEntry(
  ns: NS,
  dnet: DarknetCrawlApi,
  cachedPassword: string | null | undefined,
): Promise<void> {
  if (cachedPassword != null) {
    const cached = await dnet.authenticate(DARKWEB, cachedPassword)
    if (cached.success) return
  }
  // Darkweb is always ZeroLogon: single character, numeric, password "0"
  try { await dnet.authenticate(DARKWEB, "0") } catch { /* not fatal */ }
  // If that failed, try connecting with no password (some game configs)
  tryConnectToSession(dnet, DARKWEB, "")
}

async function launchDarkwebCrawlWorker(
  ns: NS, source: string, sessionId: number, commandPort: number,
): Promise<number> {
  try { ns.scriptKill(DARKNET_CRAWL_SCRIPT, DARKWEB) } catch { /* ignore */ }
  await copyCrawlScript(ns, DARKWEB, source)
  const workerRam = ns.getScriptRam(DARKNET_CRAWL_SCRIPT, DARKWEB)
  const freeRam = ns.getServerMaxRam(DARKWEB) - ns.getServerUsedRam(DARKWEB)
  if (workerRam > freeRam) {
    throw new Error(
      `Not enough RAM on ${DARKWEB} for ${DARKNET_CRAWL_SCRIPT} (need ${ns.format.ram(workerRam)}, free ${ns.format.ram(freeRam)})`
    )
  }
  const pid = ns.exec(DARKNET_CRAWL_SCRIPT, DARKWEB, 1, ...crawlWorkerArgs(sessionId, commandPort))
  if (pid === 0) throw new Error(`Could not exec ${DARKNET_CRAWL_SCRIPT} on ${DARKWEB}`)
  return pid
}

function crawlWorkerHosts(ns: NS, registry?: DarknetRegistry): string[] {
  const hosts = new Set<string>([ns.getHostname(), DARKWEB])
  if (registry) {
    for (const hostname of Object.keys(registry.servers)) { hosts.add(hostname) }
  }
  return [...hosts]
}

async function killCrawlWorkersOnHost(
  ns: NS, dnet: DarknetCrawlApi, host: string, password: string | null | undefined,
): Promise<void> {
  if (host !== ns.getHostname() && password != null) {
    tryConnectToSession(dnet, host, password)
  }
  try { ns.scriptKill(DARKNET_CRAWL_SCRIPT, host) } catch { /* no access */ }
}

export async function killAllCrawlWorkers(
  ns: NS, dnet: DarknetCrawlApi, registry?: DarknetRegistry,
): Promise<void> {
  for (const host of crawlWorkerHosts(ns, registry)) {
    await killCrawlWorkersOnHost(ns, dnet, host, registry?.servers[host]?.password ?? null)
  }
}

// ---- master entry ----

export async function runDarknetCrawl(
  ns: NS,
  dnet: DarknetCrawlApi,
  lorePort: number,
  onProgress?: CrawlProgressHandler,
  registry?: DarknetRegistry,
  intervalMs = 0,
  onWorkerError?: CrawlErrorHandler,
  killOnly = false,
): Promise<DarknetCrawlResult> {
  const source = ns.getHostname()

  // ---- kill-only mode ----
  if (killOnly) {
    syncControlPort(ns, 0, 0)

    const reports = new Map<string, CrawlHostReport>()
    const activeOps = new Map<string, CrawlStatusReport>()
    const cacheOpens: CrawlCacheOpen[] = []
    const loreSet = loadDarknetTextSet(ns, DARKNET_LORE_FILE)

    const emitProgress = async (workerRunning: boolean): Promise<void> => {
      if (!onProgress) return
      await onProgress({ reports, activeOps: [...activeOps.values()], workerRunning, cacheOpens, workers: [], solverTimings: [] })
    }

    await killAllCrawlWorkers(ns, dnet, registry)
    await emitProgress(true)

    while (true) {
      await ns.sleep(1000)
      await killAllCrawlWorkers(ns, dnet, registry)
      pollTextPort(ns, lorePort, loreSet, DARKNET_LORE_FILE)
      await emitProgress(activeOps.size > 0)
      const hosts = crawlWorkerHosts(ns, registry)
      let anyRunning = false
      for (const host of hosts) {
        try { if (ns.isRunning(DARKNET_CRAWL_SCRIPT, host)) { anyRunning = true; break } } catch { /* offline */ }
      }
      if (!anyRunning) break
    }

    return { reports, cacheOpens }
  }

  // ---- normal operation ----
  const continuous = intervalMs > 0
  let sessionId = Date.now()
  // Reset port pool on each run
  _portPool = null

  if (registry) {
    pruneInvalidRegistryHosts(dnet, registry)
    saveDarknetRegistry(ns, registry)
  }

  await authenticateDarkwebEntry(ns, dnet, registry?.servers[DARKWEB]?.password)
  await killAllCrawlWorkers(ns, dnet, registry)
  await ns.sleep(5000)

  ns.clearPort(lorePort)
  // Clear all pool ports, both even (command) and odd (reply)
  for (let i = 0; i < PORT_POOL_SIZE; i++) {
    ns.clearPort(PORT_POOL_START + i * 2)     // even command ports
    ns.clearPort(PORT_POOL_START + i * 2 + 1) // odd reply ports
  }

  syncControlPort(ns, sessionId, lorePort)

  // Register atExit: write exit command to all workers when master terminates.
  // Do this BEFORE launching any workers so the callback captures workerRegistry.
  ns.atExit(() => {
    for (const [, wi] of workerRegistry) {
      try {
        ns.writePort(wi.port, JSON.stringify(withCommandDeadline({ type: "exit" }, 100)))
      } catch { /* port may be gone */ }
    }
  })

  const loreSet = loadDarknetTextSet(ns, DARKNET_LORE_FILE)

  // Allocate a port for the initial darkweb worker
  const darkwebPort = allocatePort()
  const workerRegistry = new Map<string, WorkerInfo>()
  workerRegistry.set(DARKWEB, { pid: 0, port: darkwebPort, replyPort: darkwebPort + 1, neighbors: [], freeRam: 0, blockedRam: 0, probed: false, idle: true, lastCommand: null, lastCommandDetail: null, lastCommandAt: 0, lastReply: null, lastReplyAt: 0, lastProbedAt: 0, failures: 0, commandDeadlineAt: 0 })
  const spawning = new Set<string>() // hosts with spawn commands in flight

  let pid = await launchDarkwebCrawlWorker(ns, source, sessionId, darkwebPort)
  workerRegistry.get(DARKWEB)!.pid = pid

  // Create solver web worker once at startup (outside the loop).
  // Pattern from contractSolver.ts, but since solverWorker.js has ES module
  // imports (Vite compiles each file individually, not as a standalone bundle),
  // we assemble the full worker code by reading all dependencies and wrapping
  // them as a single classic Worker script (no import/export in Blob URLs).
  try {
    const configRaw = ns.read("darknet/config.js")
    const solverRaw = ns.read("darknet/solverState.js")
    const workerRaw = ns.read("darknet/solverWorker.js")
    if (configRaw && solverRaw && workerRaw) {
      // Strip import/export declarations so the code can run as a classic script.
      // "import { ... } from '...'" → removed
      // "import type { ... } from '...'" → removed
      // "export function" → "function"
      // "export const" → "const"
      // "export { ... }" → removed
      // "export type { ... }" → removed
      const stripModule = (code: string): string => {
        return code
          .replace(/^import\s+type\s*\{[^}]*\}\s*from\s*['"].*?['"]\s*;?\s*$/gm, "")
          .replace(/^import\s+\{[^}]*\}\s*from\s*['"].*?['"]\s*;?\s*$/gm, "")
          .replace(/^import\s+['"].*?['"]\s*;?\s*$/gm, "")
          .replace(/^export\s+type\s*\{[^}]*\}\s*;?\s*$/gm, "")
          .replace(/^export\s+\{[^}]*\}\s*;?\s*$/gm, "")
          .replace(/^export\s+(default\s+)?(function|const|let|var|class|async\s+function)\b/gm, "$2")
          .replace(/^export\s+(default\s+)?(interface|type)\b/gm, "$2")
      }
      const fullCode = stripModule(configRaw) + "\n" + stripModule(solverRaw) + "\n" + stripModule(workerRaw)
      if (fullCode.length > 200) {
        const blobUrl = URL.createObjectURL(new Blob([fullCode], { type: "text/javascript" }))
        _solverWorker = new Worker(blobUrl)
        _solverWorker.onmessage = (e: MessageEvent) => {
          const data = e.data as { id: number } & Record<string, unknown>
          const resolve = _solverWorkerPromises.get(data.id)
          if (resolve) { _solverWorkerPromises.delete(data.id); resolve(data) }
        }
      }
    }
  } catch { /* worker unavailable — solver calls become no-ops */ }

  // Task orchestration state
  const targetStates = new Map<string, TargetState>()
  const solverTimings = new Map<string, { count: number; totalMs: number }>()

  const reports = new Map<string, CrawlHostReport>()
  const activeOps = new Map<string, CrawlStatusReport>()
  const cacheOpens: CrawlCacheOpen[] = []

  const emitProgress = async (workerRunning: boolean): Promise<void> => {
    if (!onProgress) return
    const now = Date.now()
    const workers: WorkerSnapshot[] = []
    for (const [hostname, wi] of workerRegistry) {
      workers.push({
        host: hostname,
        probed: wi.probed,
        idle: wi.idle,
        lastCommand: wi.lastCommand,
        lastCommandDetail: wi.lastCommandDetail,
        lastCommandAt: wi.lastCommandAt,
        lastReply: wi.lastReply,
        lastReplyAt: wi.lastReplyAt,
        freeRam: wi.freeRam,
        blockedRam: wi.blockedRam,
        neighbors: wi.neighbors,
      })
    }
    workers.sort((a, b) => a.host.localeCompare(b.host))
    const timings: SolverTiming[] = []
    for (const [solverId, t] of solverTimings) {
      timings.push({ solverId, count: t.count, totalMs: t.totalMs })
    }
    timings.sort((a, b) => b.totalMs - a.totalMs)
    await onProgress({ reports, activeOps: [...activeOps.values()], workerRunning, cacheOpens, workers, solverTimings: timings })
  }

  await emitProgress(true)

  if (continuous) {
    while (true) {
      await drainReportPort(ns, targetStates, solverTimings, workerRegistry, spawning, reports, activeOps, cacheOpens, sessionId, registry)
      pollTextPort(ns, lorePort, loreSet, DARKNET_LORE_FILE)

      // Register new unauthenticated targets from worker reports + dispatch spawns for authenticated neighbors
      for (const [hostname, report] of reports) {
        if (report.authenticated === false && !targetStates.has(hostname)) {
          await registerTarget(targetStates, dnet, hostname)
        }
        if (report.authenticated === true && targetStates.has(hostname)) {
          targetStates.delete(hostname)
        }
        // Spawn workers on authenticated hosts that don't have one yet
        if (report.authenticated === true && !workerRegistry.has(hostname) && !spawning.has(hostname) && hostname !== DARKWEB) {
          // Find which worker can reach this host
          for (const [workerHost, wi] of workerRegistry) {
            if (wi.neighbors.includes(hostname) && wi.idle && wi.probed) {
              const childPort = allocatePort()
              spawning.add(hostname)
              workerRegistry.set(hostname, { pid: 0, port: childPort, replyPort: childPort + 1, neighbors: [], freeRam: 0, blockedRam: 0, probed: false, idle: false, lastCommand: null, lastCommandDetail: null, lastCommandAt: 0, lastReply: null, lastReplyAt: 0, lastProbedAt: 0, failures: 0, commandDeadlineAt: 0 })
              const pw = registry?.servers[hostname]?.password ?? undefined
              sendWorkerCommand(ns, dnet, wi, {
                type: "spawn",
                target: hostname,
                sessionId,
                port: childPort,
                password: pw,
              })
              break
            }
          }
        }
      }

      // Send probe to idle workers (first probe or periodic re-probe every 30s)
      const probeNow = Date.now()
      for (const [, wi] of workerRegistry) {
        if (!wi.idle) continue
        if (wi.probed && probeNow - wi.lastProbedAt < PROBE_INTERVAL_MS) continue
        sendWorkerCommand(ns, dnet, wi, { type: "probe" }, probeNow)
      }

      // Dispatch realloc to idle workers with blocked RAM
      for (const [, wi] of workerRegistry) {
        if (!wi.idle || !wi.probed) continue
        if (wi.blockedRam <= 0) continue
        sendWorkerCommand(ns, dnet, wi, { type: "realloc" })
      }

      dispatchLabyrinthStasis(ns, dnet, workerRegistry, reports)

      // Prune stale report-only entries (no worker, not in any worker's neighbor set)
      const visibleHosts = new Set<string>()
      for (const [, wi] of workerRegistry) {
        for (const n of wi.neighbors) visibleHosts.add(n)
      }
      for (const [hostname] of reports) {
        if (!workerRegistry.has(hostname) && !visibleHosts.has(hostname) && !targetStates.has(hostname)) {
          reports.delete(hostname)
        }
      }

      // Dispatch auth tasks
      await dispatchTasks(ns, dnet, targetStates, workerRegistry)

      // Time out unresponsive workers
      handleWorkerTimeouts(ns, workerRegistry, spawning)

      // Handle completed targets
      for (const [hostname, target] of targetStates) {
        if (target.done) {
          if (target.password !== null && target.pendingGuess !== "EXHAUSTED") {
            reports.set(hostname, {
              type: "host", hostname, authenticated: true,
              password: target.password, authGuesses: undefined,
            })
            try { await dnet.authenticate(hostname, target.password) } catch { /* already done */ }
          } else {
            reports.set(hostname, {
              type: "host", hostname, authenticated: false,
              password: null, authGuesses: undefined,
            })
          }
          targetStates.delete(hostname)
        }
      }

      await emitProgress(true)

      // Handle spawn results (remove from spawning set, send probe if successful)
      // drainReportPort handles spawnResult — after that, probe is sent via the loop above

      if (!ns.isRunning(pid)) {
        onWorkerError?.(`${DARKNET_CRAWL_SCRIPT} daemon on ${DARKWEB} stopped — restarting`)
        try {
          sessionId = Date.now()
          await killAllCrawlWorkers(ns, dnet, registry)
          await authenticateDarkwebEntry(ns, dnet, registry?.servers[DARKWEB]?.password)
          reports.clear()
          activeOps.clear()
          targetStates.clear()
          workerRegistry.clear()
          spawning.clear()
          ns.clearPort(lorePort)
          for (let i = 0; i < PORT_POOL_SIZE; i++) {
            ns.clearPort(PORT_POOL_START + i * 2)
            ns.clearPort(PORT_POOL_START + i * 2 + 1)
          }
          _portPool = null
          syncControlPort(ns, sessionId, lorePort)
          await ns.sleep(5000)
          const newPort = allocatePort()
          workerRegistry.set(DARKWEB, { pid: 0, port: newPort, replyPort: newPort + 1, neighbors: [], freeRam: 0, blockedRam: 0, probed: false, idle: true, lastCommand: null, lastCommandDetail: null, lastCommandAt: 0, lastReply: null, lastReplyAt: 0, lastProbedAt: 0, failures: 0, commandDeadlineAt: 0 })
          pid = await launchDarkwebCrawlWorker(ns, source, sessionId, newPort)
          workerRegistry.get(DARKWEB)!.pid = pid
        } catch (restartErr) {
          onWorkerError?.(`Failed to restart daemon: ${String(restartErr)} — retrying in 30s`)
          await ns.sleep(30000)
          continue
        }
      }
      await ns.sleep(100)
    }
  }

  while (ns.isRunning(pid)) {
    await drainReportPort(ns, targetStates, solverTimings, workerRegistry, spawning, reports, activeOps, cacheOpens, sessionId, registry)
    pollTextPort(ns, lorePort, loreSet, DARKNET_LORE_FILE)

    for (const [hostname, report] of reports) {
      if (report.authenticated === false && !targetStates.has(hostname)) {
        await registerTarget(targetStates, dnet, hostname)
      }
      if (report.authenticated === true && targetStates.has(hostname)) {
        targetStates.delete(hostname)
      }
      if (report.authenticated === true && !workerRegistry.has(hostname) && !spawning.has(hostname) && hostname !== DARKWEB) {
        for (const [workerHost, wi] of workerRegistry) {
          if (wi.neighbors.includes(hostname) && wi.idle && wi.probed) {
            const childPort = allocatePort()
            spawning.add(hostname)
            workerRegistry.set(hostname, { pid: 0, port: childPort, replyPort: childPort + 1, neighbors: [], freeRam: 0, blockedRam: 0, probed: false, idle: false, lastCommand: null, lastCommandDetail: null, lastCommandAt: 0, lastReply: null, lastReplyAt: 0, lastProbedAt: 0, failures: 0, commandDeadlineAt: 0 })
            const pw = registry?.servers[hostname]?.password ?? undefined
            sendWorkerCommand(ns, dnet, wi, {
              type: "spawn", target: hostname, sessionId, port: childPort,
              password: pw,
            })
            break
          }
        }
      }
    }

    // Send probe to idle workers (first probe or periodic re-probe every 30s)
    const probeNow = Date.now()
    for (const [, wi] of workerRegistry) {
      if (!wi.idle) continue
      if (wi.probed && probeNow - wi.lastProbedAt < PROBE_INTERVAL_MS) continue
      sendWorkerCommand(ns, dnet, wi, { type: "probe" }, probeNow)
    }

    // Dispatch realloc to idle workers with blocked RAM
    for (const [, wi] of workerRegistry) {
      if (!wi.idle || !wi.probed) continue
      if (wi.blockedRam <= 0) continue
      sendWorkerCommand(ns, dnet, wi, { type: "realloc" })
    }

    dispatchLabyrinthStasis(ns, dnet, workerRegistry, reports)

    // Prune stale report-only entries (no worker, not in any worker's neighbor set)
    const visibleHosts = new Set<string>()
    for (const [, wi] of workerRegistry) {
      for (const n of wi.neighbors) visibleHosts.add(n)
    }
    for (const [hostname] of reports) {
      if (!workerRegistry.has(hostname) && !visibleHosts.has(hostname) && !targetStates.has(hostname)) {
        reports.delete(hostname)
      }
    }

    await dispatchTasks(ns, dnet, targetStates, workerRegistry)

    handleWorkerTimeouts(ns, workerRegistry, spawning)

    for (const [hostname, target] of targetStates) {
      if (target.done) {
        if (target.password !== null && target.pendingGuess !== "EXHAUSTED") {
          reports.set(hostname, {
            type: "host", hostname, authenticated: true,
            password: target.password, authGuesses: undefined,
          })
          try { await dnet.authenticate(hostname, target.password) } catch { /* already done */ }
        } else {
          reports.set(hostname, {
            type: "host", hostname, authenticated: false,
            password: null, authGuesses: undefined,
          })
        }
        targetStates.delete(hostname)
      }
    }

    await emitProgress(true)
    await ns.sleep(100)
  }

  // Signal all workers to stop — write exit to each worker's port, then set session to 0
  for (const [, wi] of workerRegistry) {
    try { sendWorkerCommand(ns, dnet, wi, { type: "exit" }) } catch { /* port may be gone */ }
  }
  syncControlPort(ns, 0, 0)
  drainCrawlPort(ns, workerRegistry, reports, activeOps, cacheOpens, sessionId, registry)
  drainTextPort(ns, lorePort, loreSet, DARKNET_LORE_FILE)
  await emitProgress(false)

  return { reports, cacheOpens }
}
