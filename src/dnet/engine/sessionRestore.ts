import type { NS } from "@ns"
import type { ManagedWorker, WorkerPool } from "../pool/workers.js"
import type { AuthTarget } from "../types.js"
import { knownPassword } from "./targetState.js"
import type { WorkerCommandPayload } from "../worker/protocol.js"

export interface SessionRestoreRequest {
  workerHost: string
  targetHost: string
  password: string | undefined
}

function queueKey(workerHost: string, targetHost: string): string {
  return `${workerHost}:${targetHost}`
}

/** Pending worker session restores discovered via probe or self-host scan. */
export class SessionRestoreQueue {
  private readonly pending = new Map<string, SessionRestoreRequest>()
  private readonly inFlight = new Set<string>()

  enqueue(workerHost: string, targetHost: string, password: string | undefined): void {
    const key = queueKey(workerHost, targetHost)
    if (this.inFlight.has(key)) return
    this.pending.set(key, { workerHost, targetHost, password })
  }

  markInFlight(workerHost: string, targetHost: string): void {
    const key = queueKey(workerHost, targetHost)
    this.inFlight.add(key)
    this.pending.delete(key)
  }

  clearInFlight(workerHost: string, targetHost: string): void {
    this.inFlight.delete(queueKey(workerHost, targetHost))
  }

  pendingCount(): number {
    return this.pending.size
  }

  pendingRequests(): readonly SessionRestoreRequest[] {
    return [...this.pending.values()]
  }
}

export interface SessionRestoreDispatchCtx {
  ns: NS
  workerPool: WorkerPool
  queue: SessionRestoreQueue
  sendCommand: (wi: ManagedWorker, payload: WorkerCommandPayload) => boolean
}

/** Queue self-restore when a solved worker lost its session on its own host. */
export function enqueueSelfSessionRestoreFromProbe(
  queue: SessionRestoreQueue,
  workerHost: string,
  selfHasSession: boolean,
  targets: Map<string, AuthTarget>,
  passwords: Map<string, string>,
): void {
  if (selfHasSession) return
  const target = targets.get(workerHost)
  if (!target || target.status !== "solved") return
  const password = knownPassword(target, passwords)
  if (password == null) return
  queue.enqueue(workerHost, workerHost, password)
}

export function dispatchSessionRestore(ctx: SessionRestoreDispatchCtx): void {
  for (const req of ctx.queue.pendingRequests()) {
    const wi = ctx.workerPool.workers.get(req.workerHost)
    if (!wi?.idle || wi.commandPort <= 0) continue
    if (ctx.ns.peek(wi.replyPort) !== "NULL PORT DATA") continue

    const payload: WorkerCommandPayload = {
      type: "restoreSession",
      target: req.targetHost,
      ...(req.password != null ? { password: req.password } : {}),
    }
    if (!ctx.sendCommand(wi, payload)) continue

    ctx.queue.markInFlight(req.workerHost, req.targetHost)
  }
}
