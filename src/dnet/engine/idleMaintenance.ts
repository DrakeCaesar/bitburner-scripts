import type { NS } from "@ns"
import { DARKWEB, LABYRINTH_MODEL } from "../constants.js"
import { getServerDetails, readStasisSnapshot, stasisLinkedHosts } from "../api/server.js"
import { canExecStasis, canSpawnWorker, needsRealloc, readHostRam } from "./memoryPlan.js"
import {
  isTargetAuthed,
  isTargetReadyForWorker,
} from "./targetState.js"
import { availableAuthWorkers, availableSpawnParents } from "./workerAssign.js"
import type { MutationSync } from "./mutationSync.js"
import { labyrinthExplorers } from "./labyrinthDispatch.js"
import { collectLabyrinthHosts, labyrinthNeighborWorkerHosts, workerHostAuthed } from "./labyrinthStasis.js"
import { lookupSolver } from "../solvers/registry.js"
import type { AuthTarget, DnetApi } from "../types.js"
import type { ManagedWorker, WorkerPool } from "../pool/workers.js"
import type { WorkerCommandPayload } from "../worker/protocol.js"

/** Ensures idle migration runs only after a full worker probe sweep completes. */
export class IdleMaintenanceGate {
  private active = false
  private pendingProbes = new Set<string>()

  reset(): void {
    this.active = false
    this.pendingProbes.clear()
  }

  /** Probe sweep in progress (still waiting for one or more probeResult replies). */
  isProbing(): boolean {
    return this.active && this.pendingProbes.size > 0
  }

  /** All workers probed for this idle cycle; safe to evaluate migration. */
  isReady(): boolean {
    return this.active && this.pendingProbes.size === 0
  }

  beginSweep(workerPool: WorkerPool): void {
    this.active = true
    this.pendingProbes.clear()
    for (const wi of workerPool.workers.values()) {
      if (wi.commandPort > 0) this.pendingProbes.add(wi.host)
    }
  }

  markProbed(host: string): void {
    this.pendingProbes.delete(host)
  }

  /** Worker left the pool; do not block migration on it. */
  abandonHost(host: string): void {
    this.markProbed(host)
  }

  pendingHosts(): readonly string[] {
    return [...this.pendingProbes]
  }
}

interface SpawnPlanLike {
  parentHost: string
}

export interface IdleMaintenanceCtx {
  ns: NS
  dnet: DnetApi
  workerPool: WorkerPool
  targets: Map<string, AuthTarget>
  passwords: Map<string, string>
  pendingSpawns: Set<string>
  spawnPlans: Map<string, SpawnPlanLike>
}

/** True when no auth/spawn/labyrinth/P1/P2 work is pending (P3 blocked-RAM cleanup may still apply). */
export function isIdleMaintenanceOnly(ctx: IdleMaintenanceCtx): boolean {
  if (ctx.pendingSpawns.size > 0) return false
  if (hasInFlightAuth(ctx.targets)) return false
  if (hasPendingAuthWork(ctx)) return false
  if (hasPendingSpawnWork(ctx)) return false
  if (hasPendingP1Work(ctx)) return false
  if (hasPendingP2Work(ctx)) return false
  if (hasPendingLabyrinthWork(ctx)) return false
  if (hasPendingStasisWork(ctx)) return false
  return true
}

function hasInFlightAuth(targets: Map<string, AuthTarget>): boolean {
  for (const target of targets.values()) {
    if (target.pendingGuess != null) return true
  }
  return false
}

function hasPendingAuthWork(ctx: IdleMaintenanceCtx): boolean {
  for (const target of ctx.targets.values()) {
    if (target.status !== "active" && target.status !== "waiting_worker") continue
    if (target.pendingGuess != null) continue
    if (target.awaitProbeAfter) continue

    const details = getServerDetails(ctx.dnet, target.host)
    if (!details?.isOnline) continue
    if (isTargetAuthed(target, ctx.dnet, ctx.passwords)) continue
    if (details.modelId === LABYRINTH_MODEL) continue

    const solver = lookupSolver(details)
    if (!solver || target.solverState == null) continue
    if (availableAuthWorkers(ctx.workerPool, target.neighborWorkers, new Set()).length === 0) continue
    return true
  }
  return false
}

