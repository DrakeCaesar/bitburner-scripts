import type {
  AttemptRecord,
  AuthAssignment,
  FailedAuthSession,
  PasswordFormat,
  ServerDetails,
  SessionEvent,
} from "../types.js"

function sessionKey(host: string, session: number): string {
  return `${host}#${session}`
}

function toAssignment(host: string, details: ServerDetails): AuthAssignment {
  return {
    host,
    modelId: details.modelId,
    format: details.passwordFormat,
    passwordHint: details.passwordHint,
    passwordLength: details.passwordLength,
    data: details.data,
    depth: details.depth,
    difficulty: details.difficulty,
    requiredCharismaSkill: details.requiredCharismaSkill,
  }
}

function toSessionEvent(r: AttemptRecord): SessionEvent {
  return {
    at: r.at,
    kind: r.kind,
    guess: r.guess,
    detail: r.detail,
    success: r.success,
    feedback: r.feedback,
    message: r.message,
    heartbleedLogs: r.heartbleedLogs,
    note: r.note,
    workerHost: r.workerHost,
  }
}

interface ActiveSession {
  id: string
  host: string
  session: number
  solverId: string
  startedAt: number
  assignment: AuthAssignment
  events: SessionEvent[]
}

/** Tracks live auth sessions; archives failures for post-mortem inspection. */
export class SessionArchive {
  private active = new Map<string, ActiveSession>()
  private failed = new Map<string, FailedAuthSession>()

  get failedSessions(): readonly FailedAuthSession[] {
    return [...this.failed.values()].sort((a, b) => b.archivedAt - a.archivedAt)
  }

  beginSession(host: string, session: number, solverId: string, details: ServerDetails): void {
    for (const key of [...this.active.keys()]) {
      if (this.active.get(key)?.host === host) this.active.delete(key)
    }
    const id = sessionKey(host, session)
    this.active.set(id, {
      id,
      host,
      session,
      solverId,
      startedAt: Date.now(),
      assignment: toAssignment(host, details),
      events: [],
    })
  }

  recordAttempt(r: AttemptRecord): void {
    const id = sessionKey(r.host, r.session)
    const active = this.active.get(id)
    if (!active) return

    active.events.push(toSessionEvent(r))

    if (r.kind === "session_end" && r.success === true) {
      this.completeSuccess(r.host, r.session)
    } else if (r.kind === "session_end" && r.success === false) {
      this.archiveFailure(r.host, r.session, r.note ?? "solver exhausted")
    }
  }

  completeSuccess(host: string, session: number): void {
    this.active.delete(sessionKey(host, session))
  }

  discardHost(host: string): void {
    for (const key of [...this.active.keys()]) {
      if (this.active.get(key)?.host === host) this.active.delete(key)
    }
  }

  archiveFailure(host: string, session: number, reason: string): void {
    const id = sessionKey(host, session)
    const active = this.active.get(id)
    if (!active || this.failed.has(id)) return

    this.failed.set(id, {
      id,
      host: active.host,
      session: active.session,
      solverId: active.solverId,
      startedAt: active.startedAt,
      archivedAt: Date.now(),
      reason,
      assignment: active.assignment,
      events: [...active.events],
    })
    this.active.delete(id)
  }
}
