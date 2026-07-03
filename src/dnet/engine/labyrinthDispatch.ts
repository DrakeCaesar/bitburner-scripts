import { LABYRINTH_MODEL } from "../constants.js"
import type { AttemptLog } from "../history/attemptLog.js"
import {
  assignFrontierClaims,
  buildLabyrinthSnapshots,
  ensureWorkerSession,
  labyrinthWorkerPending,
  needsLabradar,
  needsLabreport,
  planMove,
  pruneLabyrinthWorkers,
  repairState,
  setLabyrinthPending,
  type LabyrinthState,
} from "../solvers/labyrinth.js"
import type { AuthTarget } from "../types.js"
import type { ManagedWorker, WorkerPool } from "../pool/workers.js"
import type { WorkerCommandPayload } from "../worker/protocol.js"

function asLabyrinthState(state: unknown): LabyrinthState | null {
  if (!state || typeof state !== "object") return null
  const row = state as LabyrinthState
  return row.type === "labyrinth" ? row : null
}

/** Drop in-flight flags for workers that are idle (e.g. after a silent command failure). */
function reconcileLabyrinthPending(lab: LabyrinthState, workerPool: WorkerPool): void {
  if (!lab.pending) return
  for (const host of Object.keys(lab.pending)) {
    const wi = workerPool.workers.get(host)
    if (!wi?.idle) continue
    delete lab.pending[host]
  }
}

/** All pool workers on the labyrinth or directly adjacent (idle or busy). */
export function labyrinthAdjacentWorkerHosts(workerPool: WorkerPool, labyrinthHost: string): Set<string> {
  const hosts = new Set<string>()
  for (const [host, wi] of workerPool.workers) {
    if (wi.commandPort <= 0) continue
    if (host === labyrinthHost || wi.neighbors.includes(labyrinthHost)) {
      hosts.add(host)
    }
  }
  return hosts
}

/** Idle workers that can reach the labyrinth (on it or directly adjacent). */
export function labyrinthExplorers(workerPool: WorkerPool, labyrinthHost: string): ManagedWorker[] {
  const out: ManagedWorker[] = []
  for (const wi of workerPool.workers.values()) {
    if (!wi.idle || wi.commandPort <= 0) continue
    if (wi.host !== labyrinthHost && !wi.neighbors.includes(labyrinthHost)) continue
    out.push(wi)
  }
  return out
}

function sortExplorers(workers: ManagedWorker[], stasisLinked: ReadonlySet<string>): ManagedWorker[] {
  return [...workers].sort((a, b) => {
    const sa = stasisLinked.has(a.host) ? 0 : 1
    const sb = stasisLinked.has(b.host) ? 0 : 1
    if (sa !== sb) return sa - sb
    return a.host.localeCompare(b.host)
  })
}

/** Labyrinths never exhaust; restore any stale exhausted/retry state. */
function keepLabyrinthPending(targets: Map<string, AuthTarget>): void {
  for (const target of targets.values()) {
    if (target.modelId !== LABYRINTH_MODEL) continue
    if (target.status !== "exhausted" && target.status !== "retry_wait") continue
    target.status = "waiting_worker"
    target.retryAt = null
    target.lastError = null
  }
}

export interface LabyrinthDispatchDeps {
  workerPool: WorkerPool
  targets: Map<string, AuthTarget>
  attemptLog: AttemptLog
  stasisLinked: ReadonlySet<string>
  sendCommand: (wi: ManagedWorker, payload: WorkerCommandPayload) => boolean
  cloneState: <T>(value: T) => T
}

