import { NS } from "@ns"
import {
  DARKNET_CRAWL_SCRIPT,
  DARKNET_LORE_FILE,
  DARKWEB,
  CONTROL_PORT,
  PORT_POOL_START,
  PORT_POOL_SIZE,
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
  type WorkerCommand,
  type SolverState,
  type SolverModule,
  type WorkerSnapshot,
} from "./config"
import { solveDarknetPassword, solverInputFromDetails } from "./auth"
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
import { lookupSolver, bellaCuoreRange } from "./solverState"

// ---- control port sync ----

function syncControlPort(
  ns: NS,
  sessionId: number,
  reportPort: number,
  lorePort: number,
): void {
  ns.clearPort(CONTROL_PORT)
  ns.writePort(CONTROL_PORT, JSON.stringify({
    sessionId,
    reportPort,
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
      case "executing": {
        if (typeof row.workerHost !== "string" || typeof row.commandType !== "string") return null
        return { type: "executing", workerHost: row.workerHost, commandType: row.commandType }
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
        }
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
  ns: NS, port: number, reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>, cacheOpens: CrawlCacheOpen[],
  sessionId: number, registry?: DarknetRegistry,
): void {
  while (true) {
    const raw = ns.readPort(port)
    if (raw === "NULL PORT DATA") break
    applyCrawlPortMessage(ns, raw, reports, activeOps, cacheOpens, sessionId, registry)
  }
}

function pollCrawlPort(
  ns: NS, port: number, reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>, cacheOpens: CrawlCacheOpen[],
  sessionId: number, registry?: DarknetRegistry,
): void {
  while (true) {
    const raw = ns.peek(port)
    if (raw === "NULL PORT DATA") break
    ns.readPort(port)
    applyCrawlPortMessage(ns, raw, reports, activeOps, cacheOpens, sessionId, registry)
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
  port: number          // dedicated command port
  neighbors: string[]   // hosts this worker can reach
  freeRam: number
  probed: boolean       // has received at least one probeResult
  idle: boolean         // ready to receive a command (not waiting on a pending command)
  lastCommand: string | null  // most recent command type sent
  lastCommandAt: number       // timestamp
  lastReply: string | null    // most recent response type
  lastReplyAt: number         // timestamp
}

// ---- port pool ----

let _portPool: number[] | null = null

function initPortPool(): number[] {
  const pool: number[] = []
  for (let i = 0; i < PORT_POOL_SIZE; i++) {
    pool.push(PORT_POOL_START + i)
  }
  return pool
}

function allocatePort(): number {
  if (!_portPool) _portPool = initPortPool()
  const port = _portPool.shift()
  if (port === undefined) throw new Error("No free ports in pool (all 1024 in use)")
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
  solver: SolverModule
  solverState: SolverState
  done: boolean
  password: string | null
  pendingGuess: string | null
  pendingWorker: string | null
  pendingAt: number
  startedAt: number
}

// ---- task dispatch ----

const PENDING_TIMEOUT_MS = 60_000

function drainReportPort(
  ns: NS,
  reportPort: number,
  targetStates: Map<string, TargetState>,
  workerRegistry: Map<string, WorkerInfo>,
  spawning: Set<string>,
  reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>,
  cacheOpens: CrawlCacheOpen[],
  sessionId: number,
  registry?: DarknetRegistry,
): void {
  while (true) {
    const raw = ns.readPort(reportPort)
    if (raw === "NULL PORT DATA") break
    try {
      const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
      if (typeof parsed !== "object" || parsed === null) continue

      // Worker responses (new)
      const workerResp = parseWorkerResponse(parsed)
      if (workerResp) {
        const now = Date.now()

        if (workerResp.type === "executing") {
          // Worker confirmed receipt — update lastReply to show "executing"
          const wi = workerRegistry.get(workerResp.workerHost)
          if (wi) {
            wi.lastReply = `executing:${workerResp.commandType}`
            wi.lastReplyAt = now
          }
          continue
        }

        if (workerResp.type === "probeResult") {
          let wi = workerRegistry.get(workerResp.workerHost)
          if (!wi) { wi = { port: 0, neighbors: [], freeRam: 0, probed: false, idle: false, lastCommand: null, lastCommandAt: 0, lastReply: null, lastReplyAt: 0 }; workerRegistry.set(workerResp.workerHost, wi) }
          wi.neighbors = workerResp.targets
          wi.freeRam = workerResp.freeRam
          wi.probed = true
          wi.idle = true
          wi.lastReply = "probeResult"
          wi.lastReplyAt = now
          continue
        }

        if (workerResp.type === "spawnResult") {
          const parentWi = workerRegistry.get(workerResp.workerHost)
          if (parentWi) {
            parentWi.idle = true
            parentWi.lastReply = workerResp.success ? "spawnResult:ok" : "spawnResult:fail"
            parentWi.lastReplyAt = now
          }

          spawning.delete(workerResp.target)
          if (workerResp.success) {
            const childWi = workerRegistry.get(workerResp.target)
            if (childWi) childWi.idle = true
          } else {
            const targetWi = workerRegistry.get(workerResp.target)
            if (targetWi) {
              freePort(targetWi.port)
              workerRegistry.delete(workerResp.target)
            }
          }
          continue
        }

        // guessResult / heartbleedResult / labreportResult
        applyTaskResult(workerResp, targetStates, workerRegistry)
        continue
      }

      // Legacy crawl messages (archive, passwordIntel, host/status reports)
      applyCrawlPortMessage(ns, parsed, reports, activeOps, cacheOpens, sessionId, registry)
    } catch { /* malformed */ }
  }
}

function applyTaskResult(
  result: WorkerResponse & { type: "guessResult" | "heartbleedResult" | "labreportResult" },
  targetStates: Map<string, TargetState>,
  workerRegistry: Map<string, WorkerInfo>,
): void {
  const target = targetStates.get(result.target)
  if (!target) return
  if (target.solverState.type !== result.solverId) return

  const dispatchedGuess = target.pendingGuess
  const completedWorker = target.pendingWorker
  target.pendingGuess = null
  target.pendingWorker = null

  // Mark the worker idle again with reply tracking
  if (completedWorker) {
    const wi = workerRegistry.get(completedWorker)
    if (wi) {
      wi.idle = true
      wi.lastReply = result.type
      wi.lastReplyAt = Date.now()
    }
  }

  if (result.type === "guessResult") {
    if (result.success) {
      target.done = true
      target.password = result.feedback || dispatchedGuess
      return
    }
    target.solverState = target.solver.applyResult(
      target.solverState,
      dispatchedGuess ?? "",
      { success: false, feedback: result.feedback, message: result.message },
    )
  } else if (result.type === "heartbleedResult") {
    if (target.solver.applyHeartbleed) {
      target.solverState = target.solver.applyHeartbleed(target.solverState, result.logEntries)
    }
  } else if (result.type === "labreportResult") {
    if (target.solver.applyLabreport) {
      target.solverState = target.solver.applyLabreport(target.solverState, {
        coords: result.coords,
        north: result.north, east: result.east,
        south: result.south, west: result.west,
      })
    }
  }
}

function dispatchTasks(
  ns: NS,
  targetStates: Map<string, TargetState>,
  workerRegistry: Map<string, WorkerInfo>,
): void {
  const now = Date.now()

  // Helper: send a command to a specific worker and update tracking
  const sendCommand = (wi: WorkerInfo, command: WorkerCommand): void => {
    ns.writePort(wi.port, JSON.stringify(command))
    wi.lastCommand = command.type
    wi.lastCommandAt = now
    wi.lastReply = null
    wi.idle = false
  }

  // Timeout stale pending guesses
  for (const [, target] of targetStates) {
    if (target.done) continue
    if (target.pendingGuess && target.pendingAt && (now - target.pendingAt > PENDING_TIMEOUT_MS)) {
      if (target.pendingWorker) {
        const wi = workerRegistry.get(target.pendingWorker)
        if (wi) { wi.idle = true; wi.lastReply = "timeout"; wi.lastReplyAt = now }
      }
      target.pendingGuess = null
      target.pendingWorker = null
    }
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

  // Dispatch new tasks
  for (const [hostname, target] of targetStates) {
    if (target.done) continue
    if (target.pendingGuess !== null) continue

    const next = target.solver.nextGuess(target.solverState, {
      target: hostname,
      details: target.details,
    })
    if (!next) {
      const s = target.solverState as unknown as Record<string, unknown>
      if (s.phase === "labreport" || (s.phase === "move" && !s.coords)) {
        for (const [workerHost, reach] of workerReach) {
          if (reach.has(hostname)) {
            const wi = workerRegistry.get(workerHost)!
            sendCommand(wi, { type: "labreport", target: hostname, solverId: target.solverState.type })
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
          sendCommand(wi, { type: "labreport", target: hostname, solverId: target.solverState.type })
        } else {
          sendCommand(wi, { type: taskType, target: hostname, solverId: target.solverState.type, guess: next.guess, detail: next.detail })
        }

        target.pendingGuess = next.guess
        target.pendingWorker = workerHost
        target.pendingAt = now
        break
      }
    }
  }
}

function registerTarget(
  targetStates: Map<string, TargetState>,
  dnet: DarknetCrawlApi,
  hostname: string,
): void {
  if (targetStates.has(hostname)) return
  const details = dnet.getServerDetails(hostname)
  if (!details || details.hasSession) return

  // BellaCuore range: "nulla,DCCCLXV" format needs binary search via bellaCuoreRange
  // bellaCuoreSingle returns dispatched:true for range data; substitute here
  let solver: SolverModule | null = lookupSolver(details)
  let solverState: SolverState | null = null

  if (details.modelId === "BellaCuore" && details.data.includes(",")) {
    // Range format — use the bellaCuoreRange solver
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rangeState = bellaCuoreRange.initSolver(details) as any
    if (rangeState.lo > rangeState.hi) { /* invalid range */ }
    else {
      solver = bellaCuoreRange
      solverState = rangeState
    }
  } else if (solver) {
    solverState = solver.initSolver(details)
  }

  if (!solver || !solverState) return

  targetStates.set(hostname, {
    hostname,
    details,
    solver,
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
  const details = dnet.getServerDetails(DARKWEB)
  const { password } = solveDarknetPassword(solverInputFromDetails(details))
  if (password !== null) {
    await dnet.authenticate(DARKWEB, password)
  } else {
    tryConnectToSession(dnet, DARKWEB, "")
  }
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
  reportPort: number,
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
    syncControlPort(ns, 0, 0, 0)

    const reports = new Map<string, CrawlHostReport>()
    const activeOps = new Map<string, CrawlStatusReport>()
    const cacheOpens: CrawlCacheOpen[] = []
    const loreSet = loadDarknetTextSet(ns, DARKNET_LORE_FILE)

    const emitProgress = async (workerRunning: boolean): Promise<void> => {
      if (!onProgress) return
      await onProgress({ reports, activeOps: [...activeOps.values()], workerRunning, cacheOpens, workers: [] })
    }

    await killAllCrawlWorkers(ns, dnet, registry)
    await emitProgress(true)

    while (true) {
      await ns.sleep(1000)
      await killAllCrawlWorkers(ns, dnet, registry)
      pollCrawlPort(ns, reportPort, reports, activeOps, cacheOpens, 0, registry)
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

  ns.clearPort(reportPort)
  ns.clearPort(lorePort)
  // Clear all pool ports (belt and suspenders)
  for (let i = 0; i < PORT_POOL_SIZE; i++) {
    ns.clearPort(PORT_POOL_START + i)
  }

  syncControlPort(ns, sessionId, reportPort, lorePort)

  const loreSet = loadDarknetTextSet(ns, DARKNET_LORE_FILE)

  // Allocate a port for the initial darkweb worker
  const darkwebPort = allocatePort()
  const workerRegistry = new Map<string, WorkerInfo>()
  workerRegistry.set(DARKWEB, { port: darkwebPort, neighbors: [], freeRam: 0, probed: false, idle: false, lastCommand: null, lastCommandAt: 0, lastReply: null, lastReplyAt: 0 })
  const spawning = new Set<string>() // hosts with spawn commands in flight

  let pid = await launchDarkwebCrawlWorker(ns, source, sessionId, darkwebPort)

  // Task orchestration state
  const targetStates = new Map<string, TargetState>()

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
        lastCommandAt: wi.lastCommandAt,
        lastReply: wi.lastReply,
        lastReplyAt: wi.lastReplyAt,
        freeRam: wi.freeRam,
        neighbors: wi.neighbors,
      })
    }
    workers.sort((a, b) => a.host.localeCompare(b.host))
    await onProgress({ reports, activeOps: [...activeOps.values()], workerRunning, cacheOpens, workers })
  }

  await emitProgress(true)

  // Send initial probe to darkweb worker
  ns.writePort(darkwebPort, JSON.stringify({ type: "probe" } satisfies WorkerCommand))
  const darkwebWi = workerRegistry.get(DARKWEB)!
  darkwebWi.lastCommand = "probe"
  darkwebWi.lastCommandAt = Date.now()
  darkwebWi.idle = false

  if (continuous) {
    while (true) {
      drainReportPort(ns, reportPort, targetStates, workerRegistry, spawning, reports, activeOps, cacheOpens, sessionId, registry)
      pollTextPort(ns, lorePort, loreSet, DARKNET_LORE_FILE)

      // Register new unauthenticated targets from worker reports + dispatch spawns for authenticated neighbors
      for (const [hostname, report] of reports) {
        if (report.authenticated === false && !targetStates.has(hostname)) {
          registerTarget(targetStates, dnet, hostname)
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
              workerRegistry.set(hostname, { port: childPort, neighbors: [], freeRam: 0, probed: false, idle: false, lastCommand: null, lastCommandAt: 0, lastReply: null, lastReplyAt: 0 })
              const pw = registry?.servers[hostname]?.password ?? undefined
              ns.writePort(wi.port, JSON.stringify({
                type: "spawn",
                target: hostname,
                sessionId,
                port: childPort,
                password: pw,
              } satisfies WorkerCommand))
              wi.lastCommand = "spawn"
              wi.lastCommandAt = Date.now()
              wi.idle = false
              break
            }
          }
        }
      }

      // When spawnResult comes in, send probe to new workers
      for (const [, wi] of workerRegistry) {
        if (!wi.probed && wi.idle) {
          ns.writePort(wi.port, JSON.stringify({ type: "probe" } satisfies WorkerCommand))
          wi.lastCommand = "probe"
          wi.lastCommandAt = Date.now()
          wi.idle = false
        }
      }

      // Dispatch auth tasks
      dispatchTasks(ns, targetStates, workerRegistry)

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
          ns.clearPort(reportPort)
          ns.clearPort(lorePort)
          for (let i = 0; i < PORT_POOL_SIZE; i++) { ns.clearPort(PORT_POOL_START + i) }
          _portPool = null
          syncControlPort(ns, sessionId, reportPort, lorePort)
          await ns.sleep(5000)
          const newPort = allocatePort()
          workerRegistry.set(DARKWEB, { port: newPort, neighbors: [], freeRam: 0, probed: false, idle: false, lastCommand: null, lastCommandAt: 0, lastReply: null, lastReplyAt: 0 })
          pid = await launchDarkwebCrawlWorker(ns, source, sessionId, newPort)
          ns.writePort(newPort, JSON.stringify({ type: "probe" } satisfies WorkerCommand))
          const newDarkwebWi = workerRegistry.get(DARKWEB)!
          newDarkwebWi.lastCommand = "probe"
          newDarkwebWi.lastCommandAt = Date.now()
          newDarkwebWi.idle = false
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
    drainReportPort(ns, reportPort, targetStates, workerRegistry, spawning, reports, activeOps, cacheOpens, sessionId, registry)
    pollTextPort(ns, lorePort, loreSet, DARKNET_LORE_FILE)

    for (const [hostname, report] of reports) {
      if (report.authenticated === false && !targetStates.has(hostname)) {
        registerTarget(targetStates, dnet, hostname)
      }
      if (report.authenticated === true && targetStates.has(hostname)) {
        targetStates.delete(hostname)
      }
      if (report.authenticated === true && !workerRegistry.has(hostname) && !spawning.has(hostname) && hostname !== DARKWEB) {
        for (const [workerHost, wi] of workerRegistry) {
          if (wi.neighbors.includes(hostname) && wi.idle && wi.probed) {
            const childPort = allocatePort()
            spawning.add(hostname)
            workerRegistry.set(hostname, { port: childPort, neighbors: [], freeRam: 0, probed: false, idle: false, lastCommand: null, lastCommandAt: 0, lastReply: null, lastReplyAt: 0 })
            const pw = registry?.servers[hostname]?.password ?? undefined
            ns.writePort(wi.port, JSON.stringify({
              type: "spawn", target: hostname, sessionId, port: childPort,
              password: pw,
            } satisfies WorkerCommand))
            wi.lastCommand = "spawn"
            wi.lastCommandAt = Date.now()
            wi.idle = false
            break
          }
        }
      }
    }

    for (const [, wi] of workerRegistry) {
      if (!wi.probed && wi.idle) {
        ns.writePort(wi.port, JSON.stringify({ type: "probe" } satisfies WorkerCommand))
        wi.lastCommand = "probe"
        wi.lastCommandAt = Date.now()
        wi.idle = false
      }
    }

    dispatchTasks(ns, targetStates, workerRegistry)

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

  // Signal all workers to stop
  syncControlPort(ns, 0, 0, 0)
  drainCrawlPort(ns, reportPort, reports, activeOps, cacheOpens, sessionId, registry)
  drainTextPort(ns, lorePort, loreSet, DARKNET_LORE_FILE)
  await emitProgress(false)

  return { reports, cacheOpens }
}
