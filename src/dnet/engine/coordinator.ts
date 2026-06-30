import { NS } from "@ns"
import {
  CONTROL_PORT,
  DARKWEB,
  EXHAUSTED_RETRY_MS,
  LABYRINTH_MODEL,
  LOOP_INTERVAL_MS,
  WORKER_SCRIPT,
  WORKER_TIMEOUT_MS,
} from "../constants.js"
import { getServerDetails, tryConnect } from "../api/server.js"
import { AttemptLog } from "../history/attemptLog.js"
import { PortPool, WorkerPool, type ManagedWorker } from "../pool/workers.js"
import { lookupSolver, solverKey } from "../solvers/registry.js"
import type { SolverState } from "../solvers/types.js"
import type {
  AuthTarget,
  CrawlSnapshot,
  DnetApi,
  ProgressHandler,
  ServerDetails,
  TargetStatus,
  WorkerSnapshot,
} from "../types.js"
import {
  formatCommand,
  parseWorkerResponse,
  type WorkerCommandPayload,
  type WorkerResponse,
} from "../worker/protocol.js"
import {
  needsRealloc,
  readHostRam,
  reallocCommandMs,
} from "./memoryPlan.js"
import { copyWorkerFiles } from "../worker/deploy.js"

const GUESS_MS = 800
const PROBE_MS = 400
const PROBE_INTERVAL_MS = 5_000

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export interface CoordinatorOptions {
  onProgress: ProgressHandler
  onError?: (message: string) => void
}

export async function runCoordinator(ns: NS, options: CoordinatorOptions): Promise<void> {
  const dnet = (ns as NS & { dnet?: DnetApi }).dnet
  if (!dnet) {
    options.onError?.("ns.dnet API not available")
    return
  }

  const sessionId = Date.now()
  const attemptLog = new AttemptLog()
  const portPool = new PortPool()
  const workerPool = new WorkerPool()
  const targets = new Map<string, AuthTarget>()
  const passwords = new Map<string, string>()
  const pendingSpawns = new Set<string>()

  ns.clearPort(CONTROL_PORT)
  ns.writePort(CONTROL_PORT, JSON.stringify({ sessionId }))

  await authDarkweb(dnet)
  if (!(await copyWorkerFiles(ns, DARKWEB, "home"))) {
    options.onError?.("Failed to copy worker files to darkweb")
    return
  }

  const rootPort = portPool.allocate()
  if (rootPort <= 0) {
    options.onError?.("No ports available")
    return
  }

  const rootPid = ns.exec(WORKER_SCRIPT, DARKWEB, 1, sessionId, rootPort, "")
  if (rootPid <= 0) {
    options.onError?.("Failed to start root worker on darkweb")
    portPool.release(rootPort)
    return
  }

  workerPool.register(DARKWEB, rootPid, rootPort)

  while (true) {
    ns.writePort(CONTROL_PORT, JSON.stringify({ sessionId }))

    drainReplies(ns, workerPool, portPool, targets, passwords, attemptLog, dnet, pendingSpawns)
    processQueuedTargets(targets, attemptLog, dnet, passwords)
    scheduleRetries(targets, attemptLog)
    spawnWorkers(ns, sessionId, workerPool, portPool, targets, pendingSpawns, dnet)
    dispatchReallocs(ns, dnet, workerPool)
    dispatchProbes(ns, workerPool)
    dispatchGuesses(ns, workerPool, targets, attemptLog, dnet)
    pruneWorkers(ns, workerPool, portPool, targets)

    await options.onProgress(buildSnapshot(sessionId, targets, attemptLog, workerPool))
    await ns.sleep(LOOP_INTERVAL_MS)
  }
}

async function authDarkweb(dnet: DnetApi): Promise<void> {
  if (getServerDetails(dnet, DARKWEB)?.hasSession) return
  try {
    const result = await dnet.authenticate(DARKWEB, "")
    if (result.success) return
  } catch {
    /* ignore */
  }
  tryConnect(dnet, DARKWEB, "")
}