export function dispatchLabyrinth(deps: LabyrinthDispatchDeps): void {
  const { workerPool, targets, attemptLog, stasisLinked, sendCommand, cloneState } = deps

  keepLabyrinthPending(targets)

  for (const target of targets.values()) {
    if (target.modelId !== LABYRINTH_MODEL) continue
    if (target.status !== "active" && target.status !== "waiting_worker") continue
    if (target.awaitProbeAfter) continue

    const lab = asLabyrinthState(target.solverState)
    if (!lab) continue

    repairState(lab)
    reconcileLabyrinthPending(lab, workerPool)

    const adjacentHosts = labyrinthAdjacentWorkerHosts(workerPool, target.host)
    const explorers = sortExplorers(labyrinthExplorers(workerPool, target.host), stasisLinked)
    pruneLabyrinthWorkers(lab, adjacentHosts)

    if (explorers.length === 0) {
      target.status = "waiting_worker"
      continue
    }

    assignFrontierClaims(
      lab,
      explorers.map((wi) => wi.host),
      stasisLinked,
    )

    let dispatchedThisLoop = false

    for (const wi of explorers) {
      const workerHost = wi.host
      if (labyrinthWorkerPending(lab, workerHost)) continue

      const sess = lab.sessions[workerHost]

      if (needsLabreport(lab, workerHost)) {
        ensureWorkerSession(lab, workerHost)
        if (
          !sendCommand(wi, {
            type: "labreport",
            target: target.host,
            solverId: target.solverId ?? "labyrinth",
          })
        ) {
          continue
        }
        setLabyrinthPending(lab, workerHost, "labreport")
        target.workerHost = workerHost
        target.pendingGuess = "labreport"
        target.pendingDetail = `labreport@${workerHost}`
        target.status = "active"
        dispatchedThisLoop = true
        attemptLog.append({
          host: target.host,
          session: target.session,
          kind: "guess_dispatch",
          solverId: target.solverId ?? "labyrinth",
          modelId: target.modelId,
          workerHost,
          guess: "labreport",
          detail: `labreport@${workerHost}`,
          solverState: cloneState(lab),
        })
        continue
      }

      if (needsLabradar(lab, workerHost) && sess?.coords) {
        if (
          !sendCommand(wi, {
            type: "labradar",
            target: target.host,
            solverId: target.solverId ?? "labyrinth",
            origin: sess.coords,
          })
        ) {
          continue
        }
        setLabyrinthPending(lab, workerHost, "labradar")
        target.workerHost = workerHost
        target.pendingGuess = "labradar"
        target.pendingDetail = `labradar@${workerHost}`
        target.status = "active"
        dispatchedThisLoop = true
        attemptLog.append({
          host: target.host,
          session: target.session,
          kind: "guess_dispatch",
          solverId: target.solverId ?? "labyrinth",
          modelId: target.modelId,
          workerHost,
          guess: "labradar",
          detail: `labradar@${workerHost}`,
          solverState: cloneState(lab),
        })
        continue
      }

      if (sess?.phase === "done") continue
      if (sess?.phase !== "move" || !sess.coords || !sess.walls) continue

      const dir = planMove(lab, workerHost)
      if (!dir) continue

      if (
        !sendCommand(wi, {
          type: "auth",
          target: target.host,
          solverId: target.solverId ?? "labyrinth",
          guess: dir,
          detail: `move ${dir}@${workerHost}`,
        })
      ) {
        continue
      }

      setLabyrinthPending(lab, workerHost, dir)
      target.workerHost = workerHost
      target.pendingGuess = dir
      target.pendingDetail = `move ${dir}@${workerHost}`
      target.status = "active"
      dispatchedThisLoop = true
      attemptLog.append({
        host: target.host,
        session: target.session,
        kind: "guess_dispatch",
        solverId: target.solverId ?? "labyrinth",
        modelId: target.modelId,
        workerHost,
        guess: dir,
        detail: `move ${dir}@${workerHost}`,
        solverState: cloneState(lab),
      })
    }

    if (!dispatchedThisLoop) {
      target.status = "waiting_worker"
      target.pendingGuess = null
      target.pendingDetail = null
      target.workerHost = null
    }
  }
}

export function snapshotLabyrinths(
  targets: Map<string, AuthTarget>,
): ReturnType<typeof buildLabyrinthSnapshots> {
  const mapped = new Map<
    string,
    {
      host: string
      status: string
      solverState: unknown | null
      workerHost: string | null
      pendingGuess: string | null
    }
  >()
  for (const t of targets.values()) {
    if (t.modelId !== LABYRINTH_MODEL) continue
    mapped.set(t.host, {
      host: t.host,
      status: t.status,
      solverState: t.solverState,
      workerHost: t.workerHost,
      pendingGuess: t.pendingGuess,
    })
  }
  return buildLabyrinthSnapshots(mapped)
}
