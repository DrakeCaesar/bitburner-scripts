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
      return entry.guess === "labreport" ? "labreport" : "auth"
    case "session_start":
    case "session_end":
      return "session"
    case "note":
      if (entry.guess === "labreport") return "labreport"
      if (entry.note?.startsWith("realloc ")) return "realloc"
      if (entry.note?.startsWith("migrate")) return "migrate"
      if (entry.note === "stasis linked" || entry.note === "stasis") return "stasis"
      return "note"
  }
}

export function shouldLogAttempt(entry: Pick<AttemptRecord, "kind" | "guess" | "note">): boolean {
  return ATTEMPT_LOG_ENABLED[attemptLogCommand(entry)]
}
