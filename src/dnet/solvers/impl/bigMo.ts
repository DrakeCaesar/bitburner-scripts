import type { SolverModule, SolverState } from "../types.js"
import { guessWasEvaluated } from "./shared.js"

/**
 * BigMo%od (tripleModulo): a wrong guess n is answered with `(password % n) % (((n - 1) % 32) + 1)`.
 *
 * With n above the password the outer modulo does nothing and the answer is `password % d` for a
 * d of our choosing in 1..32, so each probe is worth up to 5 bits. The moduli 32, 31, 29, 27, 25,
 * 23, 19, 17, 13, 11, 7 are pairwise coprime and multiply to lcm(1..32) = 1.44e14 — the most this
 * kind of probe can ever tell — and are used largest first, only as far as the password's digit
 * count needs (the old prime ladder 2, 3, 5, ... stopped at 2e11, used three probes more for the
 * same range, and could not solve passwords of 12+ digits at all).
 *
 * Once few candidates are left (always the case after all eleven moduli: at most 7 for 15 digits),
 * one probe with n BELOW the password separates them: for n just above the combined modulus m the
 * quotient `floor(p / n)` steps by one from candidate to candidate, so `(p % n) % d` differs for
 * each. The probe is found by simulating the game's formula over the candidates.
 */

const MODULI = [32, 31, 29, 27, 25, 23, 19, 17, 13, 11, 7]
/** Candidate counts up to this are separated by simulation instead of spending another modulus. */
const SIMULATE_LIMIT = 64
/** Offsets above the combined modulus that are tried for the separating probe. */
const SEPARATOR_SPAN = 400

interface BigMoState extends SolverState {
  type: "bigMo"
  pwMin: number
  pwMax: number
  /** Probes answered so far. */
  probes: { n: number; r: number }[]
  /** Candidate passwords that were guessed and rejected. */
  rejected: number[]
  /** The probe waiting for its answer; repeated when the answer does not parse. */
  pending: number | null
}

/** The game's feedback for password p and guess n. */
function feedbackFor(p: number, n: number): number {
  return (p % n) % (((n - 1) % 32) + 1)
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

/** Residue and modulus implied by the plain probes (n above the password range). */
function combine(state: BigMoState): { r: bigint; m: bigint } {
  let r = 0n
  let m = 1n
  for (const probe of state.probes) {
    if (probe.n <= state.pwMax) continue
    const d = BigInt(((probe.n - 1) % 32) + 1)
    if (gcd(m, d) !== 1n) continue
    // Lift r to the residue mod m * d that is also `probe.r` mod d.
    while (r % d !== BigInt(probe.r)) r += m
    m *= d
  }
  return { r, m }
}

/** Passwords still consistent with every probe, or null when there are more than the limit. */
function candidates(state: BigMoState): number[] | null {
  const { r, m } = combine(state)
  const min = BigInt(state.pwMin)
  const max = BigInt(state.pwMax)
  let first = r
  if (first < min) first += ((min - first + m - 1n) / m) * m
  if (first > max) return []
  if ((max - first) / m + 1n > BigInt(SIMULATE_LIMIT)) return null
  const out: number[] = []
  for (let c = first; c <= max; c += m) {
    const p = Number(c)
    if (state.rejected.includes(p)) continue
    if (state.probes.every((probe) => feedbackFor(p, probe.n) === probe.r)) out.push(p)
  }
  return out
}

/** Smallest n above the password range whose inner modulus is d. */
function plainProbe(pwMax: number, d: number): number {
  let n = pwMax + 1
  while (((n - 1) % 32) + 1 !== d) n++
  return n
}

function classCount(pool: readonly number[], n: number): number {
  const seen = new Set<number>()
  for (const p of pool) seen.add(feedbackFor(p, n))
  return seen.size
}

/** The probe that splits `pool` into the most classes. */
function separatingProbe(state: BigMoState, pool: readonly number[]): number {
  const asked = new Set(state.probes.map((probe) => probe.n))
  let best = 0
  let bestClasses = 0
  const consider = (n: number): void => {
    if (n < 2 || asked.has(n) || !Number.isSafeInteger(n)) return
    const classes = classCount(pool, n)
    if (classes > bestClasses) {
      bestClasses = classes
      best = n
    }
  }
  for (const d of MODULI) {
    consider(plainProbe(state.pwMax, d))
    if (bestClasses === pool.length) return best
  }
  const m = Number(combine(state).m)
  for (let offset = 1; offset <= SEPARATOR_SPAN && bestClasses < pool.length; offset++) consider(m + offset)
  // Candidates one modulus apart can also be told apart from between them.
  for (let i = 1; i < pool.length && bestClasses < pool.length; i++) {
    for (let offset = 0; offset < 64 && bestClasses < pool.length; offset++) consider(pool[i - 1]! + 1 + offset)
  }
  return best
}

function nextProbe(state: BigMoState): { n: number; final: boolean } | null {
  const pool = candidates(state)
  if (pool === null) {
    const used = new Set(state.probes.map((probe) => ((probe.n - 1) % 32) + 1))
    const d = MODULI.find((modulus) => !used.has(modulus))
    return d === undefined ? null : { n: plainProbe(state.pwMax, d), final: false }
  }
  if (pool.length === 0) return null
  // Two candidates: guessing one settles it as fast as a probe would.
  if (pool.length <= 2) return { n: pool[0]!, final: true }
  const n = separatingProbe(state, pool)
  return n === 0 ? { n: pool[0]!, final: true } : { n, final: false }
}

export const bigMoSolver: SolverModule<BigMoState> = {
  init(details) {
    const len = details.passwordLength
    return {
      type: "bigMo",
      pwMin: len <= 1 ? 0 : 10 ** (len - 1),
      pwMax: 10 ** len - 1,
      probes: [],
      rejected: [],
      pending: null,
    }
  },
  nextGuess(state) {
    const next = nextProbe(state)
    if (next === null) return null
    state.pending = next.final ? null : next.n
    return { guess: String(next.n), detail: next.final ? "bigMo candidate" : `bigMo n=${next.n}` }
  },
  applyResult(state, guess, result) {
    if (result.success || !guessWasEvaluated(result)) return state
    const n = Number(guess)
    if (state.pending !== n) {
      state.rejected.push(n)
      return state
    }
    const r = typeof result.feedback === "string" && result.feedback.trim() !== "" ? Number(result.feedback) : NaN
    // An answer that does not parse leaves the probe pending: the same n is asked again.
    if (Number.isInteger(r) && r >= 0 && r < 32) {
      state.probes.push({ n, r })
      // A probe inside the range is also a rejected guess.
      if (n >= state.pwMin && n <= state.pwMax) state.rejected.push(n)
    }
    state.pending = null
    return state
  },
}