function buildSnapshot(
  sessionId: number,
  targets: Map<string, AuthTarget>,
  attemptLog: AttemptLog,
  workerPool: WorkerPool,
): CrawlSnapshot {
  const all = [...targets.values()]
  const count = (s: TargetStatus) => all.filter((t) => t.status === s).length
  return {
    sessionId,
    targets: all,
    attempts: attemptLog.all,
    workers: [...workerPool.workers.values()].map(
      (w): WorkerSnapshot => ({
        host: w.host,
        pid: w.pid,
        commandPort: w.commandPort,
        idle: w.idle,
        neighbors: w.neighbors,
        lastCommand: w.lastCommand,
        lastReply: w.lastReply,
        freeRam: w.freeRam,
        blockedRam: w.blockedRam,
      }),
    ),
    summary: {
      discovered: count("discovered") + count("queued"),
      active: count("active") + count("waiting_worker"),
      solved: count("solved"),
      exhausted: count("exhausted"),
      retryWait: count("retry_wait"),
      noSolver: count("no_solver"),
      unsupported: count("unsupported"),
    },
  }
}

function drainReplies(
  ns: NS,
  workerPool: WorkerPool,
  portPool: PortPool,
  targets: Map<string, AuthTarget>,
  passwords: Map<string, string>,
  attemptLog: AttemptLog,
  dnet: DnetApi,
  pendingSpawns: Set<string>,
): void {
  for (const wi of [...workerPool.workers.values()]) {
    if (wi.commandPort <= 0) continue
    while (ns.peek(wi.replyPort) !== "NULL PORT DATA") {
      const msg = parseWorkerResponse(ns.readPort(wi.replyPort))
      if (!msg) continue
      wi.lastActivityAt = Date.now()
      wi.lastReply = msg.type

      switch (msg.type) {
        case "ready":
          wi.pid = msg.pid
          wi.idle = true
          wi.busyUntil = 0
          break
        case "executing":
          wi.idle = false
          wi.busyUntil = msg.deadlineAt
          break
        case "probeResult":
          wi.idle = true
          wi.busyUntil = 0
          wi.neighbors = msg.neighbors
          wi.freeRam = msg.freeRam
          wi.blockedRam = msg.blockedRam
          for (const neighbor of msg.neighbors) {
            noteHost(targets, dnet, neighbor, msg.workerHost)
          }
          attemptLog.append({
            host: wi.host,
            session: 0,
            kind: "probe",
            solverId: "-",
            modelId: "-",
            workerHost: wi.host,
            note: `${msg.neighbors.length} neighbors`,
          })
          break
        case "spawnResult":
          wi.idle = true
          wi.busyUntil = 0
          pendingSpawns.delete(msg.target)
          if (!msg.success) {
            const ghost = workerPool.workers.get(msg.target)
            if (ghost?.commandPort) portPool.release(ghost.commandPort)
            workerPool.remove(msg.target)
          } else {
            const child = workerPool.workers.get(msg.target)
            if (child) child.pid = msg.childPid
          }
          attemptLog.append({
            host: msg.target,
            session: 0,
            kind: "spawn",
            solverId: "-",
            modelId: "-",
            workerHost: msg.workerHost,
            success: msg.success,
            note: msg.success ? `pid ${msg.childPid}` : "spawn failed",
          })
          break
        case "guessResult":
          wi.idle = true
          wi.busyUntil = 0
          onGuessResult(msg, targets, passwords, attemptLog, dnet)
          break
        case "heartbleedResult":
          wi.idle = true
          wi.busyUntil = 0
          onHeartbleedResult(msg, targets, attemptLog, dnet)
          break
        case "reallocResult":
          wi.idle = true
          wi.busyUntil = 0
          wi.freeRam = msg.freeRam
          wi.blockedRam = msg.blockedRam
          attemptLog.append({
            host: wi.host,
            session: 0,
            kind: "note",
            solverId: "-",
            modelId: "-",
            workerHost: wi.host,
            note: `realloc p${msg.priority} free ${msg.freeRam.toFixed(1)} blocked ${msg.blockedRam.toFixed(1)}`,
          })
          break
      }
    }
  }
}

