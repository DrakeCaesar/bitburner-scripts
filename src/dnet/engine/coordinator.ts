import { NS } from "@ns"
import {
  CONTROL_PORT,
  DARKWEB,
  DEADLINE_GRACE_MS,
  EXHAUSTED_RETRY_MS,
  INSTANT_CMD_FALLBACK_MS,
  FIRST_REPLY_MS,
  LABYRINTH_MODEL,
  LORE_PORT,
  LOOP_INTERVAL_MS,
  WORKER_SCRIPT,
  WORKER_TIMEOUT_MS,
} from "../constants.js"
import { DARKNET_LORE_FILE } from "../files/categorize.js"
import type { DarknetLoreStore } from "../files/archive.js"
import type { CacheOpenRecord } from "../files/types.js"
import { applyWorkerFileMessage, createLoreStore, pollLorePort } from "./fileIntel.js"
import {
  loadDarknetRegistry,
  clearRegistryPassword,
  pruneInvalidRegistryHosts,
  saveDarknetRegistry,
  syncRegistryPasswords,
  type DarknetRegistry,
} from "../registry.js"
import { getServerDetails, readStasisSnapshot, tryConnect } from "../api/server.js"
import { AttemptLog } from "../history/attemptLog.js"
import { MasterActionLog } from "../history/masterActionLog.js"
import { SessionArchive } from "../history/sessionArchive.js"
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
  isInstantCommand,
  NOT_NEIGHBOR_MESSAGE,
  parseWorkerResponse,
  usesWorkerDeadlines,
  type WorkerCommandPayload,
  type WorkerResponse,
} from "../worker/protocol.js"
import {
  canSpawnWorker,
  needsRealloc,
  readHostRam,
} from "./memoryPlan.js"
import { copyWorkerFiles } from "../worker/deploy.js"
import { ensureMutationWatcher, MutationSync } from "./mutationSync.js"
import { dispatchLabyrinthStasis } from "./labyrinthStasis.js"
import { dispatchLabyrinth, snapshotLabyrinths } from "./labyrinthDispatch.js"
import { applyLabreport, type LabyrinthState } from "../solvers/labyrinth.js"
import { clearDnetGlobalPorts, clearWorkerPortPair } from "./ports.js"
import {
  availableAuthWorkers,
  availableSpawnParents,
  pickLeastBlockingWorker,
  sortByWorkerScarcity,
} from "./workerAssign.js"

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

interface SpawnPlan {
  targetHost: string
  parentHost: string
  sessionId: number
  password?: string
  port: number
  phase: "realloc" | "spawn"
}

export interface CoordinatorOptions {
  onProgress: ProgressHandler
  onError?: (message: string) => void | Promise<void>
}

