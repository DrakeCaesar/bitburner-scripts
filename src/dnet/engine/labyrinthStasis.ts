import type { NS } from "@ns"
import { LABYRINTH_MODEL } from "../constants.js"
import { getServerDetails, readStasisSnapshot } from "../api/server.js"
import { canExecStasis } from "./memoryPlan.js"
import { isTargetAuthed } from "./targetState.js"
import type { AuthTarget, DnetApi } from "../types.js"
import type { ManagedWorker, WorkerPool } from "../pool/workers.js"

export function isLabyrinthHost(dnet: DnetApi, hostname: string): boolean {
  const details = getServerDetails(dnet, hostname)
  return details?.modelId === LABYRINTH_MODEL
}

/** All labyrinth hostnames known from targets and worker neighbor graphs. */
export function collectLabyrinthHosts(
  dnet: DnetApi,
  workerPool: WorkerPool,
  targets: Map<string, AuthTarget>,
): Set<string> {
  const labs = new Set<string>()
  for (const target of targets.values()) {
    if (target.modelId === LABYRINTH_MODEL) labs.add(target.host)
  }
  for (const wi of workerPool.workers.values()) {
    if (isLabyrinthHost(dnet, wi.host)) labs.add(wi.host)
    for (const neighbor of wi.neighbors) {
      if (isLabyrinthHost(dnet, neighbor)) labs.add(neighbor)
    }
  }
  return labs
}

/** Worker hosts directly adjacent to a labyrinth (not the maze itself). */
export function labyrinthNeighborWorkerHosts(
  labyrinthHosts: Set<string>,
  workerPool: WorkerPool,
): string[] {
  if (labyrinthHosts.size === 0) return []
  const neighbors = new Set<string>()
  for (const [host, wi] of workerPool.workers) {
    if (labyrinthHosts.has(host)) continue
    for (const neighbor of wi.neighbors) {
      if (labyrinthHosts.has(neighbor)) neighbors.add(host)
    }
  }
  return [...neighbors].sort()
}

export function workerHostAuthed(
  dnet: DnetApi,
  host: string,
  targets: Map<string, AuthTarget>,
  passwords: Map<string, string>,
): boolean {
  const target = targets.get(host)
  if (target) return isTargetAuthed(target, dnet, passwords)
  const details = getServerDetails(dnet, host)
  if (details?.hasSession) return true
  return passwords.has(host)
}

export function dispatchLabyrinthStasis(
  ns: NS,
  dnet: DnetApi,
  workerPool: WorkerPool,
  targets: Map<string, AuthTarget>,
  passwords: Map<string, string>,
  workerAlive: (wi: ManagedWorker) => boolean,
  sendStasis: (wi: ManagedWorker) => boolean,
): number {
  if (!dnet.setStasisLink) return 0

  const stasis = readStasisSnapshot(dnet)
  if (!stasis || stasis.available <= 0) return 0

  const linked = new Set(stasis.linkedHosts)
  const labyrinthHosts = collectLabyrinthHosts(dnet, workerPool, targets)
  if (labyrinthHosts.size === 0) return 0

  const candidates = labyrinthNeighborWorkerHosts(labyrinthHosts, workerPool).filter(
    (host) => !linked.has(host),
  )

  let seats = stasis.available
  let dispatched = 0
  for (const host of candidates) {
    if (seats <= 0) break
    const wi = workerPool.workers.get(host)
    if (!wi?.idle || wi.commandPort <= 0) continue
    if (!workerAlive(wi)) continue
    if (!workerHostAuthed(dnet, host, targets, passwords)) continue
    if (!canExecStasis(ns, dnet, host)) continue
    if (!sendStasis(wi)) continue
    seats--
    dispatched++
  }
  return dispatched
}
