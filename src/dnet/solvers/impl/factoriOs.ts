import type { SolverModule, SolverState } from "../types.js"
import { guessWasEvaluated } from "./shared.js"

/**
 * Factori-Os (divisibilityTest): a wrong guess n is answered with "password is / is not divisible
 * by n". The password is a product of small factors (primes up to 97, to any power) times, from
 * difficulty 13 on, one prime out of the game's list of 83 "large" primes — two from difficulty 25.
 *
 * The answer is an AND over n's prime powers, so there is no group test: every small prime costs a
 * guess, and so does every large prime that is ruled out. What can be saved is on the large side:
 *
 *  - The password's digit count is known, so once the small part s is fixed, the large part must
 *    put `s * X` into that decade. That removes a third to a half of the list.
 *  - With one large prime left to find, each candidate is guessed as the finished password
 *    `s * q` instead of asking "does q divide" and then guessing — the hit ends the solve.
 *  - With two to find, the prime that occurs in the most surviving pairs is asked first.
 *
 * The number of large primes follows from the difficulty (0 / 1 / 2 at <= 12 / <= 24 / above); if
 * that turns out wrong the search reopens to every count.
 */

const SMALL_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97]
/** ServerGenerator.largePrimes. */
const LARGE_PRIMES = [
  1069, 1409, 1471, 1567, 1597, 1601, 1697, 1747, 1801, 1889, 1979, 1999, 2063, 2207, 2371, 2503, 2539, 2693, 2741,
  2753, 2801, 2819, 2837, 2909, 2939, 3169, 3389, 3571, 3761, 3881, 4217, 4289, 4547, 4729, 4789, 4877, 4943, 4951,
  4957, 5393, 5417, 5419, 5441, 5519, 5527, 5647, 5779, 5881, 6007, 6089, 6133, 6389, 6451, 6469, 6547, 6661, 6719,
  6841, 7103, 7549, 7559, 7573, 7691, 7753, 7867, 8053, 8081, 8221, 8329, 8599, 8677, 8761, 8839, 8963, 9103, 9199,
  9343, 9467, 9551, 9601, 9739, 9749, 9859,
]
const MAX_UNREAD = 3

interface FactoriOsState extends SolverState {
  type: "factoriOs"
  /** Password decade: 10^(length-1) .. 10^length - 1. */
  min: number
  max: number
  /** Large primes the difficulty implies (0..2), or -1 when any count is allowed. */
  largeCount: number
  /** Small part found so far (product of confirmed prime powers). */
  small: number
  /** Index into SMALL_PRIMES of the prime under test; past the end when the small part is done. */
  primeIdx: number
  /** Power of the current prime under test (1 = the prime itself). */
  exponent: number
  /** Large primes confirmed to divide the password / ruled out. */
  found: number[]
  ruledOut: number[]
  /** Finished passwords that were guessed and rejected. */
  rejected: number[]
  /** What the outstanding guess asks, so the answer is read the right way. */
  asking: "small" | "large" | "password" | null
  unread: number
}

interface Candidate {
  primes: number[]
  weight: number
}

/** Large parts that fit the decade, contain every found prime and avoid the ruled-out ones. */
function largeCandidates(state: FactoriOsState): Candidate[] {
  const out: Candidate[] = []
  const allowed = LARGE_PRIMES.filter((q) => !state.ruledOut.includes(q))
  const fits = (x: number): boolean => {
    const p = state.small * x
    return p >= state.min && p <= state.max && !state.rejected.includes(p)
  }
  const hasFound = (primes: number[]): boolean => {
    const rest = [...primes]
    for (const q of state.found) {
      const at = rest.indexOf(q)
      if (at < 0) return false
      rest.splice(at, 1)
    }
    return true
  }
  const counts = state.largeCount < 0 ? [0, 1, 2] : [state.largeCount]
  if (counts.includes(0) && state.found.length === 0 && fits(1)) out.push({ primes: [], weight: 1 })
  if (counts.includes(1)) {
    for (const q of allowed) if (fits(q) && hasFound([q])) out.push({ primes: [q], weight: 1 })
  }
  if (counts.includes(2)) {
    for (let i = 0; i < allowed.length; i++) {
      for (let j = i; j < allowed.length; j++) {
        const pair = [allowed[i]!, allowed[j]!]
        // Two independent draws: an unordered pair of different primes is twice as likely.
        if (fits(pair[0]! * pair[1]!) && hasFound(pair)) out.push({ primes: pair, weight: i === j ? 1 : 2 })
      }
    }
  }
  return out
}