function noteHost(
  targets: Map<string, AuthTarget>,
  dnet: DnetApi,
  host: string,
  viaWorker: string,
): void {
  if (host === DARKWEB) return
  const details = getServerDetails(dnet, host)
  if (!details?.isOnline) return

  let target = targets.get(host)
  if (!target) {
    const status: TargetStatus =
      details.modelId === LABYRINTH_MODEL
        ? "unsupported"
        : details.hasSession
          ? "solved"
          : "queued"
    target = {
      host,
      modelId: details.modelId,
      format: details.passwordFormat,
      status,
      password: null,
      solverId: null,
      solverState: null,
      session: 0,
      workerHost: null,
      neighborWorkers: [],
      pendingGuess: null,
      pendingDetail: null,
      guessCount: 0,
      retryAt: null,
      lastError: null,
    }
    targets.set(host, target)
  } else if (details.hasSession && target.password == null && target.status !== "unsupported") {
    target.status = "solved"
  }

  if (!target.neighborWorkers.includes(viaWorker)) {
    target.neighborWorkers.push(viaWorker)
  }
}

function processQueuedTargets(
  targets: Map<string, AuthTarget>,
  attemptLog: AttemptLog,
  dnet: DnetApi,
  passwords: Map<string, string>,
): void {
  for (const target of targets.values()) {
    if (target.status !== "queued") continue
    const details = getServerDetails(dnet, target.host)
    if (!details?.isOnline) {
      target.status = "offline"
      continue
    }
    if (details.hasSession && passwords.has(target.host)) {
      target.status = "solved"
      target.password = passwords.get(target.host)!
      continue
    }
    startAuthSession(target, details, attemptLog)
  }
}

function startAuthSession(target: AuthTarget, details: ServerDetails, log: AttemptLog): void {
  if (details.modelId === LABYRINTH_MODEL) {
    target.status = "unsupported"
    target.lastError = "Labyrinth solver not implemented in dnet v2 yet"
    return
  }

  const solver = lookupSolver(details)
  if (!solver) {
    target.status = "no_solver"
    target.lastError = `No solver for ${solverKey(details)}`
    log.append({
      host: target.host,
      session: target.session,
      kind: "session_start",
      solverId: "-",
      modelId: target.modelId,
      note: target.lastError,
    })
    return
  }

  target.session += 1
  const state = solver.init(details)
  target.solverId = (state as SolverState).type
  target.solverState = state
  target.status = "waiting_worker"
  target.pendingGuess = null
  target.lastError = null

  log.append({
    host: target.host,
    session: target.session,
    kind: "session_start",
    solverId: target.solverId,
    modelId: target.modelId,
    solverState: cloneState(state),
    note: `session ${target.session}`,
  })
}

function onGuessResult(
  msg: Extract<WorkerResponse, { type: "guessResult" }>,
  targets: Map<string, AuthTarget>,
  passwords: Map<string, string>,
  attemptLog: AttemptLog,
  dnet: DnetApi,
): void {
  const target = targets.get(msg.target)
  if (!target) return

  target.pendingGuess = null
  target.pendingDetail = null
  target.workerHost = null
  target.guessCount += 1

  attemptLog.append({
    host: target.host,
    session: target.session,
    kind: "guess_result",
    solverId: msg.solverId,
    modelId: target.modelId,
    workerHost: msg.workerHost,
    guess: msg.guess,
    success: msg.success,
    feedback: msg.feedback,
    message: msg.message,
  })

  if (msg.message === "notNeighbor") {
    target.status = "waiting_worker"
    target.lastError = "neighbor link lost"
    return
  }

  if (msg.success) {
    target.status = "solved"
    target.password = msg.guess
    passwords.set(target.host, msg.guess)
    attemptLog.append({
      host: target.host,
      session: target.session,
      kind: "session_end",
      solverId: msg.solverId,
      modelId: target.modelId,
      success: true,
      guess: msg.guess,
      note: "solved",
    })
    tryConnect(dnet, target.host, msg.guess)
    return
  }

  const details = getServerDetails(dnet, target.host)
  const solver = details ? lookupSolver(details) : null
  if (!solver || target.solverState == null) {
    target.status = "exhausted"
    target.retryAt = Date.now() + EXHAUSTED_RETRY_MS
    return
  }

  const ctx = details ? { target: target.host, details } : undefined
  target.solverState = solver.applyResult(
    target.solverState as SolverState,
    msg.guess,
    { success: false, feedback: msg.feedback, message: msg.message },
    ctx,
  )

  attemptLog.append({
    host: target.host,
    session: target.session,
    kind: "note",
    solverId: msg.solverId,
    modelId: target.modelId,
    solverState: cloneState(target.solverState),
    note: "state after failed guess",
  })

  target.status = "active"
}

