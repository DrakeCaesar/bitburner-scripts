import { DEADLINE_GRACE_MS } from "../constants.js"
import type { DeadlineTimelineEvent, FailedCommandDeadline, MasterActionRecord } from "../types.js"

interface ActiveCommandTrack {
  id: string
  workerHost: string
  command: string
  commandType: string
  targetHost?: string
  dispatchedAt: number
  initialDeadlineAt: number
  workerDeadlineAt: number | null
  currentDeadlineAt: number
  extended: boolean
  events: DeadlineTimelineEvent[]
  masterActionFromIndex: number
}

/** Archives command deadline timeouts with estimated vs actual timing history. */
export class DeadlineArchive {
  private nextSeq = 1
  private active = new Map<string, ActiveCommandTrack>()
  private failed = new Map<string, FailedCommandDeadline>()

  get failedDeadlines(): readonly FailedCommandDeadline[] {
    return [...this.failed.values()].sort((a, b) => b.failedAt - a.failedAt)
  }

  begin(
    workerHost: string,
    command: string,
    commandType: string,
    dispatchedAt: number,
    initialDeadlineAt: number,
    masterActionFromIndex: number,
    targetHost?: string,
  ): void {
    const id = `${workerHost}#${this.nextSeq++}`
    this.active.set(workerHost, {
      id,
      workerHost,
      command,
      commandType,
      targetHost,
      dispatchedAt,
      initialDeadlineAt,
      workerDeadlineAt: null,
      currentDeadlineAt: initialDeadlineAt,
      extended: false,
      events: [
        {
          at: dispatchedAt,
          kind: "dispatched",
          deadlineAt: initialDeadlineAt,
          estimatedMs: initialDeadlineAt - dispatchedAt,
          elapsedMs: 0,
          note: "coordinator initial deadline",
        },
      ],
      masterActionFromIndex,
    })
  }

  onWorkerDeadline(workerHost: string, at: number, deadlineAt: number, commandType: string): void {
    const track = this.active.get(workerHost)
    if (!track) return
    track.workerDeadlineAt = deadlineAt
    track.currentDeadlineAt = deadlineAt
    track.events.push({
      at,
      kind: "worker_deadline",
      deadlineAt,
      estimatedMs: deadlineAt - track.dispatchedAt,
      elapsedMs: at - track.dispatchedAt,
      note: `worker estimated ${commandType}`,
    })
  }

  onTimeoutExtend(workerHost: string, at: number, newDeadlineAt: number): void {
    const track = this.active.get(workerHost)
    if (!track) return
    track.extended = true
    track.currentDeadlineAt = newDeadlineAt
    track.events.push({
      at,
      kind: "timeout_extend",
      deadlineAt: newDeadlineAt,
      estimatedMs: newDeadlineAt - track.dispatchedAt,
      elapsedMs: at - track.dispatchedAt,
      note: "long-running command extended",
    })
  }

  complete(workerHost: string): void {
    this.active.delete(workerHost)
  }

  abandon(workerHost: string): void {
    this.active.delete(workerHost)
  }

  onTimedOut(workerHost: string, at: number, masterActions: readonly MasterActionRecord[]): void {
    const track = this.active.get(workerHost)
    if (!track) return
    this.active.delete(workerHost)

    const finalDeadlineAt = track.currentDeadlineAt
    const estimatedDeadlineAt = track.workerDeadlineAt ?? track.initialDeadlineAt
    const estimatedMs = estimatedDeadlineAt - track.dispatchedAt
    const actualMs = at - track.dispatchedAt

    track.events.push({
      at,
      kind: "timed_out",
      deadlineAt: finalDeadlineAt,
      estimatedMs,
      elapsedMs: actualMs,
      note: track.extended ? "deadline exceeded after extension" : "deadline exceeded",
    })

    this.failed.set(track.id, {
      id: track.id,
      workerHost: track.workerHost,
      command: track.command,
      commandType: track.commandType,
      targetHost: track.targetHost,
      dispatchedAt: track.dispatchedAt,
      failedAt: at,
      initialDeadlineAt: track.initialDeadlineAt,
      workerDeadlineAt: track.workerDeadlineAt,
      finalDeadlineAt,
      estimatedMs,
      actualMs,
      overdueMs: Math.max(0, at - finalDeadlineAt - DEADLINE_GRACE_MS),
      extended: track.extended,
      reason: track.extended ? "timeout after extension" : "timeout",
      events: [...track.events],
      masterActions: masterActions.slice(track.masterActionFromIndex),
    })
  }
}