type Step = { guess: number; asking: "small" | "large" | "password" }

function nextStep(state: FactoriOsState): Step | null {
  // Small part: each prime in turn, then its higher powers while they still divide.
  while (state.primeIdx < SMALL_PRIMES.length) {
    const prime = SMALL_PRIMES[state.primeIdx]!
    const power = prime ** state.exponent
    // A power that pushes the password past its decade cannot divide — counting the large primes
    // the difficulty promises at their smallest (1069 each) while that promise is still trusted.
    const largeFloor = state.largeCount > 0 ? LARGE_PRIMES[0]! ** state.largeCount : 1
    if (state.small * prime * largeFloor <= state.max) return { guess: power, asking: "small" }
    state.primeIdx++
    state.exponent = 1
  }
  let pool = largeCandidates(state)
  if (pool.length === 0 && state.largeCount >= 0) {
    // The difficulty's large-prime count was wrong: allow any count, and redo the small part,
    // which may have skipped primes on the strength of it.
    const skipped = state.largeCount > 0
    state.largeCount = -1
    if (skipped) {
      state.small = 1
      state.primeIdx = 0
      state.exponent = 1
      return nextStep(state)
    }
    pool = largeCandidates(state)
  }
  if (pool.length === 0) return null
  const product = (c: Candidate): number => c.primes.reduce((a, b) => a * b, state.small)
  // All candidates one unknown prime apart (or a single one): guess finished passwords.
  const open = pool.map((c) => c.primes.length - state.found.length)
  if (pool.length === 1 || open.every((n) => n <= 1)) {
    let best = pool[0]!
    for (const c of pool) if (c.weight > best.weight) best = c
    return { guess: product(best), asking: "password" }
  }
  // Otherwise ask about the prime that the most (weighted) candidates contain.
  const votes = new Map<number, number>()
  for (const c of pool) {
    const rest = [...c.primes]
    for (const q of state.found) rest.splice(rest.indexOf(q), 1)
    for (const q of new Set(rest)) votes.set(q, (votes.get(q) ?? 0) + c.weight)
  }
  let bestPrime = 0
  let bestVotes = -1
  for (const [q, v] of votes) {
    if (v > bestVotes) {
      bestVotes = v
      bestPrime = q
    }
  }
  return bestPrime === 0 ? null : { guess: bestPrime, asking: "large" }
}

export const factoriOs: SolverModule<FactoriOsState> = {
  init(details) {
    const length = details.passwordLength
    const d = details.difficulty
    return {
      type: "factoriOs",
      min: length <= 1 ? 1 : 10 ** (length - 1),
      max: 10 ** length - 1,
      largeCount: !Number.isFinite(d) ? -1 : d > 24 ? 2 : d > 12 ? 1 : 0,
      small: 1,
      primeIdx: 0,
      exponent: 1,
      found: [],
      ruledOut: [],
      rejected: [],
      asking: null,
      unread: 0,
    }
  },
  nextGuess(state) {
    if (state.unread > MAX_UNREAD) return null
    const step = nextStep(state)
    if (step === null) return null
    state.asking = step.asking
    return { guess: String(step.guess), detail: `factoriOs ${step.asking} ${step.guess}` }
  },
  applyResult(state, guess, result) {
    if (result.success || !guessWasEvaluated(result)) return state
    const n = Number(guess)
    const asking = state.asking
    if (asking === "password") {
      state.rejected.push(n)
      return state
    }
    const fb = result.feedback
    const divides = fb === "true" ? true : fb === "false" ? false : null
    if (divides === null || asking === null) {
      // Unreadable answer: the same question is asked again, a few times at most.
      state.unread++
      return state
    }
    state.unread = 0
    if (asking === "small") {
      const prime = SMALL_PRIMES[state.primeIdx]!
      if (divides) {
        state.small *= prime
        state.exponent++
      } else {
        state.primeIdx++
        state.exponent = 1
      }
      return state
    }
    if (divides) state.found.push(n)
    else state.ruledOut.push(n)
    return state
  },
}