function onHeartbleedResult(
  msg: Extract<WorkerResponse, { type: "heartbleedResult" }>,
  targets: Map<string, AuthTarget>,
  attemptLog: AttemptLog,
  dnet: DnetApi,
): void {
  const target = targets.get(msg.target)
  if (!target) return

  attemptLog.append({
    host: target.host,
    session: target.session,
    kind: "heartbleed",
    solverId: msg.solverId,
    modelId: target.modelId,
    heartbleedLogs: msg.logEntries,
  })

  const details = getServerDetails(dnet, target.host)
  const solver = details ? lookupSolver(details) : null
  if (solver?.applyHeartbleed && target.solverState != null) {
    target.solverState = solver.applyHeartbleed(target.solverState as SolverState, msg.logEntries)
    attemptLog.append({
      host: target.host,
      session: target.session,
      kind: "note",
      solverId: msg.solverId,
      modelId: target.modelId,
      solverState: cloneState(target.solverState),
      note: "state after heartbleed",
    })
  }
  target.workerHost = null
  target.status = "active"
}

function scheduleRetries(targets: Map<string, AuthTarget>, log: AttemptLog): void {
  const now = Date.now()
  for (const target of targets.values()) {
    if (target.status !== "exhausted") continue
    if (target.retryAt != null && now < target.retryAt) {
      target.status = "retry_wait"
      continue
    }
    target.status = "queued"
    target.retryAt = null
    target.solverState = null
    log.append({
      host: target.host,
      session: target.session,
      kind: "note",
      solverId: target.solverId ?? "-",
      modelId: target.modelId,
      note: "retrying solver",
    })
  }
}

function dispatchReallocs(ns: NS, dnet: DnetApi, workerPool: WorkerPool): void {
  if (!dnet.memoryReallocation || !dnet.getBlockedRam) return

  const reallocMs = reallocCommandMs(ns)

  for (const wi of workerPool.idleWorkers()) {
    const ram = readHostRam(ns, dnet, wi.host)
    wi.blockedRam = ram.blockedRam

    if (needsRealloc(ns, dnet, wi.host, 2, ram)) {
      sendCommand(ns, wi, { type: "realloc", priority: 2 }, reallocMs)
      continue
    }
    if (needsRealloc(ns, dnet, wi.host, 3, ram)) {
      sendCommand(ns, wi, { type: "realloc", priority: 3 }, reallocMs)
    }
  }
}

function dispatchProbes(ns: NS, workerPool: WorkerPool): void {
  const now = Date.now()
  for (const wi of workerPool.idleWorkers()) {
    if (now - wi.lastProbeAt < PROBE_INTERVAL_MS) continue
    wi.lastProbeAt = now
    sendCommand(ns, wi, { type: "probe" }, PROBE_MS)
  }
}