function hasPendingSpawnWork(ctx: IdleMaintenanceCtx): boolean {
  const linked = stasisLinkedHosts(ctx.dnet)

  for (const target of ctx.targets.values()) {
    if (target.host === DARKWEB) continue
    if (!isTargetReadyForWorker(target, ctx.dnet, ctx.passwords)) continue
    if (ctx.workerPool.workers.has(target.host)) {
      const wi = ctx.workerPool.workers.get(target.host)!
      if (wi.pid <= 0 || ctx.ns.isRunning(wi.pid)) continue
    }
    if (ctx.pendingSpawns.has(target.host)) continue

    const details = getServerDetails(ctx.dnet, target.host)
    if (!details?.isOnline) continue

    const ram = readHostRam(ctx.ns, ctx.dnet, target.host)
    if (!canSpawnWorker(ctx.ns, ctx.dnet, target.host, ram)) continue

    const pinned = ctx.spawnPlans.get(target.host)?.parentHost
    const pinnedWorker = pinned ? ctx.workerPool.workers.get(pinned) : null
    if (pinnedWorker?.idle && pinnedWorker.commandPort > 0) return true
    if (availableSpawnParents(ctx.workerPool, target.host, new Set(), { stasisLinked: linked }).length > 0) {
      return true
    }
  }
  return false
}

function hasPendingP1Work(ctx: IdleMaintenanceCtx): boolean {
  if (!ctx.dnet.memoryReallocation || !ctx.dnet.getBlockedRam) return false
  const linked = stasisLinkedHosts(ctx.dnet)

  for (const target of ctx.targets.values()) {
    if (target.host === DARKWEB) continue
    if (!isTargetReadyForWorker(target, ctx.dnet, ctx.passwords)) continue
    if (ctx.workerPool.workers.has(target.host)) {
      const wi = ctx.workerPool.workers.get(target.host)!
      if (wi.pid <= 0 || ctx.ns.isRunning(wi.pid)) continue
    }
    if (ctx.pendingSpawns.has(target.host)) continue

    const details = getServerDetails(ctx.dnet, target.host)
    if (!details?.isOnline) continue

    const ram = readHostRam(ctx.ns, ctx.dnet, target.host)
    if (canSpawnWorker(ctx.ns, ctx.dnet, target.host, ram)) continue
    if (!needsRealloc(ctx.ns, ctx.dnet, target.host, 1, ram)) continue

    const pinned = ctx.spawnPlans.get(target.host)?.parentHost
    const pinnedWorker = pinned ? ctx.workerPool.workers.get(pinned) : null
    if (pinnedWorker?.idle && pinnedWorker.commandPort > 0) return true
    if (
      availableSpawnParents(ctx.workerPool, target.host, new Set(), {
        stasisLinked: linked,
        allowRemoteRoot: false,
      }).length > 0
    ) {
      return true
    }
  }
  return false
}

function hasPendingP2Work(ctx: IdleMaintenanceCtx): boolean {
  if (!ctx.dnet.memoryReallocation || !ctx.dnet.getBlockedRam) return false
  for (const wi of ctx.workerPool.idleWorkers()) {
    const ram = readHostRam(ctx.ns, ctx.dnet, wi.host)
    if (needsRealloc(ctx.ns, ctx.dnet, wi.host, 2, ram)) return true
  }
  return false
}

function hasPendingLabyrinthWork(ctx: IdleMaintenanceCtx): boolean {
  for (const target of ctx.targets.values()) {
    if (target.modelId !== LABYRINTH_MODEL) continue
    if (target.status !== "active" && target.status !== "waiting_worker") continue
    if (target.awaitProbeAfter) continue
    if (labyrinthExplorers(ctx.workerPool, target.host).length > 0) return true
  }
  return false
}

