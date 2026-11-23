import type { SolverModule, SolverState } from "../types.js"
import { guessWasEvaluated } from "./shared.js"

/**
 * The two models that answer per position: NIL (Yesn_t: "yes" / "yesn't" for every character) and
 * 2G_cellular (TimingAttack: the index of the first wrong character).
 *
 * Both come down to trying each position's characters in turn, and neither can beat about half
 * the alphabet per position. What the guesses can do is carry everything already known:
 *
 *  - every position holds its own next untried character, so nothing is asked twice;
 *  - positions that are known hold their character, so the guess that settles the last open
 *    position IS the password — no separate final guess;
 *  - the last character left for a position needs no test.
 *
 * For 2G_cellular the reply "mismatch at m" confirms every position before m with the character it
 * was holding, and rules that character out at m — so one guess always excludes one character
 * somewhere, instead of re-testing the padding character at each new position.
 */

const DIGITS = "0123456789"
const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

function charsetFor(format: string): string {
  if (format === "numeric") return DIGITS
  if (format === "alphabetic") return LETTERS
  return DIGITS + LETTERS
}

interface PositionalState extends SolverState {
  type: "nil" | "timingAttack"
  charset: string
  /** Per position: index into `charset` of the character it currently holds. */
  held: number[]
  /** Per position: true once its held character is confirmed (or is the only one left). */
  known: boolean[]
  /** Consecutive replies that could not be read. */
  unread: number
  /** Set when a fully known guess was rejected: nothing left to try. */
  dead: boolean
}

function init(type: PositionalState["type"], format: string, length: number): PositionalState {
  const charset = charsetFor(format)
  return {
    type,
    charset,
    held: new Array<number>(length).fill(0),
    known: new Array<boolean>(length).fill(charset.length === 1),
    unread: 0,
    dead: false,
  }
}

function currentGuess(state: PositionalState): string {
  let guess = ""
  for (const index of state.held) guess += state.charset[index]!
  return guess
}

/** Rule out the held character at `pos`; the last one standing is known without a test. */
function exclude(state: PositionalState, pos: number): void {
  if (state.known[pos]) {
    state.dead = true
    return
  }
  state.held[pos]!++
  if (state.held[pos]! >= state.charset.length) state.dead = true
  else if (state.held[pos] === state.charset.length - 1) state.known[pos] = true
}

function next(state: PositionalState, label: string): { guess: string; detail: string } | null {
  if (state.dead || state.held.length === 0) return null
  const open = state.known.filter((k) => !k).length
  return { guess: currentGuess(state), detail: `${label} (${open} open)` }
}

const MAX_UNREAD = 3

export const nilSolver: SolverModule<PositionalState> = {
  init(details) {
    return init("nil", details.passwordFormat, details.passwordLength)
  },
  nextGuess(state) {
    return next(state, "NIL")
  },
  applyResult(state, guess, result) {
    if (result.success || !guessWasEvaluated(result)) return state
    const parts = (result.feedback ?? "").split(",")
    if (guess !== currentGuess(state)) return state
    if (parts.length !== state.held.length || parts.some((p) => p !== "yes" && p !== "yesn't")) {
      // Unreadable reply: ask again a few times, then give up rather than guess blindly.
      if (++state.unread > MAX_UNREAD) state.dead = true
      return state
    }
    state.unread = 0
    if (parts.every((p) => p === "yes")) {
      // Every character right and still rejected: the reply does not belong to this guess.
      state.dead = true
      return state
    }
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === "yes") state.known[i] = true
      else exclude(state, i)
    }
    return state
  },
}

export const timingAttack: SolverModule<PositionalState> = {
  init(details) {
    return init("timingAttack", details.passwordFormat, details.passwordLength)
  },
  nextGuess(state) {
    return next(state, "timing")
  },
  applyResult(state, guess, result) {
    if (result.success || !guessWasEvaluated(result)) return state
    if (guess !== currentGuess(state)) return state
    const match = (result.message ?? "").match(/Found a mismatch while checking each character \((-?\d+)\)/)
    const mismatch = match ? Number(match[1]) : NaN
    if (!Number.isInteger(mismatch) || mismatch < 0 || mismatch >= state.held.length) {
      if (++state.unread > MAX_UNREAD) state.dead = true
      return state
    }
    state.unread = 0
    for (let i = 0; i < mismatch; i++) state.known[i] = true
    exclude(state, mismatch)
    return state
  },
}
