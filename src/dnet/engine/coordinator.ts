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
  RegistryStore,
  syncRegistryPasswords,
  type DarknetRegistry,
} from "../registry.js"
import { getServerDetails, readStasisSnapshot, stasisLinkedHosts, tryConnect } from "../api/server.js"
import {
  isTargetAuthed,
  isTargetReadyForWorker,
  markBlockedOnWorker,
  markTargetAuthed,
  markTargetSessionLost,
  syncAllTargetAuthState,
} from "./targetState.js"
import { AttemptLog } from "../history/attemptLog.js"
import { DeadlineArchive } from "../history/deadlineArchive.js"
import { MasterActionLog } from "../history/masterActionLog.js"
import { SessionArchive } from "../history/sessionArchive.js"
import { PortPool, WorkerPool, type ManagedWorker } from "../pool/workers.js"
import { lookupSolver, lookupSolverForTarget, solverKey, solverWorkerKey, solverWorkerKeyForTarget } from "../solvers/registry.js"
import { createSolverBridge, SolverWorkerFatalError, solverWorkerFailureReason, type SolverBridge } from "../solvers/solverBridge.js"
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
import { dispatchIdleMaintenance, IdleMaintenanceGate } from "./idleMaintenance.js"
import { dispatchLabyrinth, snapshotLabyrinths } from "./labyrinthDispatch.js"
import { applyLabreport, clearLabyrinthPending, labyrinthPendingMatches, pruneLabyrinthWorker, type LabyrinthState } from "../solvers/labyrinth.js"
import { clearDnetGlobalPorts, clearWorkerPortPair } from "./ports.js"
import { killAllWorkers, killAllWorkersSync } from "./workerLifecycle.js"
import {
  availableAuthWorkers,
  availableSpawnParents,
  isRemoteStasisSpawn,
  pickLeastBlockingWorker,
  sortByWorkerScarcity,
} from "./workerAssign.js"

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function markSolverWorkerFailure(
  target: AuthTarget,
  err: SolverWorkerFatalError,
  attemptLog: AttemptLog,
  solverBridge: SolverBridge,
): void {
  solverBridge.resetWorker()

  target.pendingGuess = null
  target.pendingDetail = null
  target.workerHost = null

  const reason = solverWorkerFailureReason(err)
  target.status = "exhausted"
  target.retryAt = Date.now() + EXHAUSTED_RETRY_MS
  target.lastError = reason

  attemptLog.append({
    host: target.host,
    session: target.session,
    kind: "note",
    solverId: target.solverId ?? "-",
    modelId: target.modelId,
    note: err.message.split("\n").join(" | "),
    solverState: target.solverState != null ? cloneState(target.solverState) : undefined,
  })

  attemptLog.append({
    host: target.host,
    session: target.session,
    kind: "session_end",
    solverId: target.solverId ?? "-",
    modelId: target.modelId,
    success: false,
    note: reason,
    solverState: target.solverState != null ? cloneState(target.solverState) : undefined,
  })
}

