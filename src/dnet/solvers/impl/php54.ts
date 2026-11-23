import type { SolverModule, SolverState } from "../types.js"
import { guessWasEvaluated } from "./shared.js"

/**
 * PHP 5.4 (SortedEchoVuln): the hint is the password's digits, sorted.
 *
 * From 5 digits up the game answers a wrong guess of the right length with the RMS deviation
 * between the guess's digits and the password's, to three decimals. That is the integer
 * `S = sum((g_i - p_i)^2)` in disguise, and since `sum(p_i^2)` is known from the hint, every guess
 * `g` reveals the dot product `sum(g_i * p_i)`. The guess need not be a permutation of the hint, so
 * spread-out digit weights split the up to 9! arrangements into hundreds of classes per guess:
 * two weighted guesses and a candidate or two instead of walking the permutations (which could
 * take thousands of guesses and ran into the attempt cap).
 *
 * Below 5 digits there is no feedback and at most 24 arrangements: those are tried in order.
 */

interface Php54State extends SolverState {
  type: "php54"
  /** Sorted hint digits; empty when the hint could not be read. */
  digits: string
  /** Guesses made so far with the dot product each one revealed (null: no usable feedback). */
  history: { guess: string; dot: number | null }[]
}

const RMSD_MIN_LENGTH = 5
/** Guesses scored per turn: candidates first, then pseudo-random digit strings. */
const POOL_CANDIDATES = 150
const POOL_RANDOM = 250
/** Above this many candidates the turn uses a fixed spread guess instead of scoring a pool. */
const SCORING_LIMIT = 20_000

function hintDigits(hint: string, length: number): string {
  const digits = hint.replace(/\D/g, "")
  return digits.length === length ? digits.split("").sort().join("") : ""
}

/** All distinct arrangements of `digits` that agree with every recorded dot product. */
function candidates(state: Php54State, limit = Infinity): string[] {
  const n = state.digits.length
  const counts = new Array<number>(10).fill(0)
  for (const ch of state.digits) counts[Number(ch)]!++
  const constraints = state.history.filter((h) => h.dot !== null && h.guess.length === n)
  const weights = constraints.map((h) => h.guess.split("").map(Number))
  const remaining = constraints.map((h) => h.dot!)
  const tried = new Set(state.history.map((h) => h.guess))
  const out: string[] = []
  const current = new Array<number>(n).fill(0)
  const place = (pos: number): void => {
    if (out.length >= limit) return
    if (pos === n) {
      for (const r of remaining) if (r !== 0) return
      const s = current.join("")
      if (!tried.has(s)) out.push(s)
      return
    }
    for (let d = 0; d <= 9; d++) {
      if (counts[d] === 0) continue
      let feasible = true
      for (let c = 0; c < weights.length; c++) {
        remaining[c]! -= weights[c]![pos]! * d
        if (remaining[c]! < 0) feasible = false
      }
      if (feasible) {
        counts[d]!--
        current[pos] = d
        place(pos + 1)
        counts[d]!++
      }
      for (let c = 0; c < weights.length; c++) remaining[c]! += weights[c]![pos]! * d
    }
  }
  place(0)
  return out
}

function dot(a: string, b: string): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a.charCodeAt(i) - 48) * (b.charCodeAt(i) - 48)
  return sum
}

/** Sum of squared class sizes when `guess` splits `pool` by dot product (lower is better). */
function splitCost(guess: string, pool: readonly string[], scratch: Map<number, number>): number {
  scratch.clear()
  for (const candidate of pool) {
    const key = dot(guess, candidate)
    scratch.set(key, (scratch.get(key) ?? 0) + 1)
  }
  let cost = 0
  for (const size of scratch.values()) cost += size * size
  return cost
}

/** Digit weights 0..9 spread evenly over the positions: the widest range of dot products. */
function spreadGuess(n: number): string {
  let guess = ""
  for (let i = 0; i < n; i++) guess += String(n === 1 ? 9 : Math.round((i * 9) / (n - 1)))
  return guess
}

function pickGuess(state: Php54State): string | null {
  const n = state.digits.length
  if (n < RMSD_MIN_LENGTH) return candidates(state, 1)[0] ?? null
  const first = spreadGuess(n)
  if (state.history.length === 0) return first === state.digits ? first.split("").reverse().join("") : first
  const pool = candidates(state, SCORING_LIMIT + 1)
  if (pool.length === 0) return null
  if (pool.length <= 2) return pool[0]!
  if (pool.length > SCORING_LIMIT) {
    // Feedback was missing for the spread guess; a rotated spread is the next best blind split.
    const turn = state.history.length % n
    const rotated = first.slice(turn) + first.slice(0, turn)
    return state.history.some((h) => h.guess === rotated) ? pool[0]! : rotated
  }
  // Deterministic pseudo-random digit strings (the same state always proposes the same guess).
  let seed = (state.history.length * 2654435761 + pool.length) >>> 0
  const next = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const scratch = new Map<number, number>()
  const tried = new Set(state.history.map((h) => h.guess))
  let best = pool[0]!
  // A candidate guess can also be the password, which is worth one class.
  let bestCost = splitCost(best, pool, scratch) - 1
  const stride = Math.max(1, Math.floor(pool.length / POOL_CANDIDATES))
  for (let i = stride; i < pool.length; i += stride) {
    const cost = splitCost(pool[i]!, pool, scratch) - 1
    if (cost < bestCost) {
      bestCost = cost
      best = pool[i]!
    }
  }
  for (let k = 0; k < POOL_RANDOM && bestCost > pool.length - 1; k++) {
    let guess = ""
    for (let i = 0; i < n; i++) guess += String(Math.floor(next() * 10))
    if (tried.has(guess)) continue
    const cost = splitCost(guess, pool, scratch)
    if (cost < bestCost) {
      bestCost = cost
      best = guess
    }
  }
  return best
}

/** `"<sorted>; RMS Deviation:1.234"` -> the dot product `sum(g_i * p_i)`, or null. */
function dotFromFeedback(state: Php54State, guess: string, feedback: string | undefined): number | null {
  const match = feedback?.match(/RMS Deviation:\s*([\d.]+)/)
  if (!match || guess.length !== state.digits.length || !/^\d+$/.test(guess)) return null
  const n = guess.length
  const rmsd = Number(match[1])
  const squared = Math.round(rmsd * rmsd * n)
  // The three printed decimals must agree with an integer sum of squares.
  if (Math.abs(Math.sqrt(squared / n) - rmsd) > 0.0006) return null
  const twice = dot(guess, guess) + dot(state.digits, state.digits) - squared
  return twice % 2 === 0 && twice >= 0 ? twice / 2 : null
}

export const php54: SolverModule<Php54State> = {
  init(details) {
    return { type: "php54", digits: hintDigits(details.passwordHint, details.passwordLength), history: [] }
  },
  nextGuess(state) {
    if (state.digits === "") return null
    const guess = pickGuess(state)
    if (guess === null) return null
    return { guess, detail: `php54 #${state.history.length + 1}` }
  },
  applyResult(state, guess, result) {
    if (result.success || !guessWasEvaluated(result)) return state
    state.history.push({ guess, dot: dotFromFeedback(state, guess, result.feedback) })
    return state
  },
}
