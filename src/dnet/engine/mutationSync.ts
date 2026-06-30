import { NS } from "@ns"
import { MUTATION_PORT, MUTATION_WATCHER_SCRIPT } from "../constants.js"
import type { WorkerPool } from "../pool/workers.js"

/** Tracks darknet mutation generations and full-network probe sync. */
export class MutationSync {
  private ackedMutationTs = 0
  private pendingMutationTs: number | null = null

  get pending(): number | null {
    return this.pendingMutationTs
  }

  get acked(): number {
    return this.ackedMutationTs
  }

  peekMutationTs(ns: NS): number | null {
    const raw = ns.peek(MUTATION_PORT)
    if (raw === "NULL PORT DATA") return null
    const ts = Number(raw)
    return Number.isFinite(ts) && ts > 0 ? ts : null
  }

  isStale(ns: NS): boolean {
    const ts = this.peekMutationTs(ns)
    return ts !== null && ts > this.ackedMutationTs
  }

  canDispatchActions(): boolean {
    return this.pendingMutationTs === null
  }

  /** Start (or restart) a full-network probe sync for the current mutation generation. */
  beginPending(ns: NS, workerPool: WorkerPool): number {
    const ts = this.peekMutationTs(ns) ?? 0
    this.pendingMutationTs = ts
    for (const wi of workerPool.workers.values()) {
      wi.probeSyncMutation = -1
    }
    return ts
  }

  markWorkerProbed(host: string, workerPool: WorkerPool): void {
    if (this.pendingMutationTs === null) return
    const wi = workerPool.workers.get(host)
    if (wi) wi.probeSyncMutation = this.pendingMutationTs
  }

  tryCompleteSync(workerPool: WorkerPool): boolean {
    const pending = this.pendingMutationTs
    if (pending === null) return false
    if (workerPool.workers.size === 0) return false

    for (const wi of workerPool.workers.values()) {
      if (wi.commandPort <= 0) continue
      if (wi.probeSyncMutation !== pending) return false
    }

    this.ackedMutationTs = pending
    this.pendingMutationTs = null
    return true
  }

  allWorkersSynced(workerPool: WorkerPool): boolean {
    const pending = this.pendingMutationTs
    if (pending === null) return true
    if (workerPool.workers.size === 0) return false
    for (const wi of workerPool.workers.values()) {
      if (wi.commandPort <= 0) continue
      if (wi.probeSyncMutation !== pending) return false
    }
    return true
  }
}

export function ensureMutationWatcher(ns: NS): void {
  if (ns.scriptRunning(MUTATION_WATCHER_SCRIPT, "home")) return
  ns.run(MUTATION_WATCHER_SCRIPT, 1)
}
