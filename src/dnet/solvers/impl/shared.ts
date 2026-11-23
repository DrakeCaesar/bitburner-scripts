import type { GuessResult } from "../types.js"

/** Failure messages of a guess that never reached the password check (game codes and worker errors). */
const NOT_JUDGED_MESSAGES = new Set([
  "Request Timeout",
  "Not Enough Charisma",
  "Service Unavailable",
  "Direct Connection Required",
  "Not Found",
  "auth command error",
  "noDetails",
  "notNeighbor",
])

/**
 * True when the server actually judged the guess. A failed result is often a guess that never got
 * that far (request timeout, charisma gate, worker error): the solver must ask again instead of
 * crossing the guess off — a single-shot solver that gives up on a timeout leaves the server
 * unsolved until the coordinator's retry timer.
 *
 * The response code decides when it is known (401 = judged wrong). Feedback cannot: models without
 * hint data report a judged guess with no feedback at all, only the server's hint as the message.
 */
export function guessWasEvaluated(result: GuessResult): boolean {
  if (result.success) return true
  if (result.code !== undefined) return result.code === 401
  if (result.feedback !== undefined) return true
  return result.message !== undefined && result.message !== "" && !NOT_JUDGED_MESSAGES.has(result.message)
}
