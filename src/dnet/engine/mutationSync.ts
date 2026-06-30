import { NS } from "@ns"
import { MUTATION_PORT, MUTATION_WATCHER_SCRIPT } from "../constants.js"
import type { ManagedWorker, WorkerPool } from "../pool/workers.js"

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

  /** Workers with no live script yet (spawn placeholder) are excluded from sync rounds. */
  workerMustSync(wi: ManagedWorker): boolean {
    return wi.commandPort > 0 && wi.pid > 0
  }

  tryCompleteSync(ns: NS, workerPool: WorkerPool): boolean {
    const pending = this.pendingMutationTs
    if (pending === null) return false

    let syncable = 0
    for (const wi of workerPool.workers.values()) {
      if (!this.workerMustSync(wi)) continue
      syncable++
      if (wi.probeSyncMutation !== pending) return false
    }
    if (syncable === 0) return false

    const latest = this.peekMutationTs(ns)
    this.ackedMutationTs = latest != null && latest > pending ? latest : pending
    this.pendingMutationTs = null
    return true
  }

  allWorkersSynced(workerPool: WorkerPool): boolean {
    const pending = this.pendingMutationTs
    if (pending === null) return true
    for (const wi of workerPool.workers.values()) {
      if (!this.workerMustSync(wi)) continue
      if (wi.probeSyncMutation !== pending) return false
    }
    return true
  }
}

export function ensureMutationWatcher(ns: NS): void {
  if (ns.scriptRunning(MUTATION_WATCHER_SCRIPT, "home")) return
  ns.run(MUTATION_WATCHER_SCRIPT, 1)
}
