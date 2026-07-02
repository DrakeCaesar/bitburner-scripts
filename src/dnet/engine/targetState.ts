import { getServerDetails, tryConnect } from "../api/server.js"
import type { SessionArchive } from "../history/sessionArchive.js"
import type { AuthTarget, DnetApi } from "../types.js"

/** Clear in-flight auth dispatch fields (solver session is kept). */
export function clearAuthDispatch(target: AuthTarget): void {
  target.pendingGuess = null
  target.pendingDetail = null
  target.workerHost = null
  target.awaitProbeAfter = false
  target.awaitProbeWorker = null
}

export function knownPassword(
  target: AuthTarget,
  passwords: Map<string, string>,
): string | null {
  return target.password ?? passwords.get(target.host) ?? null
}

/** Game truth: host has an active session or we know the password. */
export function isTargetAuthed(
  target: AuthTarget,
  dnet: DnetApi,
  passwords: Map<string, string>,
): boolean {
  if (knownPassword(target, passwords) != null) return true
  const details = getServerDetails(dnet, target.host)
  return details?.isOnline === true && details.hasSession
}

export interface MarkAuthedOptions {
  password?: string | null
  passwords?: Map<string, string>
  sessionArchive?: SessionArchive
}

/**
 * Single write path for a cracked host. Sets solved, stores password when known,
 * and clears any in-flight auth work.
 */
export function markTargetAuthed(
  target: AuthTarget,
  dnet: DnetApi,
  options: MarkAuthedOptions = {},
): boolean {
  if (target.status === "unsupported" || target.status === "offline") return false

  const password =
    options.password ??
    (options.passwords ? knownPassword(target, options.passwords) : null) ??
    target.password
  if (password != null) {
    tryConnect(dnet, target.host, password)
    target.password = password
    options.passwords?.set(target.host, password)
  }

  const details = getServerDetails(dnet, target.host)
  if (password == null && details?.hasSession !== true) return false

  target.status = "solved"
  target.lastError = null
  clearAuthDispatch(target)
  options.sessionArchive?.discardHost(target.host)
  return true
}

/** Host was solved but lost its session; restart auth from scratch. */
export function markTargetSessionLost(target: AuthTarget): void {
  target.status = "queued"
  target.solverState = null
  target.solverId = null
  target.retryAt = null
  target.lastError = null
  clearAuthDispatch(target)
}

/**
 * Set waiting_worker for resource blocks. Never downgrades an authed host.
 * Returns true when the target is authed and auth work should stop.
 */
export function markBlockedOnWorker(
  target: AuthTarget,
  dnet: DnetApi,
  passwords: Map<string, string>,
  error: string,
  sessionArchive?: SessionArchive,
): boolean {
  if (isTargetAuthed(target, dnet, passwords)) {
    markTargetAuthed(target, dnet, { passwords, sessionArchive })
    return true
  }
  target.status = "waiting_worker"
  target.lastError = error
  return false
}

/**
 * Align coordinator status with game auth truth (hasSession / known password).
 * Also detects session loss on solved targets without a stored password.
 */
export function syncTargetAuthState(
  target: AuthTarget,
  dnet: DnetApi,
  passwords: Map<string, string>,
  sessionArchive?: SessionArchive,
): void {
  if (target.status === "unsupported" || target.status === "offline") return

  if (isTargetAuthed(target, dnet, passwords)) {
    markTargetAuthed(target, dnet, { passwords, sessionArchive })
    return
  }

  if (target.status !== "solved" || knownPassword(target, passwords) != null) return

  const details = getServerDetails(dnet, target.host)
  if (
    details?.isOnline &&
    details.isConnectedToCurrentServer &&
    !details.hasSession
  ) {
    markTargetSessionLost(target)
  }
}

export function syncAllTargetAuthState(
  targets: Map<string, AuthTarget>,
  dnet: DnetApi,
  passwords: Map<string, string>,
  sessionArchive: SessionArchive,
): void {
  for (const target of targets.values()) {
    syncTargetAuthState(target, dnet, passwords, sessionArchive)
  }
}

/** Host is ready for worker spawn / stasis (authed per game truth). */
export function isTargetReadyForWorker(
  target: AuthTarget,
  dnet: DnetApi,
  passwords: Map<string, string>,
): boolean {
  return isTargetAuthed(target, dnet, passwords)
}