export async function runCoordinator(ns: NS, options: CoordinatorOptions): Promise<void> {
  const dnet = (ns as NS & { dnet?: DnetApi }).dnet
  if (!dnet) {
    await options.onError?.("ns.dnet API not available")
    return
  }

  const sessionId = Date.now()
  const sessionArchive = new SessionArchive()
  const attemptLog = new AttemptLog((r) => sessionArchive.recordAttempt(r))
  const masterLog = new MasterActionLog()
  const portPool = new PortPool()
  const workerPool = new WorkerPool()
  const targets = new Map<string, AuthTarget>()
  const passwords = new Map<string, string>()
  const pendingSpawns = new Set<string>()
  const spawnPlans = new Map<string, SpawnPlan>()
  const mutationSync = new MutationSync()
  const urgentProbeHosts = new Set<string>()
  const registry = loadDarknetRegistry(ns)
  pruneInvalidRegistryHosts(dnet, registry)
  saveDarknetRegistry(ns, registry)
  const loreStore = createLoreStore(ns, DARKNET_LORE_FILE)
  const cacheOpens: CacheOpenRecord[] = []
  const fileIntelCtx = { registry, cacheOpens, loreStore, loreFile: DARKNET_LORE_FILE }

  clearDnetGlobalPorts(ns)
  ensureMutationWatcher(ns)
  ns.writePort(CONTROL_PORT, JSON.stringify({ sessionId, lorePort: LORE_PORT }))
  masterLog.append("startup", "ports cleared, mutation watcher started")

  await authDarkweb(dnet)
  const darkwebScpError = await copyWorkerFiles(ns, DARKWEB, "home")
  if (darkwebScpError != null) {
    await options.onError?.(`Failed to copy worker files to darkweb: ${darkwebScpError}`)
    return
  }

  const rootPort = portPool.allocate()
  if (rootPort <= 0) {
    await options.onError?.("No ports available")
    return
  }
  clearWorkerPortPair(ns, rootPort)

  const rootPid = ns.exec(WORKER_SCRIPT, DARKWEB, 1, sessionId, rootPort, "")
  if (rootPid <= 0) {
    await options.onError?.("Failed to start root worker on darkweb")
    releaseWorkerPort(ns, portPool, rootPort)
    return
  }

  workerPool.register(DARKWEB, rootPid, rootPort)
  masterLog.append("startup", `root worker ${DARKWEB} pid ${rootPid} port ${rootPort}`)
  syncRegistryPasswords(dnet, registry, passwords, targets, tryConnect)

  while (true) {
    const loopAt = Date.now()
    const mutationPort = mutationSync.peekPort(ns)

    ns.writePort(CONTROL_PORT, JSON.stringify({ sessionId, lorePort: LORE_PORT }))

    drainReplies(
      ns,
      workerPool,
      portPool,
      targets,
      passwords,
      attemptLog,
      dnet,
      pendingSpawns,
      spawnPlans,
      mutationSync,
      urgentProbeHosts,
      fileIntelCtx,
      masterLog,
      sessionArchive,
    )
    pollLorePort(ns, LORE_PORT, loreStore, DARKNET_LORE_FILE)
    syncRegistryPasswords(dnet, registry, passwords, targets, tryConnect)
    checkCommandDeadlines(workerPool, targets, spawnPlans, pendingSpawns, portPool, ns, masterLog)
    pruneWorkers(ns, workerPool, portPool, targets, pendingSpawns, spawnPlans, masterLog)
    mutationSync.tick(ns, workerPool, targets, (ts) => {
      masterLog.append("sync", `mutation ${ts} (background probes)`)
    })

    processQueuedTargets(targets, attemptLog, sessionArchive, dnet, passwords)
    scheduleRetries(targets, attemptLog)
    const dispatchCtx: WorkerDispatchCtx = { workerPool, portPool, pendingSpawns, spawnPlans, targets }
    // Dispatch priority: urgent probe -> P1 RAM -> spawn -> P2 RAM -> auth -> background probe -> P3 RAM
    dispatchUrgentProbes(ns, workerPool, urgentProbeHosts, masterLog, dispatchCtx)
    dispatchP1Reallocs(
      ns,
      sessionId,
      workerPool,
      portPool,
      targets,
      pendingSpawns,
      spawnPlans,
      dnet,
      passwords,
      masterLog,
      dispatchCtx,
    )
    spawnWorkers(
      ns,
      sessionId,
      workerPool,
      portPool,
      targets,
      pendingSpawns,
      spawnPlans,
      dnet,
      passwords,
      masterLog,
      dispatchCtx,
    )
    dispatchP2Reallocs(ns, dnet, workerPool, masterLog, dispatchCtx)
    dispatchLabyrinthStasis(
      ns,
      dnet,
      workerPool,
      targets,
      passwords,
      (wi) => isWorkerAlive(ns, wi),
      (wi) => sendCommand(ns, wi, { type: "stasis" }, masterLog, dispatchCtx),
    )
    dispatchLabyrinth({
      workerPool,
      targets,
      attemptLog,
      cloneState,
      sendCommand: (wi, payload) => sendCommand(ns, wi, payload, masterLog, dispatchCtx),
    })
    dispatchGuesses(ns, workerPool, targets, attemptLog, dnet, masterLog, dispatchCtx)
    dispatchBackgroundProbes(ns, workerPool, mutationSync, urgentProbeHosts, masterLog, dispatchCtx)
    dispatchP3Reallocs(ns, dnet, workerPool, masterLog, dispatchCtx)

    await options.onProgress(
      buildSnapshot(
        sessionId,
        targets,
        attemptLog,
        masterLog,
        sessionArchive,
        workerPool,
        mutationSync,
        mutationPort,
        loopAt,
        dnet,
      ),
    )
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
  masterLog: MasterActionLog,
  sessionArchive: SessionArchive,
  workerPool: WorkerPool,
  mutationSync: MutationSync,
  mutationPort: { raw: string; ts: number | null },
  loopAt: number,
  dnet: DnetApi,
): CrawlSnapshot {
  const all = [...targets.values()]
  const count = (s: TargetStatus) => all.filter((t) => t.status === s).length
  return {
    sessionId,
    targets: all,
    attempts: attemptLog.all,
    actions: masterLog.all,
    failedSessions: sessionArchive.failedSessions,
    mutation: {
      portRaw: mutationPort.raw,
      portTs: mutationPort.ts,
      acked: mutationSync.acked,
      pending: mutationSync.pending,
      stale: mutationPort.ts !== null && mutationPort.ts > mutationSync.acked,
      pendingBehindPort: false,
      loopAt,
    },
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
    stasis: readStasisSnapshot(dnet),
    labyrinths: snapshotLabyrinths(targets),
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

function requestUrgentProbe(host: string, urgentProbeHosts: Set<string>): void {
  urgentProbeHosts.add(host)
}

function invalidateNeighborLink(
  workerHost: string,
  targetHost: string,
  workerPool: WorkerPool,
  targets: Map<string, AuthTarget>,
): void {
  const wi = workerPool.workers.get(workerHost)
  if (wi) wi.neighbors = wi.neighbors.filter((h) => h !== targetHost)

  const target = targets.get(targetHost)
  if (target) {
    target.neighborWorkers = target.neighborWorkers.filter((h) => h !== workerHost)
  }
}

function scheduleNotNeighborProbes(
  workerHost: string,
  targetHost: string,
  workerPool: WorkerPool,
  targets: Map<string, AuthTarget>,
  urgentProbeHosts: Set<string>,
): void {
  invalidateNeighborLink(workerHost, targetHost, workerPool, targets)
  requestUrgentProbe(workerHost, urgentProbeHosts)

  for (const wi of workerPool.workers.values()) {
    if (wi.host === workerHost) continue
    if (!wi.neighbors.includes(targetHost)) continue
    wi.neighbors = wi.neighbors.filter((h) => h !== targetHost)
    requestUrgentProbe(wi.host, urgentProbeHosts)
  }
}

function finishUrgentProbe(
  workerHost: string,
  targets: Map<string, AuthTarget>,
  urgentProbeHosts: Set<string>,
): void {
  if (!urgentProbeHosts.delete(workerHost)) return
  for (const target of targets.values()) {
    if (!target.awaitProbeAfter || target.awaitProbeWorker !== workerHost) continue
    target.awaitProbeAfter = false
    target.awaitProbeWorker = null
    if (target.status === "waiting_worker" && target.lastError === "neighbor link lost") {
      target.status = "active"
    }
  }
}

/** Cached password failed at spawn; treat host as unknown and re-auth with live server details. */
function invalidateKnownPassword(
  ns: NS,
  dnet: DnetApi,
  registry: DarknetRegistry,
  passwords: Map<string, string>,
  targets: Map<string, AuthTarget>,
  sessionArchive: SessionArchive,
  attemptLog: AttemptLog,
  host: string,
): void {
  passwords.delete(host)
  clearRegistryPassword(registry, host)
  saveDarknetRegistry(ns, registry)
  sessionArchive.discardHost(host)

  const target = targets.get(host)
  if (!target) return

  const details = getServerDetails(dnet, host)
  if (!details?.isOnline) {
    target.status = "offline"
    target.password = null
    target.lastError = "stale password"
    return
  }

  target.modelId = details.modelId
  target.format = details.passwordFormat
  target.password = null
  target.solverId = null
  target.solverState = null
  target.status = "queued"
  target.pendingGuess = null
  target.pendingDetail = null
  target.workerHost = null
  target.guessCount = 0
  target.retryAt = null
  target.lastError = "stale password"
  target.awaitProbeAfter = false
  target.awaitProbeWorker = null

  attemptLog.append({
    host,
    session: target.session,
    kind: "note",
    solverId: "-",
    modelId: target.modelId,
    note: "stale password cleared",
  })
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
  spawnPlans: Map<string, SpawnPlan>,
  mutationSync: MutationSync,
  urgentProbeHosts: Set<string>,
  fileIntelCtx: {
    registry: DarknetRegistry
    cacheOpens: CacheOpenRecord[]
    loreStore: DarknetLoreStore
    loreFile: string
  },
  masterLog: MasterActionLog,
  sessionArchive: SessionArchive,
): void {
  for (const wi of [...workerPool.workers.values()]) {
    if (wi.commandPort <= 0) continue
    while (ns.peek(wi.replyPort) !== "NULL PORT DATA") {
      const raw = ns.readPort(wi.replyPort)
      const msg = parseWorkerResponse(raw)
      if (!msg) {
        applyWorkerFileMessage(ns, raw, fileIntelCtx)
        continue
      }
      wi.lastActivityAt = Date.now()
      wi.lastReply = msg.type

      switch (msg.type) {
        case "ready":
          wi.pid = msg.pid
          wi.idle = true
          wi.commandDeadlineAt = 0
          sendCommand(
            ns,
            wi,
            { type: "probe" },
            masterLog,
            { workerPool, portPool, pendingSpawns, spawnPlans, targets },
          )
          break
        case "deadline":
          wi.idle = false
          wi.commandDeadlineAt = msg.deadlineAt
          break
        case "probeResult":
          wi.idle = true
          wi.commandDeadlineAt = 0
          wi.neighbors = msg.neighbors
          wi.freeRam = msg.freeRam
          wi.blockedRam = msg.blockedRam
          for (const neighbor of msg.neighbors) {
            noteHost(targets, dnet, neighbor, msg.workerHost)
          }
          reconcileProbeStatuses(
            msg,
            targets,
            passwords,
            dnet,
            attemptLog,
          )
          mutationSync.markWorkerProbed(msg.workerHost, workerPool, ns)
          finishUrgentProbe(msg.workerHost, targets, urgentProbeHosts)
          break
        case "spawnResult":
          wi.idle = true
          wi.commandDeadlineAt = 0
          pendingSpawns.delete(msg.target)
          spawnPlans.delete(msg.target)
          if (!msg.success) {
            const ghost = workerPool.workers.get(msg.target)
            if (ghost?.commandPort) releaseWorkerPort(ns, portPool, ghost.commandPort)
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
            message: msg.message,
          })
          if (!msg.success && msg.message === NOT_NEIGHBOR_MESSAGE) {
            scheduleNotNeighborProbes(
              msg.workerHost,
              msg.target,
              workerPool,
              targets,
              urgentProbeHosts,
            )
          } else if (!msg.success && msg.message === "auth failed") {
            invalidateKnownPassword(
              ns,
              dnet,
              fileIntelCtx.registry,
              passwords,
              targets,
              sessionArchive,
              attemptLog,
              msg.target,
            )
          }
          break
        case "authResult":
          wi.idle = true
          wi.commandDeadlineAt = 0
          onAuthResult(
            msg,
            targets,
            passwords,
            attemptLog,
            sessionArchive,
            dnet,
            workerPool,
            urgentProbeHosts,
          )
          break
        case "heartbleedResult":
          wi.idle = true
          wi.commandDeadlineAt = 0
          onHeartbleedResult(msg, targets, attemptLog, dnet)
          break
        case "reallocResult":
          wi.idle = true
          wi.commandDeadlineAt = 0
          if (msg.host === wi.host) {
            wi.freeRam = msg.freeRam
            wi.blockedRam = msg.blockedRam
          }
          attemptLog.append({
            host: msg.host,
            session: 0,
            kind: "note",
            solverId: "-",
            modelId: "-",
            workerHost: wi.host,
            note: `realloc p${msg.priority} free ${msg.freeRam.toFixed(1)} blocked ${msg.blockedRam.toFixed(1)}`,
          })
          break
        case "stasisResult":
          wi.idle = true
          wi.commandDeadlineAt = 0
          attemptLog.append({
            host: msg.workerHost,
            session: 0,
            kind: "note",
            solverId: "-",
            modelId: LABYRINTH_MODEL,
            workerHost: msg.workerHost,
            success: msg.success,
            note: msg.success ? "stasis linked" : "stasis",
            message: msg.success ? undefined : msg.message ?? "unknown failure",
          })
          break
        case "labreportResult":
          wi.idle = true
          wi.commandDeadlineAt = 0
          onLabreportResult(msg, targets, attemptLog)
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
        ? "queued"
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
      awaitProbeAfter: false,
      awaitProbeWorker: null,
    }
    targets.set(host, target)
  } else if (details.hasSession && target.password == null && target.status !== "unsupported") {
    target.status = "solved"
  } else if (
    details.isConnectedToCurrentServer &&
    !details.hasSession &&
    target.password == null &&
    target.status === "solved"
  ) {
    target.status = "queued"
    target.solverState = null
  }

  if (!target.neighborWorkers.includes(viaWorker)) {
    target.neighborWorkers.push(viaWorker)
  }
}

function processQueuedTargets(
  targets: Map<string, AuthTarget>,
  attemptLog: AttemptLog,
  sessionArchive: SessionArchive,
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
      sessionArchive.discardHost(target.host)
      continue
    }
    startAuthSession(target, details, attemptLog, sessionArchive)
  }
}

function startAuthSession(
  target: AuthTarget,
  details: ServerDetails,
  log: AttemptLog,
  sessionArchive: SessionArchive,
): void {
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

  sessionArchive.beginSession(target.host, target.session, target.solverId, details)

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

function undoDispatchedGuess(target: AuthTarget): void {
  const state = target.solverState
  if (state == null || typeof state !== "object") return
  const st = state as { dispatched?: boolean }
  if (st.dispatched === true) {
    target.solverState = { ...st, dispatched: false }
  }
}

function onLabreportResult(
  msg: Extract<WorkerResponse, { type: "labreportResult" }>,
  targets: Map<string, AuthTarget>,
  attemptLog: AttemptLog,
): void {
  const target = targets.get(msg.target)
  if (!target) return

  target.pendingGuess = null
  target.pendingDetail = null
  target.workerHost = null

  if (target.solverState != null) {
    target.solverState = applyLabreport(target.solverState as LabyrinthState, {
      workerHost: msg.workerHost,
      coords: msg.coords,
      north: msg.north,
      east: msg.east,
      south: msg.south,
      west: msg.west,
    })
  }

  attemptLog.append({
    host: target.host,
    session: target.session,
    kind: "note",
    solverId: msg.solverId,
    modelId: target.modelId,
    workerHost: msg.workerHost,
    note: `labreport @ ${msg.coords.join(",")}`,
    solverState: cloneState(target.solverState),
  })

  target.status = "active"
}

function onAuthResult(
  msg: Extract<WorkerResponse, { type: "authResult" }>,
  targets: Map<string, AuthTarget>,
  passwords: Map<string, string>,
  attemptLog: AttemptLog,
  sessionArchive: SessionArchive,
  dnet: DnetApi,
  workerPool: WorkerPool,
  urgentProbeHosts: Set<string>,
): void {
  const target = targets.get(msg.target)
  if (!target) return

  target.pendingGuess = null
  target.pendingDetail = null
  target.workerHost = null

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

  if (msg.message === NOT_NEIGHBOR_MESSAGE) {
    undoDispatchedGuess(target)
    target.status = "waiting_worker"
    target.lastError = "neighbor link lost"
    target.awaitProbeAfter = true
    target.awaitProbeWorker = msg.workerHost
    scheduleNotNeighborProbes(
      msg.workerHost,
      msg.target,
      workerPool,
      targets,
      urgentProbeHosts,
    )
    return
  }

  target.guessCount += 1

  if (msg.success) {
    const password =
      target.modelId === LABYRINTH_MODEL ? msg.feedback ?? msg.guess : msg.guess
    target.status = "solved"
    target.password = password
    passwords.set(target.host, password)
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
    tryConnect(dnet, target.host, password)
    return
  }

  const details = getServerDetails(dnet, target.host)
  const solver = details ? lookupSolver(details) : null
  if (!solver || target.solverState == null) {
    target.status = "exhausted"
    target.retryAt = Date.now() + EXHAUSTED_RETRY_MS
    sessionArchive.archiveFailure(target.host, target.session, "solver state lost")
    return
  }

  const ctx = details
    ? { target: target.host, details, workerHost: msg.workerHost || undefined }
    : undefined
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

function dispatchUrgentProbes(
  ns: NS,
  workerPool: WorkerPool,
  urgentProbeHosts: Set<string>,
  masterLog: MasterActionLog,
  ctx: WorkerDispatchCtx,
): void {
  for (const host of [...urgentProbeHosts]) {
    const wi = workerPool.workers.get(host)
    if (!wi || wi.commandPort <= 0) {
      urgentProbeHosts.delete(host)
      continue
    }
    if (!wi.idle) continue
    sendCommand(ns, wi, { type: "probe" }, masterLog, ctx)
  }
}

function dispatchBackgroundProbes(
  ns: NS,
  workerPool: WorkerPool,
  mutationSync: MutationSync,
  urgentProbeHosts: Set<string>,
  masterLog: MasterActionLog,
  ctx: WorkerDispatchCtx,
): void {
  for (const wi of workerPool.workers.values()) {
    if (!wi.idle || wi.commandPort <= 0) continue
    if (urgentProbeHosts.has(wi.host)) continue
    if (!mutationSync.workerNeedsProbe(wi, ns)) continue
    sendCommand(ns, wi, { type: "probe" }, masterLog, ctx)
  }
}

function dispatchP2Reallocs(
  ns: NS,
  dnet: DnetApi,
  workerPool: WorkerPool,
  masterLog: MasterActionLog,
  ctx: WorkerDispatchCtx,
): void {
  if (!dnet.memoryReallocation || !dnet.getBlockedRam) return

  for (const wi of workerPool.idleWorkers()) {
    const ram = readHostRam(ns, dnet, wi.host)
    wi.blockedRam = ram.blockedRam
    if (!needsRealloc(ns, dnet, wi.host, 2, ram)) continue
    sendCommand(ns, wi, { type: "realloc", host: wi.host, priority: 2 }, masterLog, ctx)
  }
}

function dispatchP3Reallocs(
  ns: NS,
  dnet: DnetApi,
  workerPool: WorkerPool,
  masterLog: MasterActionLog,
  ctx: WorkerDispatchCtx,
): void {
  if (!dnet.memoryReallocation || !dnet.getBlockedRam) return

  for (const wi of workerPool.idleWorkers()) {
    const ram = readHostRam(ns, dnet, wi.host)
    wi.blockedRam = ram.blockedRam
    if (!needsRealloc(ns, dnet, wi.host, 3, ram)) continue
    sendCommand(ns, wi, { type: "realloc", host: wi.host, priority: 3 }, masterLog, ctx)
  }
}

function dispatchP1Reallocs(
  ns: NS,
  sessionId: number,
  workerPool: WorkerPool,
  portPool: PortPool,
  targets: Map<string, AuthTarget>,
  pendingSpawns: Set<string>,
  spawnPlans: Map<string, SpawnPlan>,
  dnet: DnetApi,
  passwords: Map<string, string>,
  masterLog: MasterActionLog,
  ctx: WorkerDispatchCtx,
): void {
  if (!dnet.memoryReallocation || !dnet.getBlockedRam) return

  type Candidate = { target: AuthTarget; existingPlan: SpawnPlan | undefined }
  const candidates: Candidate[] = []

  for (const target of targets.values()) {
    if (target.host === DARKWEB) continue
    if (target.status !== "solved") continue
    if (workerPool.workers.has(target.host)) {
      const wi = workerPool.workers.get(target.host)!
      if (isWorkerAlive(ns, wi)) continue
    }
    if (pendingSpawns.has(target.host)) continue

    const details = getServerDetails(dnet, target.host)
    if (!details?.isOnline) continue

    const knownPassword = target.password ?? passwords.get(target.host) ?? null
    const authed = knownPassword != null || details.hasSession
    if (!authed) continue

    const ram = readHostRam(ns, dnet, target.host)
    if (canSpawnWorker(ns, dnet, target.host, ram)) continue
    if (!needsRealloc(ns, dnet, target.host, 1, ram)) continue

    candidates.push({ target, existingPlan: spawnPlans.get(target.host) })
  }

  const spawnParentsFor = (host: string) => availableSpawnParents(workerPool, host, new Set())
  const sorted = sortByWorkerScarcity(
    candidates,
    ({ target, existingPlan }) => {
      const pinned = existingPlan ? workerPool.workers.get(existingPlan.parentHost) : null
      if (pinned?.idle && pinned.commandPort > 0) return 1
      return spawnParentsFor(target.host).length
    },
    ({ target }) => target.host,
  )
  const batchKeys = sorted.map(({ target }) => target.host)

  for (const { target, existingPlan } of sorted) {
    const knownPassword = target.password ?? passwords.get(target.host) ?? null
    const pinned = existingPlan ? workerPool.workers.get(existingPlan.parentHost) : null
    const parent =
      pinned?.idle && pinned.commandPort > 0
        ? pinned
        : pickLeastBlockingWorker(
            target.host,
            spawnParentsFor(target.host),
            batchKeys,
            spawnParentsFor,
          )
    if (!parent?.idle || parent.commandPort <= 0) continue

    if (!existingPlan) {
      spawnPlans.set(target.host, {
        targetHost: target.host,
        parentHost: parent.host,
        sessionId,
        ...(knownPassword != null ? { password: knownPassword } : {}),
        port: 0,
        phase: "realloc",
      })
    }

    if (
      !sendCommand(
        ns,
        parent,
        { type: "realloc", host: target.host, priority: 1 },
        masterLog,
        ctx,
      )
    ) {
      abortSpawnPlan(target.host, spawnPlans, pendingSpawns, workerPool, portPool, ns)
    }
  }
}

function dispatchGuesses(
  ns: NS,
  workerPool: WorkerPool,
  targets: Map<string, AuthTarget>,
  attemptLog: AttemptLog,
  dnet: DnetApi,
  masterLog: MasterActionLog,
  ctx: WorkerDispatchCtx,
): void {
  type Candidate = { target: AuthTarget; details: ServerDetails }
  const candidates: Candidate[] = []

  for (const target of targets.values()) {
    if (target.status !== "active" && target.status !== "waiting_worker") continue
    if (target.pendingGuess != null) continue
    if (target.awaitProbeAfter) continue

    const details = getServerDetails(dnet, target.host)
    if (!details?.isOnline) {
      target.status = "offline"
      continue
    }

    if (details.modelId === LABYRINTH_MODEL) continue

    const solver = lookupSolver(details)
    if (!solver || target.solverState == null) continue

    candidates.push({ target, details })
  }

  const authWorkersFor = (host: string) => {
    const target = targets.get(host)
    if (!target) return []
    return availableAuthWorkers(workerPool, target.neighborWorkers, new Set())
  }

  const sorted = sortByWorkerScarcity(
    candidates,
    ({ target }) => authWorkersFor(target.host).length,
    ({ target }) => target.host,
  )
  const batchKeys = sorted.map(({ target }) => target.host)

  for (const { target, details } of sorted) {
    const solver = lookupSolver(details)!
    const wi = pickLeastBlockingWorker(
      target.host,
      authWorkersFor(target.host),
      batchKeys,
      authWorkersFor,
    )
    if (!wi) {
      target.status = "waiting_worker"
      continue
    }

    const next = solver.nextGuess(target.solverState as SolverState, { target: target.host, details })
    if (!next) {
      if (target.lastError === "neighbor link lost") {
        target.status = "waiting_worker"
        continue
      }
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

    if (
      !sendCommand(
        ns,
        wi,
        {
          type: "auth",
          target: target.host,
          solverId: target.solverId ?? "-",
          guess: next.guess,
          detail: next.detail,
        },
        masterLog,
        ctx,
      )
    ) {
      undoDispatchedGuess(target)
      target.status = "waiting_worker"
      continue
    }

    target.pendingGuess = next.guess
    target.pendingDetail = next.detail
    target.workerHost = wi.host
    target.status = "active"
    target.lastError = null

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
  }
}

function spawnWorkers(
  ns: NS,
  sessionId: number,
  workerPool: WorkerPool,
  portPool: PortPool,
  targets: Map<string, AuthTarget>,
  pendingSpawns: Set<string>,
  spawnPlans: Map<string, SpawnPlan>,
  dnet: DnetApi,
  passwords: Map<string, string>,
  masterLog: MasterActionLog,
  ctx: WorkerDispatchCtx,
): void {
  for (const target of targets.values()) {
    if (target.host === DARKWEB) continue
    if (!workerPool.workers.has(target.host)) continue
    const wi = workerPool.workers.get(target.host)!
    if (isWorkerAlive(ns, wi)) continue
    dropWorker(ns, target.host, workerPool, portPool, pendingSpawns, spawnPlans, masterLog, "dead")
  }

  type Candidate = { target: AuthTarget; existingPlan: SpawnPlan | undefined }
  const candidates: Candidate[] = []

  for (const target of targets.values()) {
    if (target.host === DARKWEB) continue
    if (target.status !== "solved") continue
    if (workerPool.workers.has(target.host)) {
      const wi = workerPool.workers.get(target.host)!
      if (isWorkerAlive(ns, wi)) continue
    }
    if (pendingSpawns.has(target.host)) continue

    const details = getServerDetails(dnet, target.host)
    if (!details?.isOnline) continue

    const knownPassword = target.password ?? passwords.get(target.host) ?? null
    const authed = knownPassword != null || details.hasSession
    if (!authed) continue

    const ram = readHostRam(ns, dnet, target.host)
    if (!canSpawnWorker(ns, dnet, target.host, ram)) continue

    candidates.push({ target, existingPlan: spawnPlans.get(target.host) })
  }

  const spawnParentsFor = (host: string) => availableSpawnParents(workerPool, host, new Set())
  const sorted = sortByWorkerScarcity(
    candidates,
    ({ target, existingPlan }) => {
      const pinned = existingPlan ? workerPool.workers.get(existingPlan.parentHost) : null
      if (pinned?.idle && pinned.commandPort > 0) return 1
      return spawnParentsFor(target.host).length
    },
    ({ target }) => target.host,
  )
  const batchKeys = sorted.map(({ target }) => target.host)

  for (const { target, existingPlan } of sorted) {
    const knownPassword = target.password ?? passwords.get(target.host) ?? null
    if (knownPassword != null) tryConnect(dnet, target.host, knownPassword)

    const pinned = existingPlan ? workerPool.workers.get(existingPlan.parentHost) : null
    const parent =
      pinned?.idle && pinned.commandPort > 0
        ? pinned
        : pickLeastBlockingWorker(
            target.host,
            spawnParentsFor(target.host),
            batchKeys,
            spawnParentsFor,
          )
    if (!parent?.idle || parent.commandPort <= 0) continue

    let plan = spawnPlans.get(target.host)
    if (!plan) {
      const port = portPool.allocate()
      if (port <= 0) continue
      clearWorkerPortPair(ns, port)
      plan = {
        targetHost: target.host,
        parentHost: parent.host,
        sessionId,
        ...(knownPassword != null ? { password: knownPassword } : {}),
        port,
        phase: "spawn",
      }
      spawnPlans.set(target.host, plan)
      workerPool.register(target.host, 0, port)
    } else if (plan.phase === "realloc") {
      plan.parentHost = parent.host
      plan.phase = "spawn"
      if (plan.port <= 0) {
        const port = portPool.allocate()
        if (port <= 0) continue
        clearWorkerPortPair(ns, port)
        plan.port = port
        workerPool.register(target.host, 0, port)
      }
    } else {
      plan.parentHost = parent.host
    }

    pendingSpawns.add(target.host)
    if (
      !sendCommand(
        ns,
        parent,
        {
          type: "spawn",
          target: target.host,
          sessionId: plan.sessionId,
          port: plan.port,
          ...(plan.password != null ? { password: plan.password } : {}),
        },
        masterLog,
        ctx,
      )
    ) {
      abortSpawnPlan(target.host, spawnPlans, pendingSpawns, workerPool, portPool, ns)
    }
  }
}

function commandDetail(host: string, payload: WorkerCommandPayload): string {
  switch (payload.type) {
    case "probe":
      return host
    case "spawn":
      return `${host} -> ${payload.target} port ${payload.port}`
    case "auth":
      return `${host} -> ${payload.target} ${payload.guess}`
    case "realloc":
      return `${host} -> ${payload.host} p${payload.priority}`
    case "stasis":
      return host
    case "heartbleed":
      return `${host} -> ${payload.target}`
    case "labreport":
      return `${host} -> ${payload.target}`
    default:
      return host
  }
}

interface WorkerDispatchCtx {
  workerPool: WorkerPool
  portPool: PortPool
  pendingSpawns: Set<string>
  spawnPlans: Map<string, SpawnPlan>
  targets?: Map<string, AuthTarget>
}

function abortSpawnPlan(
  targetHost: string,
  spawnPlans: Map<string, SpawnPlan>,
  pendingSpawns: Set<string>,
  workerPool: WorkerPool,
  portPool: PortPool,
  ns: NS,
): void {
  const plan = spawnPlans.get(targetHost)
  spawnPlans.delete(targetHost)
  pendingSpawns.delete(targetHost)
  if (plan == null || plan.port <= 0) return
  const ghost = workerPool.workers.get(targetHost)
  if (ghost?.commandPort) releaseWorkerPort(ns, portPool, ghost.commandPort)
  workerPool.remove(targetHost)
}

function clearTargetWorkerRefs(targets: Map<string, AuthTarget>, workerHost: string): void {
  for (const t of targets.values()) {
    if (t.workerHost !== workerHost) continue
    t.workerHost = null
    t.pendingGuess = null
    if (t.status === "active") t.status = "waiting_worker"
  }
}

function sendCommand(
  ns: NS,
  wi: ManagedWorker,
  payload: WorkerCommandPayload,
  masterLog: MasterActionLog,
  ctx: WorkerDispatchCtx,
): boolean {
  if (wi.commandPort <= 0) {
    dropWorker(ns, wi.host, ctx.workerPool, ctx.portPool, ctx.pendingSpawns, ctx.spawnPlans, masterLog, "no port")
    return false
  }
  if (wi.pid > 0 && !ns.isRunning(wi.pid)) {
    dropWorker(ns, wi.host, ctx.workerPool, ctx.portPool, ctx.pendingSpawns, ctx.spawnPlans, masterLog, "dead")
    if (ctx.targets) clearTargetWorkerRefs(ctx.targets, wi.host)
    return false
  }

  const now = Date.now()
  wi.lastCommand = formatCommand(payload)
  wi.idle = false

  if (usesWorkerDeadlines(payload)) {
    wi.commandDeadlineAt = now + FIRST_REPLY_MS
  } else if (isInstantCommand(payload)) {
    wi.commandDeadlineAt = now + INSTANT_CMD_FALLBACK_MS
  } else {
    wi.commandDeadlineAt = now + WORKER_TIMEOUT_MS
  }

  ns.writePort(wi.commandPort, JSON.stringify(payload))
  masterLog.append(payload.type, commandDetail(wi.host, payload))
  return true
}

function isWorkerAlive(ns: NS, wi: ManagedWorker): boolean {
  // PID is global; host-based isRunning from home is unreliable on darknet hosts.
  if (wi.pid <= 0) return true
  return ns.isRunning(wi.pid)
}

function releaseWorkerPort(ns: NS, portPool: PortPool, commandPort: number): void {
  clearWorkerPortPair(ns, commandPort)
  portPool.release(commandPort)
}

function dropWorker(
  ns: NS,
  host: string,
  workerPool: WorkerPool,
  portPool: PortPool,
  pendingSpawns: Set<string>,
  spawnPlans: Map<string, SpawnPlan>,
  masterLog: MasterActionLog,
  reason: string,
): void {
  pendingSpawns.delete(host)
  for (const [targetHost, plan] of [...spawnPlans]) {
    if (targetHost === host || plan.parentHost === host) {
      abortSpawnPlan(targetHost, spawnPlans, pendingSpawns, workerPool, portPool, ns)
    }
  }
  const wi = workerPool.workers.get(host)
  if (!wi) return
  if (wi.commandPort > 0) releaseWorkerPort(ns, portPool, wi.commandPort)
  workerPool.remove(host)
  masterLog.append("prune", `${host} (${reason})`)
}

function reconcileProbeStatuses(
  msg: Extract<WorkerResponse, { type: "probeResult" }>,
  targets: Map<string, AuthTarget>,
  passwords: Map<string, string>,
  dnet: DnetApi,
  attemptLog: AttemptLog,
): void {
  let authedNoWorker = 0
  let unauthed = 0
  let skipped = 0

  for (const st of msg.neighborStatus) {
    if (!st.detailsKnown) {
      skipped++
      continue
    }

    const target = targets.get(st.host)
    const knownPassword = target?.password ?? passwords.get(st.host) ?? null

    if (!st.isOnline) {
      if (target) target.status = "offline"
      continue
    }

    // Not a direct neighbor of the probing worker right now — auth/worker flags are not trustworthy.
    if (!st.isConnected) {
      skipped++
      continue
    }

    if (knownPassword != null) {
      if (!st.hasSession) tryConnect(dnet, st.host, knownPassword)
      if (target && target.status !== "unsupported" && target.status !== "offline") {
        target.status = "solved"
        target.password = knownPassword
      }
      if (st.workerKnown && !st.workerRunning) authedNoWorker++
      continue
    }

    if (st.hasSession) {
      if (target && target.status !== "unsupported" && target.status !== "offline") {
        target.status = "solved"
      }
      if (st.workerKnown && !st.workerRunning) authedNoWorker++
      continue
    }

    unauthed++
    if (target?.status === "solved" && target.password == null && !passwords.has(st.host)) {
      target.status = "queued"
      target.solverState = null
    }
  }

  attemptLog.append({
    host: msg.workerHost,
    session: 0,
    kind: "probe",
    solverId: "-",
    modelId: "-",
    workerHost: msg.workerHost,
    note:
      `${msg.neighbors.length} neighbors, ${unauthed} unauthed, ${authedNoWorker} authed/no worker` +
      (skipped > 0 ? `, ${skipped} skipped (unknown/unreachable)` : ""),
  })
}

function failWorkerCommand(
  wi: ManagedWorker,
  targets: Map<string, AuthTarget>,
  spawnPlans: Map<string, SpawnPlan>,
  pendingSpawns: Set<string>,
  workerPool: WorkerPool,
  portPool: PortPool,
  ns: NS,
  masterLog: MasterActionLog,
): void {
  wi.idle = true
  wi.commandDeadlineAt = 0
  masterLog.append("timeout", `${wi.host} command ${wi.lastCommand ?? "?"}`)
  for (const t of targets.values()) {
    if (t.workerHost !== wi.host) continue
    undoDispatchedGuess(t)
    t.workerHost = null
    t.pendingGuess = null
    t.status = "active"
  }
  for (const [targetHost, plan] of spawnPlans) {
    if (plan.parentHost === wi.host) {
      abortSpawnPlan(targetHost, spawnPlans, pendingSpawns, workerPool, portPool, ns)
    }
  }
}

function checkCommandDeadlines(
  workerPool: WorkerPool,
  targets: Map<string, AuthTarget>,
  spawnPlans: Map<string, SpawnPlan>,
  pendingSpawns: Set<string>,
  portPool: PortPool,
  ns: NS,
  masterLog: MasterActionLog,
): void {
  const now = Date.now()
  for (const wi of workerPool.workers.values()) {
    if (wi.idle) continue
    if (wi.commandDeadlineAt <= 0) continue
    if (now <= wi.commandDeadlineAt + DEADLINE_GRACE_MS) continue
    failWorkerCommand(wi, targets, spawnPlans, pendingSpawns, workerPool, portPool, ns, masterLog)
  }
}

function pruneWorkers(
  ns: NS,
  workerPool: WorkerPool,
  portPool: PortPool,
  targets: Map<string, AuthTarget>,
  pendingSpawns: Set<string>,
  spawnPlans: Map<string, SpawnPlan>,
  masterLog: MasterActionLog,
): void {
  const now = Date.now()
  for (const [host, wi] of workerPool.workers) {
    if (wi.commandPort <= 0) {
      dropWorker(ns, host, workerPool, portPool, pendingSpawns, spawnPlans, masterLog, "no port")
      continue
    }
    if (wi.pid <= 0 && now - wi.lastActivityAt > WORKER_TIMEOUT_MS) {
      dropWorker(ns, host, workerPool, portPool, pendingSpawns, spawnPlans, masterLog, "spawn timeout")
      continue
    }
    if (wi.pid > 0 && !isWorkerAlive(ns, wi)) {
      dropWorker(ns, host, workerPool, portPool, pendingSpawns, spawnPlans, masterLog, "dead")
      continue
    }
  }
}