function shutdownWorkers(
  ns: NS,
  workerPool: WorkerPool,
  dnet: DnetApi,
  registry: DarknetRegistry,
): void {
  for (const wi of workerPool.workers.values()) {
    if (wi.commandPort <= 0) continue
    try {
      ns.writePort(wi.commandPort, JSON.stringify({ type: "exit" }))
    } catch {
      /* port gone */
    }
  }
  killAllWorkersSync(ns, dnet, registry)
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
  const deadlineArchive = new DeadlineArchive()
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
  const idleMaintenanceGate = new IdleMaintenanceGate()
  const solverBridge = createSolverBridge(ns)
  const registryStore = new RegistryStore(loadDarknetRegistry(ns))
  registryStore.pruneInvalidHosts(dnet)
  const registry = registryStore.data
  const loreStore = createLoreStore(ns, DARKNET_LORE_FILE)
  const cacheOpens: CacheOpenRecord[] = []
  const fileIntelCtx = { registryStore, cacheOpens, loreStore, loreFile: DARKNET_LORE_FILE }

  ns.atExit(() => {
    registryStore.flush(ns)
    shutdownWorkers(ns, workerPool, dnet, registry)
  })

  await killAllWorkers(ns, dnet, registry)
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

    const dispatchCtx: WorkerDispatchCtx = {
      workerPool,
      portPool,
      pendingSpawns,
      spawnPlans,
      targets,
      dnet,
      passwords,
      sessionArchive,
      idleMaintenanceGate,
      deadlineArchive,
    }

    await drainReplies(
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
      dispatchCtx,
      idleMaintenanceGate,
      solverBridge,
    )
    pollLorePort(ns, LORE_PORT, loreStore, DARKNET_LORE_FILE)
    syncRegistryPasswords(dnet, registry, passwords, targets, tryConnect)
    syncAllTargetAuthState(targets, dnet, passwords, sessionArchive)
    checkCommandDeadlines(
      workerPool,
      targets,
      spawnPlans,
      pendingSpawns,
      portPool,
      ns,
      masterLog,
      dnet,
      passwords,
      sessionArchive,
      idleMaintenanceGate,
      deadlineArchive,
    )
    pruneWorkers(ns, workerPool, portPool, targets, pendingSpawns, spawnPlans, masterLog, idleMaintenanceGate, deadlineArchive)
    mutationSync.tick(ns, workerPool, targets, (ts) => {
      masterLog.append("sync", `mutation ${ts} (background probes)`)
    })

    await processQueuedTargets(targets, attemptLog, sessionArchive, dnet, passwords, solverBridge)
    scheduleRetries(targets, attemptLog)
    // Dispatch priority: ... -> labyrinth -> idle probe sweep -> migrate -> P3
    dispatchUrgentProbes(ns, workerPool, urgentProbeHosts, masterLog, dispatchCtx)
    dispatchBackgroundProbes(ns, workerPool, mutationSync, urgentProbeHosts, masterLog, dispatchCtx)
    dispatchLabyrinthStasis(
      ns,
      dnet,
      workerPool,
      targets,
      passwords,
      (wi) => isWorkerAlive(ns, wi),
      (wi) => sendCommand(ns, wi, { type: "stasis" }, masterLog, dispatchCtx),
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
    await dispatchGuesses(
      ns,
      workerPool,
      targets,
      passwords,
      attemptLog,
      dnet,
      sessionArchive,
      masterLog,
      dispatchCtx,
      solverBridge,
    )
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
    dispatchP2Reallocs(ns, dnet, workerPool, masterLog, dispatchCtx)
    dispatchLabyrinth({
      workerPool,
      targets,
      attemptLog,
      cloneState,
      stasisLinked: stasisLinkedHosts(dnet),
      sendCommand: (wi, payload) => sendCommand(ns, wi, payload, masterLog, dispatchCtx),
    })
    const idleCtx = {
      ns,
      dnet,
      workerPool,
      targets,
      passwords,
      pendingSpawns,
      spawnPlans,
    }
    dispatchIdleMaintenance(
      idleCtx,
      idleMaintenanceGate,
      (wi) => sendCommand(ns, wi, { type: "probe" }, masterLog, dispatchCtx),
      (wi, payload) => sendCommand(ns, wi, payload, masterLog, dispatchCtx),
      mutationSync,
    )
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
        deadlineArchive,
      ),
    )
    registryStore.flush(ns)
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
  deadlineArchive: DeadlineArchive,
): CrawlSnapshot {
  const all = [...targets.values()]
  const count = (s: TargetStatus) => all.filter((t) => t.status === s).length
  return {
    sessionId,
    targets: all,
    attempts: attemptLog.all,
    actions: masterLog.all,
    failedSessions: sessionArchive.failedSessions,
    failedDeadlines: deadlineArchive.failedDeadlines,
    deadlineSlipStats: deadlineArchive.commandDeadlineSlipStats,
    completedCommandCount: deadlineArchive.completedCommandCount,
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
        depth: w.depth,
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
  dnet: DnetApi,
  registryStore: RegistryStore,
  passwords: Map<string, string>,
  targets: Map<string, AuthTarget>,
  sessionArchive: SessionArchive,
  attemptLog: AttemptLog,
  host: string,
): void {
  passwords.delete(host)
  registryStore.clearPassword(host)
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

async function drainReplies(
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
    registryStore: RegistryStore
    cacheOpens: CacheOpenRecord[]
    loreStore: DarknetLoreStore
    loreFile: string
  },
  masterLog: MasterActionLog,
  sessionArchive: SessionArchive,
  dispatchCtx: WorkerDispatchCtx,
  idleMaintenanceGate: IdleMaintenanceGate,
  solverBridge: SolverBridge,
): Promise<void> {
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
          sendCommand(ns, wi, { type: "probe" }, masterLog, dispatchCtx)
          break
        case "deadline":
          wi.idle = false
          wi.commandDeadlineAt = msg.deadlineAt
          dispatchCtx.deadlineArchive.onWorkerDeadline(
            msg.workerHost,
            Date.now(),
            msg.deadlineAt,
            msg.commandType,
          )
          break
        case "probeResult":
          completeTrackedCommand(dispatchCtx, msg.workerHost)
          wi.idle = true
          wi.commandDeadlineAt = 0
          wi.neighbors = msg.neighbors
          wi.freeRam = msg.freeRam
          wi.blockedRam = msg.blockedRam
          if (msg.workerDepth != null) wi.depth = msg.workerDepth
          for (const st of msg.neighborStatus) {
            if (st.depth == null) continue
            const neighborWorker = workerPool.workers.get(st.host)
            if (neighborWorker) neighborWorker.depth = st.depth
          }
          for (const neighbor of msg.neighbors) {
            noteHost(targets, dnet, neighbor, msg.workerHost, passwords, sessionArchive)
          }
          reconcileProbeStatuses(
            msg,
            targets,
            passwords,
            dnet,
            attemptLog,
            sessionArchive,
          )
          mutationSync.markWorkerProbed(msg.workerHost, workerPool, ns)
          finishUrgentProbe(msg.workerHost, targets, urgentProbeHosts)
          idleMaintenanceGate.markProbed(msg.workerHost)
          break
        case "spawnResult":
          completeTrackedCommand(dispatchCtx, msg.workerHost)
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
              dnet,
              fileIntelCtx.registryStore,
              passwords,
              targets,
              sessionArchive,
              attemptLog,
              msg.target,
            )
          }
          break
        case "authResult":
          completeTrackedCommand(dispatchCtx, msg.workerHost)
          wi.idle = true
          wi.commandDeadlineAt = 0
          await onAuthResult(
            msg,
            targets,
            passwords,
            attemptLog,
            sessionArchive,
            dnet,
            workerPool,
            urgentProbeHosts,
            solverBridge,
            fileIntelCtx.registryStore,
          )
          break
        case "heartbleedResult":
          completeTrackedCommand(dispatchCtx, wi.host)
          wi.idle = true
          wi.commandDeadlineAt = 0
          await onHeartbleedResult(msg, targets, attemptLog, dnet, solverBridge)
          break
        case "reallocResult":
          completeTrackedCommand(dispatchCtx, wi.host)
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
        case "migrateResult":
          completeTrackedCommand(dispatchCtx, msg.workerHost)
          wi.idle = true
          wi.commandDeadlineAt = 0
          attemptLog.append({
            host: msg.target || wi.host,
            session: 0,
            kind: "note",
            solverId: "-",
            modelId: "-",
            workerHost: wi.host,
            success: msg.success,
            note: msg.success
              ? `migrate ${msg.target}`
              : `migrate failed${msg.message ? `: ${msg.message}` : ""}`,
            message: msg.message,
          })
          break
        case "stasisResult":
          completeTrackedCommand(dispatchCtx, msg.workerHost)
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
          completeTrackedCommand(dispatchCtx, msg.workerHost)
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
  passwords: Map<string, string>,
  sessionArchive: SessionArchive,
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
    if (details.hasSession) {
      markTargetAuthed(target, dnet, { passwords, sessionArchive })
    }
  } else if (isTargetAuthed(target, dnet, passwords)) {
    markTargetAuthed(target, dnet, { passwords, sessionArchive })
  } else if (
    details.isConnectedToCurrentServer &&
    !details.hasSession &&
    target.password == null &&
    target.status === "solved"
  ) {
    markTargetSessionLost(target)
  }

  if (!target.neighborWorkers.includes(viaWorker)) {
    target.neighborWorkers.push(viaWorker)
  }
}

