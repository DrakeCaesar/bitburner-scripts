import type { AttemptKind, AttemptRecord } from "../types.js"

/** Worker command types plus session lifecycle and generic notes. */
export type AttemptLogCommand =
  | "probe"
  | "auth"
  | "heartbleed"
  | "spawn"
  | "realloc"
  | "migrate"
  | "stasis"
  | "labreport"
  | "labradar"
  | "exit"
  | "session"
  | "note"

/**
 * Hardcoded toggles for attempt-tab timeline clutter while debugging.
 * When false, matching records are not stored or forwarded to session archive.
 */
export const ATTEMPT_LOG_ENABLED: Record<AttemptLogCommand, boolean> = {
  probe: false,
  auth: true,
  heartbleed: true,
  spawn: true,
  realloc: true,
  migrate: true,
  stasis: true,
  labreport: true,
  labradar: true,
  exit: true,
  session: true,
  note: true,
}

export function attemptLogCommand(
  entry: Pick<AttemptRecord, "kind" | "guess" | "note">,
): AttemptLogCommand {
  switch (entry.kind) {
    case "probe":
      return "probe"
    case "spawn":
      return "spawn"
    case "heartbleed":
      return "heartbleed"
    case "guess_dispatch":
    case "guess_result":
      return entry.guess === "labreport" ? "labreport" : entry.guess === "labradar" ? "labradar" : "auth"
    case "session_start":
    case "session_end":
      return "session"
    case "note":
      if (entry.guess === "labreport") return "labreport"
      if (entry.guess === "labradar") return "labradar"
      if (entry.note?.startsWith("realloc ")) return "realloc"
      if (entry.note?.startsWith("migrate")) return "migrate"
      if (entry.note === "stasis linked" || entry.note === "stasis") return "stasis"
      return "note"
  }
}

export function shouldLogAttempt(entry: Pick<AttemptRecord, "kind" | "guess" | "note">): boolean {
  return ATTEMPT_LOG_ENABLED[attemptLogCommand(entry)]
}

/** Master dispatch rows in the attempts tab use action names that match command types. */
export function shouldLogMasterAction(action: string): boolean {
  if (!Object.hasOwn(ATTEMPT_LOG_ENABLED, action)) return true
  return ATTEMPT_LOG_ENABLED[action as AttemptLogCommand]
}
