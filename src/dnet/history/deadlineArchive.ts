import { DEADLINE_GRACE_MS } from "../constants.js"
import type {
  CommandDeadlineSlipStats,
  DeadlineTimelineEvent,
  FailedCommandDeadline,
  MasterActionRecord,
} from "../types.js"

interface SlipAccumulator {
  count: number
  sum: number
  minMs: number
  maxMs: number
}

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
  private slipStats = new Map<string, SlipAccumulator>()
  private slipStatsSorted: CommandDeadlineSlipStats[] | null = null
  private completedCommands = 0

  get failedDeadlines(): readonly FailedCommandDeadline[] {
    return [...this.failed.values()].sort((a, b) => b.failedAt - a.failedAt)
  }

  get commandDeadlineSlipStats(): readonly CommandDeadlineSlipStats[] {
    if (this.slipStatsSorted == null) {
      const stats: CommandDeadlineSlipStats[] = []
      for (const [commandType, acc] of this.slipStats) {
        stats.push({
          commandType,
          count: acc.count,
          minMs: acc.minMs,
          avgMs: acc.sum / acc.count,
          maxMs: acc.maxMs,
        })
      }
      stats.sort((a, b) => b.avgMs - a.avgMs)
      this.slipStatsSorted = stats
    }
    return this.slipStatsSorted
  }

  get completedCommandCount(): number {
    return this.completedCommands
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

  complete(workerHost: string, endedAt: number): void {
    const track = this.active.get(workerHost)
    if (!track) return
    this.recordSlip(track, endedAt)
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
    const slipMs = at - finalDeadlineAt
    const estimatedDeadlineAt = track.workerDeadlineAt ?? track.initialDeadlineAt
    const estimatedMs = estimatedDeadlineAt - track.dispatchedAt
    const actualMs = at - track.dispatchedAt

    this.recordSlip(track, at)

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
      slipMs,
      overdueMs: Math.max(0, slipMs - DEADLINE_GRACE_MS),
      extended: track.extended,
      reason: track.extended ? "timeout after extension" : "timeout",
      events: [...track.events],
      masterActions: masterActions.slice(track.masterActionFromIndex),
    })
  }

  private recordSlip(track: ActiveCommandTrack, endedAt: number): void {
    const slipMs = endedAt - track.currentDeadlineAt
    const acc = this.slipStats.get(track.commandType) ?? {
      count: 0,
      sum: 0,
      minMs: Number.POSITIVE_INFINITY,
      maxMs: Number.NEGATIVE_INFINITY,
    }
    acc.count++
    acc.sum += slipMs
    acc.minMs = Math.min(acc.minMs, slipMs)
    acc.maxMs = Math.max(acc.maxMs, slipMs)
    this.slipStats.set(track.commandType, acc)
    this.completedCommands++
    this.slipStatsSorted = null
  }
}