async function processQueuedTargets(
  targets: Map<string, AuthTarget>,
  attemptLog: AttemptLog,
  sessionArchive: SessionArchive,
  dnet: DnetApi,
  passwords: Map<string, string>,
  solverBridge: SolverBridge,
): Promise<void> {
  for (const target of targets.values()) {
    if (target.status !== "queued") continue
    const details = getServerDetails(dnet, target.host)
    if (!details?.isOnline) {
      target.status = "offline"
      continue
    }
    if (isTargetAuthed(target, dnet, passwords)) {
      markTargetAuthed(target, dnet, { passwords, sessionArchive })
      continue
    }
    await startAuthSession(target, details, attemptLog, sessionArchive, dnet, passwords, solverBridge)
  }
}

async function startAuthSession(
  target: AuthTarget,
  details: ServerDetails,
  log: AttemptLog,
  sessionArchive: SessionArchive,
  dnet: DnetApi,
  passwords: Map<string, string>,
  solverBridge: SolverBridge,
): Promise<void> {
  if (isTargetAuthed(target, dnet, passwords)) {
    markTargetAuthed(target, dnet, { passwords, sessionArchive })
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
  const workerKey = solverWorkerKey(details)
  const provisionalSolverId = workerKey ?? details.modelId
  sessionArchive.beginSession(target.host, target.session, provisionalSolverId, details)

  log.append({
    host: target.host,
    session: target.session,
    kind: "session_start",
    solverId: provisionalSolverId,
    modelId: target.modelId,
    note: `session ${target.session}`,
  })

  let state: SolverState
  try {
    if (solverBridge.usesWorkerSolver(workerKey)) {
      state = await solverBridge.init(workerKey, details, {
        host: target.host,
        modelId: target.modelId,
        session: target.session,
      })
    } else if (details.modelId === LABYRINTH_MODEL) {
      state = solverBridge.initInline(details.modelId, details)
    } else {
      state = solver.init(details)
    }
  } catch (err) {
    if (err instanceof SolverWorkerFatalError) {
      markSolverWorkerFailure(target, err, log, solverBridge)
      return
    }
    throw err
  }

  target.solverId = (state as SolverState).type
  target.solverState = state
  target.status = "waiting_worker"
  target.pendingGuess = null
  target.lastError = null

  log.append({
    host: target.host,
    session: target.session,
    kind: "note",
    solverId: target.solverId,
    modelId: target.modelId,
    solverState: cloneState(state),
    note: "solver initialized",
  })
}

function onLabreportResult(
  msg: Extract<WorkerResponse, { type: "labreportResult" }>,
  targets: Map<string, AuthTarget>,
  attemptLog: AttemptLog,
): void {
  const target = targets.get(msg.target)
  if (!target) return

  const lab =
    target.solverState != null && typeof target.solverState === "object"
      ? (target.solverState as LabyrinthState)
      : null
  if (lab?.type === "labyrinth") {
    if (!labyrinthPendingMatches(lab, msg.workerHost, "labreport")) {
      attemptLog.append({
        host: target.host,
        session: target.session,
        kind: "note",
        solverId: msg.solverId,
        modelId: target.modelId,
        workerHost: msg.workerHost,
        guess: "labreport",
        note: "stale labreport ignored",
      })
      return
    }
    clearLabyrinthPending(lab, msg.workerHost)
  }

  if (target.workerHost === msg.workerHost && target.pendingGuess === "labreport") {
    target.pendingGuess = null
    target.pendingDetail = null
    target.workerHost = null
  }

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

async function onAuthResult(
  msg: Extract<WorkerResponse, { type: "authResult" }>,
  targets: Map<string, AuthTarget>,
  passwords: Map<string, string>,
  attemptLog: AttemptLog,
  sessionArchive: SessionArchive,
  dnet: DnetApi,
  workerPool: WorkerPool,
  urgentProbeHosts: Set<string>,
  solverBridge: SolverBridge,
  registryStore: RegistryStore,
): Promise<void> {
  const target = targets.get(msg.target)
  if (!target) return

  const lab =
    target.modelId === LABYRINTH_MODEL &&
    target.solverState != null &&
    typeof target.solverState === "object"
      ? (target.solverState as LabyrinthState)
      : null

  if (lab?.type === "labyrinth") {
    if (!labyrinthPendingMatches(lab, msg.workerHost, msg.guess)) {
      attemptLog.append({
        host: target.host,
        session: target.session,
        kind: "note",
        solverId: msg.solverId,
        modelId: target.modelId,
        workerHost: msg.workerHost,
        guess: msg.guess,
        note: "stale labyrinth move ignored",
      })
      return
    }
    clearLabyrinthPending(lab, msg.workerHost)
    if (target.workerHost === msg.workerHost && target.pendingGuess === msg.guess) {
      target.pendingGuess = null
      target.pendingDetail = null
      target.workerHost = null
    }
  } else if (target.pendingGuess !== msg.guess || target.workerHost !== msg.workerHost) {
    attemptLog.append({
      host: target.host,
      session: target.session,
      kind: "note",
      solverId: msg.solverId,
      modelId: target.modelId,
      workerHost: msg.workerHost,
      guess: msg.guess,
      note: "stale auth result ignored",
    })
    return
  } else {
    target.pendingGuess = null
    target.pendingDetail = null
    target.workerHost = null
  }

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
    if (lab?.type === "labyrinth") {
      pruneLabyrinthWorker(lab, msg.workerHost)
    }
    if (
      markBlockedOnWorker(target, dnet, passwords, "neighbor link lost", sessionArchive)
    ) {
      return
    }
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

  if (isTransientAuthFailure(msg)) {
    if (markBlockedOnWorker(target, dnet, passwords, msg.message ?? "server unavailable", sessionArchive)) {
      return
    }
    return
  }

  target.guessCount += 1

  if (msg.success) {
    const password =
      target.modelId === LABYRINTH_MODEL ? msg.feedback ?? msg.guess : msg.guess
    const solvedAt = Date.now()
    passwords.set(target.host, password)
    registryStore.recordServerPassword(target.host, password, solvedAt)
    markTargetAuthed(target, dnet, { password, passwords, sessionArchive })
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
    return
  }

  const details = getServerDetails(dnet, target.host)
  const solver = lookupSolverForTarget(target, details)
  if (!solver || target.solverState == null) {
    if (details == null || details.isOnline === false) {
      target.status = "offline"
      target.lastError = msg.message ?? "server unreachable"
      return
    }
    target.status = "exhausted"
    target.retryAt = Date.now() + EXHAUSTED_RETRY_MS
    sessionArchive.archiveFailure(target.host, target.session, "solver state lost")
    return
  }

  const ctx = details
    ? { target: target.host, details, workerHost: msg.workerHost || undefined }
    : undefined
  const failResult = { success: false, feedback: msg.feedback, message: msg.message }
  const workerKey = solverWorkerKeyForTarget(target, details)
  try {
    if (solverBridge.usesWorkerSolver(workerKey)) {
      target.solverState = await solverBridge.applyResult(
        workerKey,
        target.solverState as SolverState,
        msg.guess,
        failResult,
        ctx,
        {
          host: target.host,
          modelId: target.modelId,
          session: target.session,
          solverId: target.solverId ?? undefined,
          feedback: msg.feedback,
        },
      )
    } else {
      target.solverState = solverBridge.applyResultInline(
        workerKey,
        target.modelId,
        target.solverState as SolverState,
        msg.guess,
        failResult,
        ctx,
      )
    }
  } catch (err) {
    if (err instanceof SolverWorkerFatalError) {
      markSolverWorkerFailure(target, err, attemptLog, solverBridge)
      return
    }
    throw err
  }

  attemptLog.append({
    host: target.host,
    session: target.session,
    kind: "note",
    solverId: msg.solverId,
    modelId: target.modelId,
    solverState: cloneState(target.solverState),
    note: "state after failed guess",
  })

  if (isTargetAuthed(target, dnet, passwords)) {
    markTargetAuthed(target, dnet, { passwords, sessionArchive })
    return
  }
  target.status = "active"
}

async function onHeartbleedResult(
  msg: Extract<WorkerResponse, { type: "heartbleedResult" }>,
  targets: Map<string, AuthTarget>,
  attemptLog: AttemptLog,
  dnet: DnetApi,
  solverBridge: SolverBridge,
): Promise<void> {
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
  const workerKey = solverWorkerKeyForTarget(target, details)
  if (solver?.applyHeartbleed && target.solverState != null) {
    try {
      if (solverBridge.usesWorkerSolver(workerKey)) {
        target.solverState = await solverBridge.applyHeartbleed(
          workerKey,
          target.solverState as SolverState,
          msg.logEntries,
          {
            host: target.host,
            modelId: target.modelId,
            session: target.session,
            solverId: target.solverId ?? undefined,
          },
        )
      } else if (workerKey) {
        target.solverState = solverBridge.applyHeartbleedInline(
          workerKey,
          target.solverState as SolverState,
          msg.logEntries,
        )
      } else {
        target.solverState = solver.applyHeartbleed(target.solverState as SolverState, msg.logEntries)
      }
    } catch (err) {
      if (err instanceof SolverWorkerFatalError) {
        markSolverWorkerFailure(target, err, attemptLog, solverBridge)
        return
      }
      throw err
    }
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
    if (target.modelId === LABYRINTH_MODEL) {
      target.status = "waiting_worker"
      target.retryAt = null
      continue
    }
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

  // One realloc step per idle pass; worker returns before auth/probes on later loops.
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

  const linked = stasisLinkedHosts(dnet)

  type Candidate = { target: AuthTarget; existingPlan: SpawnPlan | undefined }
  const candidates: Candidate[] = []

  for (const target of targets.values()) {
    if (target.host === DARKWEB) continue
    if (!isTargetReadyForWorker(target, dnet, passwords)) continue
    markTargetAuthed(target, dnet, { passwords })
    if (workerPool.workers.has(target.host)) {
      const wi = workerPool.workers.get(target.host)!
      if (isWorkerAlive(ns, wi)) continue
    }
    if (pendingSpawns.has(target.host)) continue

    const details = getServerDetails(dnet, target.host)
    if (!details?.isOnline) continue

    const ram = readHostRam(ns, dnet, target.host)
    if (canSpawnWorker(ns, dnet, target.host, ram)) continue
    if (!needsRealloc(ns, dnet, target.host, 1, ram)) continue

    candidates.push({ target, existingPlan: spawnPlans.get(target.host) })
  }

  const spawnParentsFor = (host: string) =>
    availableSpawnParents(workerPool, host, new Set(), {
      stasisLinked: linked,
      allowRemoteRoot: false,
    })
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

async function dispatchGuesses(
  ns: NS,
  workerPool: WorkerPool,
  targets: Map<string, AuthTarget>,
  passwords: Map<string, string>,
  attemptLog: AttemptLog,
  dnet: DnetApi,
  sessionArchive: SessionArchive,
  masterLog: MasterActionLog,
  ctx: WorkerDispatchCtx,
  solverBridge: SolverBridge,
): Promise<void> {
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

    if (isTargetAuthed(target, dnet, passwords)) {
      markTargetAuthed(target, dnet, { passwords, sessionArchive })
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
    const wi = pickLeastBlockingWorker(
      target.host,
      authWorkersFor(target.host),
      batchKeys,
      authWorkersFor,
    )
    if (!wi) {
      if (markBlockedOnWorker(target, dnet, passwords, "no auth worker", sessionArchive)) continue
      continue
    }

    const workerKey = solverWorkerKey(details)
    if (!solverBridge.usesWorkerSolver(workerKey)) continue

    let state: SolverState
    let next: { guess: string; detail: string | null } | null
    try {
      const result = await solverBridge.nextGuess(
        workerKey,
        target.solverState as SolverState,
        { target: target.host, details },
        {
          host: target.host,
          modelId: target.modelId,
          session: target.session,
          solverId: target.solverId ?? undefined,
        },
      )
      state = result.state
      next = result.guess
    } catch (err) {
      if (err instanceof SolverWorkerFatalError) {
        markSolverWorkerFailure(target, err, attemptLog, solverBridge)
        continue
      }
      throw err
    }
    target.solverState = state
    if (!next) {
      if (target.lastError === "neighbor link lost") {
        if (markBlockedOnWorker(target, dnet, passwords, "neighbor link lost", sessionArchive)) continue
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
      if (markBlockedOnWorker(target, dnet, passwords, "auth send failed", sessionArchive)) continue
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
  const linked = stasisLinkedHosts(dnet)

  for (const target of targets.values()) {
    if (target.host === DARKWEB) continue
    if (!workerPool.workers.has(target.host)) continue
    const wi = workerPool.workers.get(target.host)!
    if (isWorkerAlive(ns, wi)) continue
    dropWorker(ns, target.host, workerPool, portPool, pendingSpawns, spawnPlans, masterLog, "dead", ctx.idleMaintenanceGate, ctx.deadlineArchive)
  }

  type Candidate = { target: AuthTarget; existingPlan: SpawnPlan | undefined }
  const candidates: Candidate[] = []

  for (const target of targets.values()) {
    if (target.host === DARKWEB) continue
    if (!isTargetReadyForWorker(target, dnet, passwords)) continue
    markTargetAuthed(target, dnet, { passwords })
    if (workerPool.workers.has(target.host)) {
      const wi = workerPool.workers.get(target.host)!
      if (isWorkerAlive(ns, wi)) continue
    }
    if (pendingSpawns.has(target.host)) continue

    const details = getServerDetails(dnet, target.host)
    if (!details?.isOnline) continue

    const ram = readHostRam(ns, dnet, target.host)
    if (!canSpawnWorker(ns, dnet, target.host, ram)) continue

    candidates.push({ target, existingPlan: spawnPlans.get(target.host) })
  }

  const spawnParentsFor = (host: string) =>
    availableSpawnParents(workerPool, host, new Set(), { stasisLinked: linked })
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
    const remote = isRemoteStasisSpawn(parent.host, target.host, linked)
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
          ...(remote ? { remote: true } : {}),
        },
        masterLog,
        ctx,
      )
    ) {
      abortSpawnPlan(target.host, spawnPlans, pendingSpawns, workerPool, portPool, ns)
    }
  }
}

function commandTarget(payload: WorkerCommandPayload): string | undefined {
  switch (payload.type) {
    case "auth":
    case "heartbleed":
    case "labreport":
    case "spawn":
      return payload.target
    case "realloc":
      return payload.host
    default:
      return undefined
  }
}

function completeTrackedCommand(ctx: WorkerDispatchCtx, workerHost: string): void {
  ctx.deadlineArchive.complete(workerHost, Date.now())
}

function commandDetail(host: string, payload: WorkerCommandPayload): string {
  switch (payload.type) {
    case "probe":
      return host
    case "spawn":
      return payload.remote
        ? `${host} -> ${payload.target} port ${payload.port} (remote)`
        : `${host} -> ${payload.target} port ${payload.port}`
    case "auth":
      return `${host} -> ${payload.target} ${payload.guess}`
    case "realloc":
      return `${host} -> ${payload.host} p${payload.priority}`
    case "migrate":
      return `${host} migrate`
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
  dnet: DnetApi
  passwords: Map<string, string>
  sessionArchive: SessionArchive
  idleMaintenanceGate: IdleMaintenanceGate
  deadlineArchive: DeadlineArchive
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

function clearTargetWorkerRefs(ctx: WorkerDispatchCtx, workerHost: string): void {
  if (!ctx.targets) return
  for (const t of ctx.targets.values()) {
    if (t.modelId === LABYRINTH_MODEL && t.solverState != null && typeof t.solverState === "object") {
      const lab = t.solverState as LabyrinthState
      if (lab.type === "labyrinth") {
        pruneLabyrinthWorker(lab, workerHost)
      }
      if (t.workerHost === workerHost) {
        t.workerHost = null
        t.pendingGuess = null
        t.pendingDetail = null
      }
      continue
    }
    if (t.workerHost !== workerHost) continue
    t.workerHost = null
    t.pendingGuess = null
    t.pendingDetail = null
    if (t.status === "active") {
      markBlockedOnWorker(t, ctx.dnet, ctx.passwords, "worker dropped", ctx.sessionArchive)
    }
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
    dropWorker(ns, wi.host, ctx.workerPool, ctx.portPool, ctx.pendingSpawns, ctx.spawnPlans, masterLog, "no port", ctx.idleMaintenanceGate, ctx.deadlineArchive)
    return false
  }
  if (wi.pid > 0 && !ns.isRunning(wi.pid)) {
    dropWorker(ns, wi.host, ctx.workerPool, ctx.portPool, ctx.pendingSpawns, ctx.spawnPlans, masterLog, "dead", ctx.idleMaintenanceGate, ctx.deadlineArchive)
    if (ctx.targets) clearTargetWorkerRefs(ctx, wi.host)
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
  ctx.deadlineArchive.begin(
    wi.host,
    formatCommand(payload),
    payload.type,
    now,
    wi.commandDeadlineAt,
    masterLog.all.length - 1,
    commandTarget(payload),
  )
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
  idleMaintenanceGate?: IdleMaintenanceGate,
  deadlineArchive?: DeadlineArchive,
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
  idleMaintenanceGate?.abandonHost(host)
  deadlineArchive?.abandon(host)
  masterLog.append("prune", `${host} (${reason})`)
}

function reconcileProbeStatuses(
  msg: Extract<WorkerResponse, { type: "probeResult" }>,
  targets: Map<string, AuthTarget>,
  passwords: Map<string, string>,
  dnet: DnetApi,
  attemptLog: AttemptLog,
  sessionArchive: SessionArchive,
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
        markTargetAuthed(target, dnet, { password: knownPassword, passwords, sessionArchive })
      }
      if (st.workerKnown && !st.workerRunning) authedNoWorker++
      continue
    }

    if (st.hasSession) {
      if (target && target.status !== "unsupported" && target.status !== "offline") {
        markTargetAuthed(target, dnet, { passwords, sessionArchive })
      }
      if (st.workerKnown && !st.workerRunning) authedNoWorker++
      continue
    }

    unauthed++
    if (target?.status === "solved" && target.password == null && !passwords.has(st.host)) {
      markTargetSessionLost(target)
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

function isLongRunningWorkerCommand(wi: ManagedWorker): boolean {
  const cmd = wi.lastCommand ?? ""
  return (
    cmd.startsWith("auth:") || cmd.startsWith("heartbleed:") || cmd.startsWith("labreport:")
  )
}

function isTransientAuthFailure(msg: { message?: string; code?: number }): boolean {
  if (msg.code === 503) return true
  const text = msg.message ?? ""
  return text.includes("Service Unavail")
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
  dnet: DnetApi,
  passwords: Map<string, string>,
  sessionArchive: SessionArchive,
  idleMaintenanceGate?: IdleMaintenanceGate,
  deadlineArchive?: DeadlineArchive,
): void {
  if (isLongRunningWorkerCommand(wi)) {
    const extendedAt = Date.now()
    const newDeadlineAt = extendedAt + WORKER_TIMEOUT_MS
    masterLog.append("timeout_extend", `${wi.host} command ${wi.lastCommand ?? "?"} (still running)`)
    wi.commandDeadlineAt = newDeadlineAt
    deadlineArchive?.onTimeoutExtend(wi.host, extendedAt, newDeadlineAt)
    return
  }

  const failedAt = Date.now()
  wi.idle = true
  wi.commandDeadlineAt = 0
  masterLog.append("timeout", `${wi.host} command ${wi.lastCommand ?? "?"}`)
  deadlineArchive?.onTimedOut(wi.host, failedAt, masterLog.all)
  if (wi.lastCommand === "probe") {
    idleMaintenanceGate?.markProbed(wi.host)
  }
  for (const t of targets.values()) {
    if (t.workerHost !== wi.host) continue
    t.workerHost = null
    t.pendingGuess = null
    t.pendingDetail = null
    if (isTargetAuthed(t, dnet, passwords)) {
      markTargetAuthed(t, dnet, { passwords, sessionArchive })
    } else {
      t.status = "active"
    }
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
  dnet: DnetApi,
  passwords: Map<string, string>,
  sessionArchive: SessionArchive,
  idleMaintenanceGate: IdleMaintenanceGate,
  deadlineArchive: DeadlineArchive,
): void {
  const now = Date.now()
  for (const wi of workerPool.workers.values()) {
    if (wi.idle) continue
    if (wi.commandDeadlineAt <= 0) continue
    if (now <= wi.commandDeadlineAt + DEADLINE_GRACE_MS) continue
    failWorkerCommand(
      wi,
      targets,
      spawnPlans,
      pendingSpawns,
      workerPool,
      portPool,
      ns,
      masterLog,
      dnet,
      passwords,
      sessionArchive,
      idleMaintenanceGate,
      deadlineArchive,
    )
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
  idleMaintenanceGate: IdleMaintenanceGate,
  deadlineArchive: DeadlineArchive,
): void {
  const now = Date.now()
  for (const [host, wi] of workerPool.workers) {
    if (wi.commandPort <= 0) {
      dropWorker(ns, host, workerPool, portPool, pendingSpawns, spawnPlans, masterLog, "no port", idleMaintenanceGate, deadlineArchive)
      continue
    }
    if (wi.pid <= 0 && now - wi.lastActivityAt > WORKER_TIMEOUT_MS) {
      dropWorker(ns, host, workerPool, portPool, pendingSpawns, spawnPlans, masterLog, "spawn timeout", idleMaintenanceGate, deadlineArchive)
      continue
    }
    if (wi.pid > 0 && !isWorkerAlive(ns, wi)) {
      dropWorker(ns, host, workerPool, portPool, pendingSpawns, spawnPlans, masterLog, "dead", idleMaintenanceGate, deadlineArchive)
      continue
    }
  }
}