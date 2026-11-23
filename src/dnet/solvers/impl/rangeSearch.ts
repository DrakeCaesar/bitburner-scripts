import type { SolverModule, SolverState } from "../types.js"
import { guessWasEvaluated } from "./shared.js"

/**
 * The two "higher / lower" models: AccountsManager_4.2 (GuessNumber) and BellaCuore's range variant
 * (RomanNumeral at difficulty 8+). Both are a bisection; what is worth having is the tightest
 * starting interval, and the game gives away more than the hint says:
 *
 *  - The password is printed without leading zeros, so its length fixes its decade.
 *  - AccountsManager draws `floor(rand * 10 * (difficulty + 3) / 3)`: at difficulty 60 that is
 *    0..209, not the "0..1000" of the hint.
 *  - BellaCuore's bounds are derived from the password: `max = p + floor(rand * 10 d + 10)` and
 *    `min = floor(p * (0.6..0.8))` (or 0), so p lies within `10 d` of max and between
 *    `min / 0.8` and `(min + 1) / 0.6`.
 *
 * Every bound that is inferred rather than answered by the server is soft: if the bisection runs
 * dry, the interval reopens to the hard bounds and the search continues with what it has learned.
 */

interface RangeState extends SolverState {
  type: "accountsManager" | "bellaCuoreRange"
  lo: number
  hi: number
  /** Bounds the hint and the length guarantee; the search falls back to them once. */
  hardLo: number
  hardHi: number
  widened: boolean
}

function decade(length: number): [number, number] {
  return [length <= 1 ? 0 : 10 ** (length - 1), 10 ** length - 1]
}

function empty(type: RangeState["type"]): RangeState {
  return { type, lo: 1, hi: 0, hardLo: 1, hardHi: 0, widened: true }
}

function nextGuess(state: RangeState, label: string): { guess: string; detail: string } | null {
  if (state.lo > state.hi) {
    if (state.widened) return null
    // Every answer so far was truthful, so only the inferred side is reopened.
    state.widened = true
    state.lo = Math.max(Math.min(state.lo, state.hardHi), state.hardLo)
    state.hi = Math.min(Math.max(state.hi, state.hardLo), state.hardHi)
    if (state.lo > state.hi) return null
  }
  const mid = Math.floor((state.lo + state.hi) / 2)
  return { guess: String(mid), detail: `${label} ${mid} [${state.lo}..${state.hi}]` }
}

function applyAnswer(state: RangeState, guess: string, higher: boolean | null): void {
  const g = Number(guess)
  if (higher === null) {
    // No usable answer: all that is known is that this guess was wrong.
    if (g === state.lo) state.lo++
    else if (g === state.hi) state.hi--
    return
  }
  if (higher) {
    state.lo = Math.max(state.lo, g + 1)
    // The soft upper bound was wrong if the answer points past it.
    if (!state.widened && state.lo > state.hi) state.hi = state.hardHi
  } else {
    state.hi = Math.min(state.hi, g - 1)
    if (!state.widened && state.lo > state.hi) state.lo = state.hardLo
  }
}

export const accountsManager: SolverModule<RangeState> = {
  init(details) {
    const [lo, hi] = decade(details.passwordLength)
    // floor(rand * 10 * (difficulty + 3) / 3) never reaches its upper limit.
    const drawMax = Math.ceil((10 * (details.difficulty + 3)) / 3) - 1
    const softHi = Number.isFinite(drawMax) && drawMax >= lo ? Math.min(hi, drawMax) : hi
    return { type: "accountsManager", lo, hi: softHi, hardLo: lo, hardHi: hi, widened: softHi === hi }
  },
  nextGuess(state) {
    return nextGuess(state, "bin")
  },
  applyResult(state, guess, result) {
    if (result.success || !guessWasEvaluated(result)) return state
    applyAnswer(state, guess, result.feedback === "Higher" ? true : result.feedback === "Lower" ? false : null)
    return state
  },
}

/** Game's romanNumeralDecoder, restricted to well-formed numerals. */
export function romanToDecimal(roman: string): number | null {
  const trimmed = roman.trim()
  if (trimmed.toLowerCase() === "nulla") return 0
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }
  const upper = trimmed.toUpperCase()
  if (!upper || !/^[IVXLCDM]+$/.test(upper)) return null
  let total = 0
  for (let i = 0; i < upper.length; i++) {
    const current = values[upper[i]!]!
    const next = values[upper[i + 1]!]
    total += next !== undefined && current < next ? -current : current
  }
  return total
}

export const bellaCuoreRange: SolverModule<RangeState> = {
  init(details) {
    const parts = details.data.split(",")
    if (parts.length !== 2) return empty("bellaCuoreRange")
    const min = romanToDecimal(parts[0]!)
    const max = romanToDecimal(parts[1]!)
    if (min === null || max === null || min > max) return empty("bellaCuoreRange")
    const [decadeLo, decadeHi] = decade(details.passwordLength)
    const hardLo = Math.max(min, decadeLo)
    const hardHi = Math.min(max, decadeHi)
    const d = details.difficulty
    let lo = hardLo
    let hi = hardHi
    if (Number.isFinite(d) && d >= 0) {
      // max = p + floor(rand * 10 d + 10): the added part is 10 .. 10 d + 9.
      lo = Math.max(lo, max - (10 * d + 9) - 1)
      hi = Math.min(hi, max - 10 + 1)
      // min = floor(p * f) with f in [0.6, 0.8), unless it is the flat 0 of the 30% branch.
      if (min > 0) {
        lo = Math.max(lo, Math.floor(min / 0.8))
        hi = Math.min(hi, Math.ceil((min + 1) / 0.6))
      }
    }
    if (lo > hi) {
      lo = hardLo
      hi = hardHi
    }
    return { type: "bellaCuoreRange", lo, hi, hardLo, hardHi, widened: lo === hardLo && hi === hardHi }
  },
  nextGuess(state) {
    return nextGuess(state, "bc")
  },
  applyResult(state, guess, result) {
    if (result.success || !guessWasEvaluated(result)) return state
    const fb = result.feedback
    applyAnswer(state, guess, fb === "PARUM BREVIS" ? true : fb === "ALTUS NIMIS" ? false : null)
    return state
  },
}