function hasPendingStasisWork(ctx: IdleMaintenanceCtx): boolean {
  if (!ctx.dnet.setStasisLink) return false
  const stasis = readStasisSnapshot(ctx.dnet)
  if (!stasis || stasis.available <= 0) return false

  const linked = new Set(stasis.linkedHosts)
  const labyrinthHosts = collectLabyrinthHosts(ctx.dnet, ctx.workerPool, ctx.targets)
  if (labyrinthHosts.size === 0) return false

  const candidates = labyrinthNeighborWorkerHosts(labyrinthHosts, ctx.workerPool).filter(
    (host) => !linked.has(host) && workerHostAuthed(ctx.dnet, host, ctx.targets, ctx.passwords),
  )
  for (const host of candidates) {
    const wi = ctx.workerPool.workers.get(host)
    if (!wi?.idle || wi.commandPort <= 0) continue
    if (canExecStasis(ctx.ns, ctx.dnet, host)) return true
  }
  return false
}

/** True when worker has a connected non-stationary neighbor shallower than itself. */
function workerCanMigrateShallowerNeighbor(dnet: DnetApi, wi: ManagedWorker): boolean {
  if (wi.depth == null || wi.neighbors.length === 0) return false
  for (const host of wi.neighbors) {
    const details = getServerDetails(dnet, host)
    if (!details?.isOnline) continue
    if (details.isStationary) continue
    if (details.depth < wi.depth) return true
  }
  return false
}

/** Command deepest idle workers to induce migration on a shallower connected neighbor. */
export function dispatchIdleMigrations(
  ctx: IdleMaintenanceCtx,
  sendMigrate: (wi: ManagedWorker, payload: Extract<WorkerCommandPayload, { type: "migrate" }>) => boolean,
): boolean {
  if (!ctx.dnet.induceServerMigration) return false

  const idle = ctx.workerPool.idleWorkers().filter((wi) => wi.depth != null)
  if (idle.length === 0) return false

  const byDepth = new Map<number, ManagedWorker[]>()
  for (const wi of idle) {
    const depth = wi.depth!
    const row = byDepth.get(depth) ?? []
    row.push(wi)
    byDepth.set(depth, row)
  }

  const depths = [...byDepth.keys()].sort((a, b) => b - a)

  let sent = false
  for (const depth of depths) {
    const candidates = byDepth
      .get(depth)!
      .filter((wi) => workerCanMigrateShallowerNeighbor(ctx.dnet, wi))
      .sort((a, b) => a.host.localeCompare(b.host))
    if (candidates.length === 0) continue
    for (const wi of candidates) {
      if (sendMigrate(wi, { type: "migrate" })) sent = true
    }
    break
  }
  return sent
}

function beginIdleProbeSweep(
  gate: IdleMaintenanceGate,
  workerPool: WorkerPool,
  mutationSync: MutationSync | undefined,
  ns: NS,
): void {
  gate.beginSweep(workerPool)
  if (!mutationSync) return
  for (const wi of workerPool.workers.values()) {
    if (wi.commandPort > 0 && !mutationSync.workerNeedsProbe(wi, ns)) {
      gate.markProbed(wi.host)
    }
  }
}

/**
 * Idle maintenance: probe every worker, wait for all probeResult replies, then migrate.
 * Resets when non-idle work appears.
 */
export function dispatchIdleMaintenance(
  ctx: IdleMaintenanceCtx,
  gate: IdleMaintenanceGate,
  sendProbe: (wi: ManagedWorker) => boolean,
  sendMigrate: (wi: ManagedWorker, payload: Extract<WorkerCommandPayload, { type: "migrate" }>) => boolean,
  mutationSync?: MutationSync,
): void {
  if (!isIdleMaintenanceOnly(ctx)) {
    gate.reset()
    return
  }

  if (!gate.isProbing() && !gate.isReady()) {
    beginIdleProbeSweep(gate, ctx.workerPool, mutationSync, ctx.ns)
  }

  if (gate.isProbing()) {
    for (const host of gate.pendingHosts()) {
      const wi = ctx.workerPool.workers.get(host)
      if (!wi || wi.commandPort <= 0) {
        gate.abandonHost(host)
        continue
      }
      if (!wi.idle) continue
      sendProbe(wi)
    }
    return
  }

  if (gate.isReady()) {
    dispatchIdleMigrations(ctx, sendMigrate)
    gate.reset()
  }
}
