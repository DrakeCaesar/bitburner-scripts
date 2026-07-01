import { LABYRINTH_MODEL, EXHAUSTED_RETRY_MS } from "../constants.js"
import type { AttemptLog } from "../history/attemptLog.js"
import {
  anyWorkRemaining,
  buildLabyrinthSnapshots,
  globalFrontierRemaining,
  needsLabreport,
  planMove,
  repairState,
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

/** Idle workers that can reach the labyrinth (on it or directly adjacent). */
export function labyrinthExplorers(workerPool: WorkerPool, labyrinthHost: string): ManagedWorker[] {
  const out: ManagedWorker[] = []
  for (const wi of workerPool.workers.values()) {
    if (!wi.idle || wi.commandPort <= 0) continue
    if (wi.host !== labyrinthHost && !wi.neighbors.includes(labyrinthHost)) continue
    out.push(wi)
  }
  return out.sort((a, b) => a.host.localeCompare(b.host))
}

export function allLabyrinthExplorers(workerPool: WorkerPool, labyrinthHost: string): string[] {
  const hosts = new Set<string>()
  for (const wi of workerPool.workers.values()) {
    if (wi.host === labyrinthHost || wi.neighbors.includes(labyrinthHost)) {
      hosts.add(wi.host)
    }
  }
  return [...hosts].sort()
}

function reactivateFalseExhausted(targets: Map<string, AuthTarget>, workerPool: WorkerPool): void {
  for (const target of targets.values()) {
    if (target.modelId !== LABYRINTH_MODEL) continue
    if (target.status !== "exhausted" && target.status !== "retry_wait") continue
    const lab = asLabyrinthState(target.solverState)
    if (!lab) continue
    repairState(lab)
    const adjacent = allLabyrinthExplorers(workerPool, target.host)
    if (adjacent.length === 0) continue
    if (globalFrontierRemaining(lab.map) || anyWorkRemaining(lab, adjacent)) {
      target.status = "waiting_worker"
      target.retryAt = null
      target.lastError = null
    }
  }
}

export interface LabyrinthDispatchDeps {
  workerPool: WorkerPool
  targets: Map<string, AuthTarget>
  attemptLog: AttemptLog
  sendCommand: (wi: ManagedWorker, payload: WorkerCommandPayload) => boolean
  cloneState: <T>(value: T) => T
}

export function dispatchLabyrinth(deps: LabyrinthDispatchDeps): void {
  const { workerPool, targets, attemptLog, sendCommand, cloneState } = deps

  reactivateFalseExhausted(targets, workerPool)

  for (const target of targets.values()) {
    if (target.modelId !== LABYRINTH_MODEL) continue
    if (target.status !== "active" && target.status !== "waiting_worker") continue
    if (target.pendingGuess != null) continue
    if (target.awaitProbeAfter) continue

    const lab = asLabyrinthState(target.solverState)
    if (!lab) continue

    repairState(lab)

    const explorers = labyrinthExplorers(workerPool, target.host)
    const allAdjacent = allLabyrinthExplorers(workerPool, target.host)

    for (const wi of explorers) {
      const workerHost = wi.host
      const sess = lab.sessions[workerHost]

      if (needsLabreport(lab, workerHost)) {
        if (
          !sendCommand(wi, {
            type: "labreport",
            target: target.host,
            solverId: target.solverId ?? "labyrinth",
          })
        ) {
          continue
        }
        target.pendingGuess = "labreport"
        target.pendingDetail = `labreport@${workerHost}`
        target.workerHost = workerHost
        target.status = "active"
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

      target.pendingGuess = dir
      target.pendingDetail = `move ${dir}@${workerHost}`
      target.workerHost = workerHost
      target.status = "active"
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

    if (
      allAdjacent.length > 0 &&
      !globalFrontierRemaining(lab.map) &&
      !anyWorkRemaining(lab, allAdjacent)
    ) {
      target.status = "exhausted"
      target.retryAt = Date.now() + EXHAUSTED_RETRY_MS
      attemptLog.append({
        host: target.host,
        session: target.session,
        kind: "session_end",
        solverId: target.solverId ?? "labyrinth",
        modelId: target.modelId,
        success: false,
        note: "labyrinth explored (no exit found)",
        solverState: cloneState(lab),
      })
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
