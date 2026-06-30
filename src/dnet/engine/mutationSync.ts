import { NS } from "@ns"
import { MUTATION_PORT, MUTATION_WATCHER_SCRIPT } from "../constants.js"
import type { AuthTarget } from "../types.js"
import type { ManagedWorker, WorkerPool } from "../pool/workers.js"

/** Tracks darknet mutation generations; probes run in the background without blocking dispatch. */
export class MutationSync {
  private ackedMutationTs = 0

  get pending(): number | null {
    return null
  }

  get acked(): number {
    return this.ackedMutationTs
  }

  peekMutationTs(ns: NS): number | null {
    return this.peekPort(ns).ts
  }

  peekPort(ns: NS): { raw: string; ts: number | null } {
    const raw = ns.peek(MUTATION_PORT)
    if (raw === "NULL PORT DATA") return { raw: "(empty)", ts: null }
    const ts = Number(raw)
    return { raw, ts: Number.isFinite(ts) && ts > 0 ? ts : null }
  }

  isStale(ns: NS): boolean {
    const ts = this.peekMutationTs(ns)
    return ts !== null && ts > this.ackedMutationTs
  }

  /**
   * Observe a new mutation generation: ack immediately (no full-network sync wait),
   * reset worker probe markers, and allow auth/spawn to continue.
   */
  tick(
    ns: NS,
    workerPool: WorkerPool,
    targets: Map<string, AuthTarget>,
    onAck?: (ts: number) => void,
  ): void {
    const ts = this.peekMutationTs(ns)
    if (ts == null || ts <= this.ackedMutationTs) return
    this.ackedMutationTs = ts
    for (const wi of workerPool.workers.values()) {
      wi.probeSyncMutation = -1
    }
    for (const target of targets.values()) {
      if (target.awaitProbeAfter) {
        target.awaitProbeAfter = false
        target.awaitProbeWorker = null
      }
    }
    onAck?.(ts)
  }

  markWorkerProbed(host: string, workerPool: WorkerPool, ns: NS): void {
    const ts = this.peekMutationTs(ns) ?? this.ackedMutationTs
    const wi = workerPool.workers.get(host)
    if (wi && ts > 0) wi.probeSyncMutation = ts
  }

  /** Live workers should eventually probe after each mutation generation. */
  workerNeedsProbe(wi: ManagedWorker, ns: NS): boolean {
    if (wi.commandPort <= 0 || wi.pid <= 0 || !wi.idle) return false
    const ts = this.peekMutationTs(ns) ?? this.ackedMutationTs
    if (ts <= 0) return false
    return wi.probeSyncMutation < ts
  }
}

export function ensureMutationWatcher(ns: NS): void {
  if (ns.scriptRunning(MUTATION_WATCHER_SCRIPT, "home")) return
  ns.run(MUTATION_WATCHER_SCRIPT, 1)
}
