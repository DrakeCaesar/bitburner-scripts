import type { IdleMaintenanceGate } from "./idleMaintenance.js"
import type { AuthTarget } from "../types.js"
import type { WorkerPool } from "../pool/workers.js"

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

function requestUrgentProbe(host: string, urgentProbeHosts: Set<string>): void {
  urgentProbeHosts.add(host)
}

/** Invalidate stale links, schedule urgent probes, and block idle migrate until probed. */
export function handleStaleTopologyFailure(
  workerHost: string,
  targetHost: string | null,
  workerPool: WorkerPool,
  targets: Map<string, AuthTarget>,
  urgentProbeHosts: Set<string>,
  idleMaintenanceGate: IdleMaintenanceGate,
): void {
  if (targetHost) {
    invalidateNeighborLink(workerHost, targetHost, workerPool, targets)
    requestUrgentProbe(workerHost, urgentProbeHosts)

    for (const wi of workerPool.workers.values()) {
      if (wi.host === workerHost) continue
      if (!wi.neighbors.includes(targetHost)) continue
      wi.neighbors = wi.neighbors.filter((h) => h !== targetHost)
      requestUrgentProbe(wi.host, urgentProbeHosts)
      idleMaintenanceGate.requireProbe(wi.host)
    }
  } else {
    const wi = workerPool.workers.get(workerHost)
    if (wi) wi.neighbors = []
    requestUrgentProbe(workerHost, urgentProbeHosts)
  }

  idleMaintenanceGate.requireProbe(workerHost)
}