function dispatchGuesses(
  ns: NS,
  workerPool: WorkerPool,
  targets: Map<string, AuthTarget>,
  attemptLog: AttemptLog,
  dnet: DnetApi,
): void {
  for (const target of targets.values()) {
    if (target.status !== "active" && target.status !== "waiting_worker") continue
    if (target.pendingGuess != null) continue

    const details = getServerDetails(dnet, target.host)
    if (!details?.isOnline) {
      target.status = "offline"
      continue
    }

    const solver = lookupSolver(details)
    if (!solver || target.solverState == null) continue

    const wi = workerPool.neighborForTarget(target.host, target.neighborWorkers)
    if (!wi) {
      target.status = "waiting_worker"
      continue
    }

    const next = solver.nextGuess(target.solverState as SolverState, { target: target.host, details })
    if (!next) {
      target.status = "exhausted"
      target.retryAt = Date.now() + EXHAUSTED_RETRY_MS
      attemptLog.append({
        host: target.host,
        session: target.session,
        kind: "session_end",
        solverId: target.solverId ?? "-",
        modelId: target.modelId,
        success: false,
        note: "solver exhausted",
        solverState: cloneState(target.solverState),
      })
      continue
    }

    target.pendingGuess = next.guess
    target.pendingDetail = next.detail
    target.workerHost = wi.host
    target.status = "active"

    attemptLog.append({
      host: target.host,
      session: target.session,
      kind: "guess_dispatch",
      solverId: target.solverId ?? "-",
      modelId: target.modelId,
      workerHost: wi.host,
      guess: next.guess,
      detail: next.detail ?? undefined,
      solverState: cloneState(target.solverState),
    })

    sendCommand(
      ns,
      wi,
      {
        type: "guess",
        target: target.host,
        solverId: target.solverId ?? "-",
        guess: next.guess,
        detail: next.detail,
      },
      GUESS_MS,
    )
  }
}

function spawnWorkers(
  ns: NS,
  sessionId: number,
  workerPool: WorkerPool,
  portPool: PortPool,
  targets: Map<string, AuthTarget>,
  pendingSpawns: Set<string>,
  dnet: DnetApi,
): void {
  for (const target of targets.values()) {
    if (target.host === DARKWEB) continue
    if (workerPool.workers.has(target.host)) continue
    if (pendingSpawns.has(target.host)) continue

    const details = getServerDetails(dnet, target.host)
    if (!details?.isOnline) continue

    const authed = target.password != null || details.hasSession
    if (!authed) continue

    const parent = [...workerPool.workers.values()].find(
      (w) => w.idle && w.neighbors.includes(target.host) && w.commandPort > 0,
    )
    if (!parent) continue

    const port = portPool.allocate()
    if (port <= 0) continue

    pendingSpawns.add(target.host)
    workerPool.register(target.host, 0, port)
    sendCommand(
      ns,
      parent,
      {
        type: "spawn",
        target: target.host,
        sessionId,
        port,
        ...(target.password != null ? { password: target.password } : {}),
      },
      spawnCommandMs(),
    )
  }
}

function spawnCommandMs(): number {
  return WORKER_TIMEOUT_MS
}

function sendCommand(ns: NS, wi: ManagedWorker, payload: WorkerCommandPayload, expectedMs: number): void {
  if (wi.commandPort <= 0) return
  const now = Date.now()
  wi.lastCommand = formatCommand(payload)
  wi.idle = false
  wi.busyUntil = now + expectedMs + 5000
  ns.writePort(wi.commandPort, JSON.stringify({ ...payload, expectedMs, deadlineAt: wi.busyUntil }))
}

function pruneWorkers(
  ns: NS,
  workerPool: WorkerPool,
  portPool: PortPool,
  targets: Map<string, AuthTarget>,
): void {
  const now = Date.now()
  for (const [host, wi] of workerPool.workers) {
    if (wi.commandPort <= 0) {
      portPool.release(wi.commandPort)
      workerPool.remove(host)
      continue
    }
    if (!wi.idle && wi.busyUntil > 0 && now > wi.busyUntil + WORKER_TIMEOUT_MS) {
      wi.idle = true
      for (const t of targets.values()) {
        if (t.workerHost === host) {
          t.workerHost = null
          t.pendingGuess = null
          t.status = "active"
        }
      }
    }
  }
}