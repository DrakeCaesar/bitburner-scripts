import type { ServerDetails } from '../../types.js'
import type { SolverModule, SolverState } from '../types.js'
import { kingOfTheHillImprovedSolver } from '../kingOfTheHill/solverModule.js'
import { COMMON_PASSWORDS, DEFAULT_FACTORY_PASSWORDS } from '../data/commonPasswords.js'

/** Mark a single-shot solver done after a real auth attempt reaches the target. */
function finishSingleShot(state: { dispatched: boolean }): void {
  state.dispatched = true
}

/** Drop a list candidate after a failed auth (pop-from-end iterators). */
function consumeFromEnd(remaining: string[], guess: string, success: boolean): void {
  if (success) {
    remaining.length = 0
    return
  }
  const idx = remaining.lastIndexOf(guess)
  if (idx >= 0) remaining.splice(idx, 1)
}

/** Drop a list candidate after a failed auth (shift-from-front iterators). */
function consumeFromFront(remaining: string[], guess: string, success: boolean): void {
  if (success) {
    remaining.length = 0
    return
  }
  if (remaining[0] === guess) remaining.shift()
  else {
    const idx = remaining.indexOf(guess)
    if (idx >= 0) remaining.splice(idx, 1)
  }
}

// #region ZeroLogon


interface ZeroLogonState extends SolverState { type: "zeroLogon"; dispatched: boolean }

const zeroLogon: SolverModule<ZeroLogonState> = {
  init(details) {
    return { type: "zeroLogon", dispatched: details.passwordLength !== 0 }
  },
  nextGuess(state) {
    if (state.dispatched) return null
    return { guess: "", detail: "zeroLogon" }
  },
  applyResult(state, _guess, _result) {
    finishSingleShot(state)
    return state
  },
}

// #endregion

// #region CloudBlare(tm)


interface CloudBlareState extends SolverState { type: "cloudBlare"; dispatched: boolean; guess: string | null }

const cloudBlare: SolverModule<CloudBlareState> = {
  init(details) {
    if (details.passwordHint !== "Type the numbers to prove you are human") {
      return { type: "cloudBlare", dispatched: true, guess: null }
    }
    const digits = details.data.replace(/\D/g, "")
    if (digits.length !== details.passwordLength) return { type: "cloudBlare", dispatched: true, guess: null }
    return { type: "cloudBlare", dispatched: false, guess: digits }
  },
  nextGuess(state) {
    if (state.dispatched || !state.guess) return null
    return { guess: state.guess, detail: "cloudBlare" }
  },
  applyResult(state, _guess, _result) {
    finishSingleShot(state)
    return state
  },
}

// #endregion

// #region DeskMemo_3.1


interface DeskMemoState extends SolverState { type: "deskMemo"; dispatched: boolean; guess: string | null }

const deskMemo: SolverModule<DeskMemoState> = {
  init(details) {
    const numerals = details.passwordHint.replace(/\D/g, "")
    if (numerals.length !== details.passwordLength) return { type: "deskMemo", dispatched: true, guess: null }
    return { type: "deskMemo", dispatched: false, guess: numerals }
  },
  nextGuess(state) {
    if (state.dispatched || !state.guess) return null
    return { guess: state.guess, detail: "deskMemo" }
  },
  applyResult(state, _guess, _result) {
    finishSingleShot(state)
    return state
  },
}

// #endregion

// #region BellaCuore single-value

// #region BellaCuore helpers

function romanToDecimal(roman: string): number | null {
  const trimmed = roman.trim()
  if (trimmed.toLowerCase() === "nulla") return 0
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }
  const upper = trimmed.toUpperCase()
  if (!upper || !/^[IVXLCDM]+$/.test(upper)) return null
  let total = 0
  for (let i = 0; i < upper.length; i++) {
    const current = values[upper[i]!]
    const next = values[upper[i + 1]!]
    if (current === undefined) return null
    total += next !== undefined && current < next ? -current : current
  }
  return total
}

// #endregion


interface BellaCuoreSingleState extends SolverState { type: "bellaCuoreSingle"; dispatched: boolean; guess: string | null }

const bellaCuoreSingle: SolverModule<BellaCuoreSingleState> = {
  init(details) {
    const data = details.data.trim()
    if (data.includes(",")) return { type: "bellaCuoreSingle", dispatched: true, guess: null }
    if (details.passwordHint !== `The password is the value of the number '${data}'`) {
      return { type: "bellaCuoreSingle", dispatched: true, guess: null }
    }
    const decimal = romanToDecimal(data)
    if (decimal === null) return { type: "bellaCuoreSingle", dispatched: true, guess: null }
    const password = String(decimal)
    if (password.length !== details.passwordLength) return { type: "bellaCuoreSingle", dispatched: true, guess: null }
    return { type: "bellaCuoreSingle", dispatched: false, guess: password }
  },
  nextGuess(state) {
    if (state.dispatched || !state.guess) return null
    return { guess: state.guess, detail: "bellaCuore" }
  },
  applyResult(state, _guess, _result) {
    finishSingleShot(state)
    return state
  },
}

// #endregion

// #region OctantVoxel (base-N conversion, including fractional bases like 15.1)


interface OctantVoxelState extends SolverState { type: "octantVoxel"; dispatched: boolean; guess: string | null }

const octantVoxel: SolverModule<OctantVoxelState> = {
  init(details) {
    const parts = details.data.split(",")
    if (parts.length !== 2) return { type: "octantVoxel", dispatched: true, guess: null }
    const fromBase = Number(parts[0]?.trim())
    const numberStr = parts[1]?.trim()
    if (!Number.isFinite(fromBase) || fromBase < 2 || !numberStr) {
      return { type: "octantVoxel", dispatched: true, guess: null }
    }
    const decimal = parseBaseNToDecimal(fromBase, numberStr)
    if (decimal === null) return { type: "octantVoxel", dispatched: true, guess: null }
    const rounded = Math.round(decimal)
    const password = String(rounded).padStart(details.passwordLength, "0")
    if (password.length !== details.passwordLength) return { type: "octantVoxel", dispatched: true, guess: null }
    return { type: "octantVoxel", dispatched: false, guess: password }
  },
  nextGuess(state) {
    if (state.dispatched || !state.guess) return null
    return { guess: state.guess, detail: "octantVoxel" }
  },
  applyResult(state, _guess, _result) {
    finishSingleShot(state)
    return state
  },
}

// #endregion

// #region MathML

// #region MathML helpers

const BASE_N_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

function baseNDigitValue(ch: string): number | null {
  const idx = BASE_N_CHARS.indexOf(ch.toUpperCase())
  return idx >= 0 ? idx : null
}

/** Matches game parseBaseNNumberString (supports fractional bases like 16.6). */
function parseBaseNToDecimal(base: number, numberStr: string): number | null {
  let result = 0
  let index = 0
  let digit = numberStr.split(".")[0]!.length - 1

  while (index < numberStr.length) {
    const ch = numberStr[index]!
    if (ch === ".") {
      index += 1
      continue
    }
    const dv = baseNDigitValue(ch)
    if (dv === null) return null
    result += dv * base ** digit
    index += 1
    digit -= 1
  }
  return result
}

function cleanArithmeticExpression(expression: string): string {
  return expression
    .replaceAll("\u04B3", "*")
    .replaceAll("\u0445", "*")
    .replaceAll("\u00F7", "/")
    .replaceAll("\u2796", "-")
    .replaceAll("\u2795", "+")
    .replaceAll("\u2212", "-")
    .replaceAll("\u00D7", "*")
    .replaceAll("\u00B7", "*")
    .replaceAll("\u2217", "*")
    .replaceAll("ns.exit(),", "")
    .split(",")[0]!
}

function parseSimpleArithmeticExpression(expression: string): number {
  const tokens = cleanArithmeticExpression(expression).split("")
  let currentDepth = 0
  const depth = tokens.map((token) => {
    if (token === "(") currentDepth += 1
    else if (token === ")") {
      currentDepth -= 1
      return currentDepth + 1
    }
    return currentDepth
  })
  const depth1Start = depth.indexOf(1)
  const firstZeroAfter = depth.indexOf(0, depth1Start)
  const depth1End = firstZeroAfter === -1 ? depth.length - 1 : firstZeroAfter - 1
  if (depth1Start !== -1) {
    const sub = tokens.slice(depth1Start + 1, depth1End).join("")
    const result = parseSimpleArithmeticExpression(sub)
    tokens.splice(depth1Start, depth1End - depth1Start + 1, result.toString())
    return parseSimpleArithmeticExpression(tokens.join(""))
  }
  let remaining = tokens.join("")
  const mulDiv = /(-?\d*\.?\d+) *([*/]) *(-?\d*\.?\d+)/
  let match = remaining.match(mulDiv)
  while (match) {
    const left = match[1]!
    const op = match[2]!
    const right = match[3]!
    const result = op === "*" ? parseFloat(left) * parseFloat(right) : parseFloat(left) / parseFloat(right)
    const resultStr = Math.abs(result) < 0.000001 ? result.toFixed(20) : result.toString()
    remaining = remaining.replace(match[0], resultStr)
    match = remaining.match(mulDiv)
  }
  const addSub = /(-?\d*\.?\d+) *([+-]) *(-?\d*\.?\d+)/
  match = remaining.match(addSub)
  while (match) {
    const left = match[1]!
    const op = match[2]!
    const right = match[3]!
    const result = op === "+" ? parseFloat(left) + parseFloat(right) : parseFloat(left) - parseFloat(right)
    remaining = remaining.replace(match[0], result.toString())
    match = remaining.match(addSub)
  }
  const leftover = remaining.match(/(-?\d*\.?\d+)/)
  return parseFloat(leftover?.[1] ?? "NaN")
}

// #endregion

//
// Game uses parseSimpleArithmeticExpression (not eval). Data may include unicode
// operators and a comma-suffix code-injection trap; only the part before "," counts.

interface MathMLState extends SolverState { type: "mathML"; dispatched: boolean; guess: string | null }

const mathML: SolverModule<MathMLState> = {
  init(details) {
    if (!details.data) return { type: "mathML", dispatched: true, guess: null }
    const result = parseSimpleArithmeticExpression(details.data)
    if (Number.isNaN(result) || !Number.isFinite(result)) return { type: "mathML", dispatched: true, guess: null }
    const resultStr = String(result)
    if (resultStr.length !== details.passwordLength) return { type: "mathML", dispatched: true, guess: null }
    return { type: "mathML", dispatched: false, guess: resultStr }
  },
  nextGuess(state) {
    if (state.dispatched || !state.guess) return null
    return { guess: state.guess, detail: "mathML" }
  },
  applyResult(state, _guess, _result) {
    finishSingleShot(state)
    return state
  },
}

// #endregion

// #region PrimeTime 2


const LARGE_PRIMES = [
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71,
  73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151,
  157, 163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229, 233,
  239, 241, 251, 257, 263, 269, 271, 277, 281, 283, 293, 307, 311, 313, 317,
  331, 337, 347, 349, 353, 359, 367, 373, 379, 383, 389, 397, 401, 409, 419,
  421, 431, 433, 439, 443, 449, 457, 461, 463, 467, 479, 487, 491, 499, 503,
  509, 521, 523, 541,
]

interface PrimeTime2State extends SolverState { type: "primeTime2"; dispatched: boolean; factors: string[]; factorIdx: number }

const primeTime2: SolverModule<PrimeTime2State> = {
  init(details) {
    if (!details.data) return { type: "primeTime2", dispatched: true, factors: [], factorIdx: 0 }
    const target = Number(details.data)
    if (!Number.isFinite(target) || !Number.isSafeInteger(target)) return { type: "primeTime2", dispatched: true, factors: [], factorIdx: 0 }

    // Try trial division with all primes in the list, then check if the
    // remaining cofactor is itself prime (the real largest prime factor).
    let remaining = target
    const smallFactors: number[] = []
    for (const p of LARGE_PRIMES) {
      while (remaining % p === 0 && remaining > 1) {
        smallFactors.push(p)
        remaining /= p
      }
    }

    // If nothing remained, the largest prime factor is in our list.
    // If something remained and it's > 1, it IS the largest prime factor
    // (all factors ≤ 541 were extracted; any remaining factor must be > 541 and prime).
    const pad = (n: number): string => {
      const raw = String(n)
      return raw.length < details.passwordLength
        ? "0".repeat(details.passwordLength - raw.length) + raw
        : raw
    }

    const factors: string[] = []
    if (remaining > 1) {
      factors.push(pad(remaining))
    }
    // Also try small factors (largest first) as fallback
    smallFactors.sort((a, b) => b - a)
    for (const f of smallFactors) {
      factors.push(pad(f))
    }

    return { type: "primeTime2", dispatched: factors.length === 0, factors, factorIdx: 0 }
  },
  nextGuess(state) {
    if (state.dispatched) return null
    if (state.factorIdx >= state.factors.length) return null
    return { guess: state.factors[state.factorIdx]!, detail: `primeTime2` }
  },
  applyResult(state, _guess, result) {
    if (result.success) {
      state.dispatched = true
      return state
    }
    state.factorIdx++
    if (state.factorIdx >= state.factors.length) state.dispatched = true
    return state
  },
}

// #endregion

// #region 110100100 (binary-to-text)


interface BinaryToTextState extends SolverState { type: "binaryToText"; dispatched: boolean; guess: string | null }

const binaryToText: SolverModule<BinaryToTextState> = {
  init(details) {
    if (!details.data) return { type: "binaryToText", dispatched: true, guess: null }
    const chars: string[] = []
    for (const token of details.data.split(/\s+/)) {
      if (!/^[01]{8}$/.test(token)) continue
      chars.push(String.fromCharCode(parseInt(token, 2)))
    }
    if (chars.length === 0) return { type: "binaryToText", dispatched: true, guess: null }
    const result = chars.join("")
    if (result.length !== details.passwordLength) return { type: "binaryToText", dispatched: true, guess: null }
    return { type: "binaryToText", dispatched: false, guess: result }
  },
  nextGuess(state) {
    if (state.dispatched || !state.guess) return null
    return { guess: state.guess, detail: "110100100" }
  },
  applyResult(state, _guess, _result) {
    finishSingleShot(state)
    return state
  },
}

// #endregion

// #region OrdoXenos (XOR decryption)


interface OrdoXenosState extends SolverState { type: "ordoXenos"; dispatched: boolean; guess: string | null }

const ordoXenos: SolverModule<OrdoXenosState> = {
  init(details) {
    if (!details.data) return { type: "ordoXenos", dispatched: true, guess: null }
    const semiIdx = details.data.indexOf(";")
    if (semiIdx <= 0) return { type: "ordoXenos", dispatched: true, guess: null }
    const mask = details.data.slice(0, semiIdx)
    const binPart = details.data.slice(semiIdx + 1)
    const bins = binPart.split(/\s+/).filter((t) => /^[01]{8}$/.test(t))
    if (mask.length !== bins.length || mask.length !== details.passwordLength) {
      return { type: "ordoXenos", dispatched: true, guess: null }
    }
    const chars: string[] = []
    for (let i = 0; i < mask.length; i++) {
      const xorKey = parseInt(bins[i]!, 2)
      chars.push(String.fromCharCode(mask.charCodeAt(i) ^ xorKey))
    }
    return { type: "ordoXenos", dispatched: false, guess: chars.join("") }
  },
  nextGuess(state) {
    if (state.dispatched || !state.guess) return null
    return { guess: state.guess, detail: "ordoXenos" }
  },
  applyResult(state, _guess, _result) {
    finishSingleShot(state)
    return state
  },
}

// #endregion

// #region Pr0verFl0 (buffer overflow)


interface ProverFloState extends SolverState { type: "proverFlo"; dispatched: boolean; guess: string | null }

const proverFlo: SolverModule<ProverFloState> = {
  init(details) {
    const half = "0".repeat(details.passwordLength)
    return { type: "proverFlo", dispatched: false, guess: half + half }
  },
  nextGuess(state) {
    if (state.dispatched || !state.guess) return null
    return { guess: state.guess, detail: "proverFlo" }
  },
  applyResult(state, _guess, _result) {
    finishSingleShot(state)
    return state
  },
}

// #endregion

// #region Laika4


interface Laika4State extends SolverState { type: "laika4"; remaining: string[] }

const LAIKA4_DOGS = ["max", "fido", "spot", "rover"]

const laika4: SolverModule<Laika4State> = {
  init(details) {
    const candidates = LAIKA4_DOGS.filter((n) => n.length === details.passwordLength)
    return { type: "laika4", remaining: candidates }
  },
  nextGuess(state) {
    if (state.remaining.length === 0) return null
    const guess = state.remaining[state.remaining.length - 1]!
    return { guess, detail: `laika4 (${state.remaining.length} left)` }
  },
  applyResult(state, guess, result) {
    consumeFromEnd(state.remaining, guess, result.success)
    return state
  },
}

// #endregion

// #region PHP 5.4

// #region Shared multiset permutations

function multisetFactorial(n: number): number {
  let product = 1
  for (let i = 2; i <= n; i++) product *= i
  return product
}

/** Multiset permutation count: n! / (c1! * c2! * ...). */
function multisetPermutationCount(counts: readonly number[]): number {
  let n = 0
  let denom = 1
  for (const c of counts) {
    n += c
    denom *= multisetFactorial(c)
  }
  return multisetFactorial(n) / denom
}

/** Build sorted unique chars + counts from a sorted char list. */
function sortedCharsToMultiset(sorted: readonly string[]): { chars: string[]; counts: number[] } {
  const chars: string[] = []
  const counts: number[] = []
  for (const ch of sorted) {
    if (chars.length > 0 && chars[chars.length - 1] === ch) {
      counts[counts.length - 1]!++
    } else {
      chars.push(ch)
      counts.push(1)
    }
  }
  return { chars, counts }
}

/** Nth string (0-based) in depth-first lexicographic order over charset^length. */
function mastermindCartesianAt(charset: string, length: number, index: number): string | null {
  if (length <= 0) return null
  const base = charset.length
  const size = base ** length
  if (index < 0 || index >= size) return null
  let k = index
  let out = ""
  for (let pos = 0; pos < length; pos++) {
    const pow = base ** (length - 1 - pos)
    const ci = Math.floor(k / pow)
    k -= ci * pow
    out += charset[ci]!
  }
  return out
}

/** Nth permutation (0-based) in lexicographic multiset order, without enumerating all. */
function multisetPermutationAt(
  chars: readonly string[],
  counts: readonly number[],
  index: number,
): string | null {
  const total = multisetPermutationCount(counts)
  if (index < 0 || index >= total) return null

  const remaining = [...counts]
  const length = remaining.reduce((a, b) => a + b, 0)
  let k = index
  const out: string[] = []

  for (let pos = 0; pos < length; pos++) {
    let placed = false
    for (let i = 0; i < chars.length; i++) {
      if (remaining[i]! <= 0) continue
      remaining[i]!--
      const ways = multisetPermutationCount(remaining)
      if (k < ways) {
        out.push(chars[i]!)
        placed = true
        break
      }
      k -= ways
      remaining[i]!++
    }
    if (!placed) return null
  }

  return out.join("")
}

// #endregion

// #region PHP 5.4 helpers

function php54SortedCounts(digits: string): { chars: string[]; counts: number[] } {
  return sortedCharsToMultiset(digits.split("").sort())
}

/** Extract sorted hint digits; null when hint does not match password length. */
function php54HintDigits(hint: string, length: number): string | null {
  const digits = hint.replace(/\D/g, "")
  if (digits.length !== length) return null
  return digits
}

/** Number of distinct permutations of PHP 5.4 sorted hint digits. */
function php54PermutationCount(hint: string, length: number): number {
  const digits = php54HintDigits(hint, length)
  if (digits === null) return 0
  return multisetPermutationCount(php54SortedCounts(digits).counts)
}

/** Nth permutation (0-based) in lexicographic multiset order, without enumerating all. */
function php54PermutationAt(hint: string, length: number, index: number): string | null {
  const digits = php54HintDigits(hint, length)
  if (digits === null) return null
  const { chars, counts } = php54SortedCounts(digits)
  return multisetPermutationAt(chars, counts, index)
}

// #endregion


interface Php54State extends SolverState {
  type: "php54"
  /** Sorted hint digits (small string, not a candidate list). */
  digits: string
  index: number
  total: number
}

const php54: SolverModule<Php54State> = {
  init(details) {
    const digits = php54HintDigits(details.passwordHint, details.passwordLength)
    if (digits === null) {
      return { type: "php54", digits: "", index: 0, total: 0 }
    }
    return {
      type: "php54",
      digits,
      index: 0,
      total: php54PermutationCount(details.passwordHint, details.passwordLength),
    }
  },
  nextGuess(state) {
    if (state.total === 0 || state.index >= state.total) return null
    const guess = php54PermutationAt(state.digits, state.digits.length, state.index)
    if (guess === null) return null
    return { guess, detail: `php54 (${state.total - state.index - 1} left)` }
  },
  applyResult(state, _guess, result) {
    if (result.success) state.index = state.total
    else state.index++
    return state
  },
}

// #endregion

// #region EuroZone Free


interface EuroZoneState extends SolverState { type: "euroZone"; remaining: string[] }

const EU_COUNTRIES = [
  "Austria",
  "Belgium",
  "Bulgaria",
  "Croatia",
  "Republic of Cyprus",
  "Czech Republic",
  "Denmark",
  "Estonia",
  "Finland",
  "France",
  "Germany",
  "Greece",
  "Hungary",
  "Ireland",
  "Italy",
  "Latvia",
  "Lithuania",
  "Luxembourg",
  "Malta",
  "Netherlands",
  "Poland",
  "Portugal",
  "Romania",
  "Slovakia",
  "Slovenia",
  "Spain",
  "Sweden",
]

const euroZone: SolverModule<EuroZoneState> = {
  init(details) {
    const candidates = EU_COUNTRIES.filter((c) => c.length === details.passwordLength)
    return { type: "euroZone", remaining: candidates }
  },
  nextGuess(state) {
    if (state.remaining.length === 0) return null
    const guess = state.remaining[state.remaining.length - 1]!
    return { guess, detail: `euroZone (${state.remaining.length} left)` }
  },
  applyResult(state, guess, result) {
    consumeFromEnd(state.remaining, guess, result.success)
    return state
  },
}

// #endregion

// #region TopPass


interface TopPassState extends SolverState { type: "topPass"; remaining: string[] }

const topPass: SolverModule<TopPassState> = {
  init(details) {
    const candidates = [...COMMON_PASSWORDS].filter((c) => c.length === details.passwordLength)
    return { type: "topPass", remaining: candidates }
  },
  nextGuess(state) {
    if (state.remaining.length === 0) return null
    const guess = state.remaining[state.remaining.length - 1]!
    return { guess, detail: `topPass (${state.remaining.length} left)` }
  },
  applyResult(state, guess, result) {
    consumeFromEnd(state.remaining, guess, result.success)
    return state
  },
}

// #endregion

// #region FreshInstall_1.0 (factory default dictionary)


interface FreshInstallState extends SolverState { type: "freshInstall"; remaining: string[] }

const freshInstall: SolverModule<FreshInstallState> = {
  init(details) {
    const remaining = DEFAULT_FACTORY_PASSWORDS.filter((p) => p.length === details.passwordLength)
    return { type: "freshInstall", remaining: [...remaining] }
  },
  nextGuess(state) {
    if (state.remaining.length === 0) return null
    const guess = state.remaining[0]!
    return { guess, detail: `default (${state.remaining.length} left)` }
  },
  applyResult(state, guess, result) {
    consumeFromFront(state.remaining, guess, result.success)
    return state
  },
}

// #endregion

// #region NIL


interface NilState extends SolverState {
  type: "nil"
  chars: (string | null)[]
  charset: string
  charIdx: number
  retries: number   // count retries of current char (unparseable feedback)
  finalDispatched: boolean
}

const nilSolver: SolverModule<NilState> = {
  init(details) {
    const charset =
      details.passwordFormat === "alphabetic" ? "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
      : details.passwordFormat === "alphanumeric" ? "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
      : "0123456789"
    return {
      type: "nil",
      chars: Array.from({ length: details.passwordLength }, () => null),
      charset, charIdx: 0, retries: 0, finalDispatched: false,
    }
  },
  nextGuess(state) {
    if (state.chars.every((d) => d !== null)) {
      if (state.finalDispatched) return null
      return { guess: state.chars.join(""), detail: "NIL final" }
    }
    if (state.charIdx < state.charset.length) {
      const ch = state.charset[state.charIdx]!
      return { guess: ch.repeat(state.chars.length), detail: `NIL char ${ch}` }
    }
    // Charset exhausted but some positions still null — fill with first char and dispatch
    for (let i = 0; i < state.chars.length; i++) {
      if (state.chars[i] === null) state.chars[i] = state.charset[0]!
    }
    if (state.finalDispatched) return null
    return { guess: state.chars.join(""), detail: "NIL final (fallback)" }
  },
  applyResult(state, guess, result) {
    if (result.success) return state
    if (guess.length > 1 && !state.finalDispatched) {
      const feedback = result.feedback ?? ""
      const parts = feedback.split(",")
      if (parts.length === state.chars.length) {
        state.retries = 0
        let any = false
        for (let i = 0; i < parts.length; i++) {
          if (parts[i] === "yes") { state.chars[i] = guess[0]!; any = true }
        }
        state.charIdx++
      } else {
        // Unparseable feedback — retry up to 3 times, then advance anyway
        state.retries++
        if (state.retries > 3) {
          state.retries = 0
          state.charIdx++
        }
      }
    } else {
      state.finalDispatched = true
    }
    return state
  },
}

// #endregion

// #region AccountsManager_4.2


interface AccountsManagerState extends SolverState { type: "accountsManager"; lo: number; hi: number; length: number }

const accountsManager: SolverModule<AccountsManagerState> = {
  init(details) {
    // Hint format: "The password is a number between 0 and NNN"
    // Take the LAST number (the upper bound), not the first (which would be 0).
    const matches = [...details.passwordHint.matchAll(/\d+/g)]
    const upper = matches.length >= 2 ? Number(matches[matches.length - 1]![0]) : 100
    return { type: "accountsManager", lo: 0, hi: upper - 1, length: details.passwordLength }
  },
  nextGuess(state) {
    if (state.lo > state.hi) return null
    const mid = Math.floor((state.lo + state.hi) / 2)
    const raw = String(mid)
    const padded = raw.length < state.length ? "0".repeat(state.length - raw.length) + raw : raw
    return { guess: padded, detail: `bin ${mid}` }
  },
  applyResult(state, guess, result) {
    if (result.success) return state
    const g = Number(guess)
    const fb = result.feedback
    if (fb === "Lower") state.hi = g - 1
    else if (fb === "Higher") state.lo = g + 1
    else { state.lo = state.hi + 1 }
    return state
  },
}

// #endregion

// #region BellaCuore range


interface BellaCuoreRangeState extends SolverState { type: "bellaCuoreRange"; lo: number; hi: number; length: number }

const bellaCuoreRange: SolverModule<BellaCuoreRangeState> = {
  init(details) {
    const parts = details.data.split(",")
    if (parts.length !== 2) return { type: "bellaCuoreRange", lo: 1, hi: 0, length: details.passwordLength }
    const lo = romanToDecimal(parts[0]!)
    const hi = romanToDecimal(parts[1]!)
    if (lo === null || hi === null || lo > hi) return { type: "bellaCuoreRange", lo: 1, hi: 0, length: details.passwordLength }
    return { type: "bellaCuoreRange", lo, hi, length: details.passwordLength }
  },
  nextGuess(state) {
    if (state.lo > state.hi) return null
    const mid = Math.floor((state.lo + state.hi) / 2)
    return { guess: String(mid).padStart(state.length, "0"), detail: `bc ${mid}` }
  },
  applyResult(state, guess, result) {
    if (result.success) return state
    const g = Number(guess)
    const fb = result.feedback
    if (fb === "ALTUS NIMIS") state.hi = g - 1
    else if (fb === "PARUM BREVIS") state.lo = g + 1
    return state
  },
}

// #endregion

// #region DeepGreen (Mastermind)

// #region DeepGreen helpers

function mastermindCharset(format: string): string {
  switch (format) {
    case "numeric":
      return "0123456789"
    case "alphabetic":
      return "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    case "alphanumeric":
      return "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    default:
      return "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  }
}

function mastermindFeedback(secret: string, guess: string): { exact: number; misplaced: number } {
  let exact = 0
  const secretRem: string[] = []
  const guessRem: string[] = []
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) exact++
    else {
      secretRem.push(secret[i]!)
      guessRem.push(guess[i]!)
    }
  }
  let misplaced = 0
  const used = secretRem.map(() => false)
  for (const ch of guessRem) {
    const idx = secretRem.findIndex((s, i) => !used[i] && s === ch)
    if (idx >= 0) {
      used[idx] = true
      misplaced++
    }
  }
  return { exact, misplaced }
}

function parseMastermindFeedback(data: string): { exact: number; misplaced: number } | null {
  const parts = data.split(",")
  if (parts.length !== 2) return null
  const exact = Number(parts[0]?.trim())
  const misplaced = Number(parts[1]?.trim())
  if (!Number.isInteger(exact) || !Number.isInteger(misplaced)) return null
  return { exact, misplaced }
}

const MAX_MASTERMIND_CANDIDATES = 100_000
const MINIMAX_THRESHOLD = 500

/** Switch from bitset to index list when survivor count drops below this. */
const MASTERMIND_LIST_THRESHOLD = 5000

type MastermindSurvivors =
  | { mode: "all" }
  | { mode: "bitset"; bits: Uint32Array; count: number }
  | { mode: "list"; indices: number[] }

function mastermindSurvivorsAll(): MastermindSurvivors {
  return { mode: "all" }
}

function mastermindBitGet(bits: Uint32Array, index: number): boolean {
  return (bits[index >> 5]! & (1 << (index & 31))) !== 0
}

function mastermindBitSet(bits: Uint32Array, index: number): void {
  bits[index >> 5]! |= 1 << (index & 31)
}

function mastermindCreateBitset(total: number): Uint32Array {
  const words = Math.ceil(total / 32)
  return new Uint32Array(words)
}

function mastermindSurvivorIndexAtSlot(survivors: MastermindSurvivors, total: number, slot: number): number {
  if (survivors.mode === "list") return survivors.indices[slot]!
  if (survivors.mode === "all") return slot
  let seen = 0
  for (let i = 0; i < total; i++) {
    if (mastermindBitGet(survivors.bits, i)) {
      if (seen === slot) return i
      seen++
    }
  }
  return 0
}

function mastermindSurvivorCount(survivors: MastermindSurvivors, total: number): number {
  if (survivors.mode === "all") return total
  if (survivors.mode === "list") return survivors.indices.length
  return survivors.count
}

function mastermindIndicesFromBitset(bits: Uint32Array, total: number): number[] {
  const indices: number[] = []
  for (let i = 0; i < total; i++) {
    if (mastermindBitGet(bits, i)) indices.push(i)
  }
  return indices
}

function mastermindCompactSurvivors(bits: Uint32Array, total: number, count: number): MastermindSurvivors {
  if (count <= MASTERMIND_LIST_THRESHOLD) {
    return { mode: "list", indices: mastermindIndicesFromBitset(bits, total) }
  }
  return { mode: "bitset", bits, count }
}

function filterMastermindSurvivors(
  survivors: MastermindSurvivors,
  total: number,
  keep: (index: number) => boolean,
): MastermindSurvivors {
  if (survivors.mode === "list") {
    return { mode: "list", indices: survivors.indices.filter((i) => keep(i)) }
  }

  const bits = mastermindCreateBitset(total)
  let count = 0

  if (survivors.mode === "all") {
    for (let i = 0; i < total; i++) {
      if (!keep(i)) continue
      mastermindBitSet(bits, i)
      count++
    }
  } else {
    for (let i = 0; i < total; i++) {
      if (!mastermindBitGet(survivors.bits, i) || !keep(i)) continue
      mastermindBitSet(bits, i)
      count++
    }
  }

  if (count === 0) return { mode: "list", indices: [] }
  return mastermindCompactSurvivors(bits, total, count)
}

/** Pick a mastermind probe from survivor indices; materialize strings on demand. */
function pickMastermindGuessIndexed(
  survivors: MastermindSurvivors,
  total: number,
  secretAt: (index: number) => string,
): string {
  const count = mastermindSurvivorCount(survivors, total)
  if (count === 0) return ""

  const atSlot = (slot: number): string =>
    secretAt(mastermindSurvivorIndexAtSlot(survivors, total, slot))

  if (count > MINIMAX_THRESHOLD) {
    return atSlot(Math.floor(Math.random() * count))
  }

  let bestGuess = atSlot(0)
  let bestWorst = count + 1
  for (let gi = 0; gi < count; gi++) {
    const guess = atSlot(gi)
    const buckets = new Map<string, number>()
    for (let si = 0; si < count; si++) {
      const fb = mastermindFeedback(atSlot(si), guess)
      const key = `${fb.exact},${fb.misplaced}`
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
    const worst = Math.max(...buckets.values(), 0)
    if (worst < bestWorst) {
      bestWorst = worst
      bestGuess = guess
    }
  }
  return bestGuess
}

// #endregion

interface DeepGreenCountBatch {
  /** Batch guess sent for this group (length = password length). */
  guess: string
  /** Chars from the batch to probe with repeat guesses (test chars only, not pad). */
  chars: string[]
  exact: number
  misplaced: number
  charIdx: number
  /** Sum of min(count(c), occ(c) in batch guess); skip rest when >= exact + misplaced. */
  explained: number
}

interface DeepGreenConstraint {
  guess: string
  exact: number
  misplaced: number
}

interface DeepGreenState extends SolverState {
  type: "deepGreen"
  /** Full charset at init; state.charset may narrow in phase 2. */
  initialCharset: string
  charset: string
  length: number
  charCounts: Record<string, number>
  totalCount: number
  /** Phase 1: batch elimination, then repeat-char counts, optional tail for unpadded leftovers. */
  phase1Mode: "batch" | "count" | "tail"
  pool: string[]
  eliminated: Record<string, boolean>
  /** First eliminated char; pads partial batches to password length. */
  padChar: string | null
  countBatches: DeepGreenCountBatch[]
  countBatchIdx: number
  tailIdx: number
  /** Phase 1 guess feedback replayed when entering phase 2. */
  constraints: DeepGreenConstraint[]
  // Phase 2 — index into cartesian or multiset permutation space
  permCartesian: boolean
  permChars: string[]
  permCounts: number[]
  permTotal: number
  survivors: MastermindSurvivors
}

function deepGreenInitPhase1(state: DeepGreenState): void {
  state.phase1Mode = "batch"
  state.pool = state.initialCharset.split("")
  state.eliminated = {}
  state.padChar = null
  state.countBatches = []
  state.countBatchIdx = 0
  state.tailIdx = 0
  state.charCounts = {}
  state.totalCount = 0
  state.constraints = []
}

/** Chars still allowed in the password after phase 1 (unknown or positive count). */
function deepGreenPhase1Charset(state: DeepGreenState): string {
  let out = ""
  for (const ch of state.initialCharset) {
    if (state.charCounts[ch] === 0) continue
    if (state.eliminated[ch] && state.charCounts[ch] === undefined) continue
    out += ch
  }
  return out
}

/** Initial-charset letters not yet repeat-counted. */
function deepGreenUnknownCharsetChars(state: DeepGreenState): string[] {
  return state.initialCharset.split("").filter(
    (ch) => state.charCounts[ch] === undefined && !state.eliminated[ch],
  )
}

function deepGreenStartUnknownTail(state: DeepGreenState): boolean {
  const unknown = deepGreenUnknownCharsetChars(state)
  if (unknown.length === 0) return false
  state.phase1Mode = "tail"
  state.tailIdx = 0
  const inPool = new Set(state.pool)
  for (const ch of unknown) {
    if (!inPool.has(ch)) state.pool.push(ch)
  }
  return true
}

function deepGreenRecordConstraint(
  state: DeepGreenState,
  guess: string,
  fb: { exact: number; misplaced: number },
): void {
  state.constraints.push({ guess, exact: fb.exact, misplaced: fb.misplaced })
}

function deepGreenReplayConstraints(state: DeepGreenState): void {
  if (state.constraints.length === 0) return
  state.survivors = filterMastermindSurvivors(
    state.survivors,
    state.permTotal,
    (index) => {
      const secret = deepGreenSecretAt(state, index)
      return state.constraints.every((c) => {
        const f = mastermindFeedback(secret, c.guess)
        return f.exact === c.exact && f.misplaced === c.misplaced
      })
    },
  )
}

function deepGreenCloseOutBatch(state: DeepGreenState, batch: DeepGreenCountBatch): void {
  if (batch.explained < batch.exact + batch.misplaced) return
  if (batch.exact + batch.misplaced === 0) return
  for (const c of batch.chars) {
    if (state.charCounts[c] !== undefined) continue
    state.charCounts[c] = 0
    if (!state.eliminated[c]) deepGreenMarkEliminated(state, c)
  }
  batch.charIdx = batch.chars.length
}

function deepGreenOccInGuess(guess: string, ch: string): number {
  let n = 0
  for (const c of guess) if (c === ch) n++
  return n
}

function deepGreenUniqueTestChars(testChars: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of testChars) {
    if (seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
}

function deepGreenMarkEliminated(state: DeepGreenState, ch: string): void {
  if (state.eliminated[ch]) return
  state.eliminated[ch] = true
  if (state.padChar === null) state.padChar = ch
}

function deepGreenActivePool(state: DeepGreenState): string[] {
  return state.pool.filter((c) => !state.eliminated[c])
}

function deepGreenUncountedPoolChars(state: DeepGreenState): string[] {
  return state.pool.filter((c) => !state.eliminated[c] && state.charCounts[c] === undefined)
}

function deepGreenRemoveFromPool(state: DeepGreenState, chars: readonly string[]): void {
  const drop = new Set(chars)
  state.pool = state.pool.filter((c) => !drop.has(c))
}

/** Build next batch guess from pool, or null when pool empty / tail fallback needed. */
function deepGreenBuildBatchGuess(state: DeepGreenState): string | null {
  const active = deepGreenActivePool(state)
  if (active.length === 0) return null
  const testChars = active.slice(0, Math.min(state.length, active.length))
  if (testChars.length < state.length && state.padChar === null) return null
  const guessChars = [...testChars]
  while (guessChars.length < state.length) {
    guessChars.push(state.padChar!)
  }
  return guessChars.join("")
}

function deepGreenBatchTestChars(state: DeepGreenState): string[] {
  const active = deepGreenActivePool(state)
  const testLen = Math.min(active.length, state.length)
  return deepGreenUniqueTestChars(active.slice(0, testLen))
}

function deepGreenMaybeEnterPhase2(state: DeepGreenState): boolean {
  if (state.totalCount < state.length) return false
  deepGreenEnterPhase2(state, deepGreenMultisetChars(state))
  return true
}

function deepGreenPhase2Guess(state: DeepGreenState): { guess: string; detail: string } | null {
  const count = mastermindSurvivorCount(state.survivors, state.permTotal)
  if (count === 0) return null
  const guess = pickMastermindGuessIndexed(
    state.survivors,
    state.permTotal,
    (index) => deepGreenSecretAt(state, index),
  )
  return { guess, detail: `${count} cand` }
}

function deepGreenNextCountGuess(state: DeepGreenState): { guess: string; detail: string } | null {
  while (state.countBatchIdx < state.countBatches.length) {
    const batch = state.countBatches[state.countBatchIdx]!
    while (batch.charIdx < batch.chars.length) {
      const ch = batch.chars[batch.charIdx]!
      if (state.eliminated[ch] || state.charCounts[ch] !== undefined) {
        batch.charIdx++
        continue
      }
      return { guess: ch.repeat(state.length), detail: `count ${ch}` }
    }
    state.countBatchIdx++
  }
  if (deepGreenUncountedPoolChars(state).length > 0) {
    state.phase1Mode = "tail"
    state.tailIdx = 0
    return deepGreenNextTailGuess(state)
  }
  if (state.totalCount < state.length) {
    if (deepGreenStartUnknownTail(state)) return deepGreenNextTailGuess(state)
  }
  return deepGreenFinishPhase1(state)
}

function deepGreenFinishPhase1(state: DeepGreenState): { guess: string; detail: string } | null {
  if (state.totalCount < state.length) {
    if (deepGreenStartUnknownTail(state)) return deepGreenNextTailGuess(state)
  }

  if (state.totalCount >= state.length) {
    deepGreenEnterPhase2(state, deepGreenMultisetChars(state))
    return deepGreenPhase2Guess(state)
  }

  const charset = deepGreenPhase1Charset(state)
  if (charset.length === 0) return null

  const cartSize = charset.length ** state.length
  if (cartSize > MAX_MASTERMIND_CANDIDATES) return null

  state.permCartesian = true
  state.charset = charset
  state.permTotal = cartSize
  state.survivors = mastermindSurvivorsAll()
  state.totalCount = state.length
  deepGreenReplayConstraints(state)
  if (mastermindSurvivorCount(state.survivors, state.permTotal) === 0) return null
  return deepGreenPhase2Guess(state)
}

function deepGreenNextTailGuess(state: DeepGreenState): { guess: string; detail: string } | null {
  while (state.tailIdx < state.pool.length) {
    const ch = state.pool[state.tailIdx]!
    if (state.eliminated[ch] || state.charCounts[ch] !== undefined) {
      state.tailIdx++
      continue
    }
    return { guess: ch.repeat(state.length), detail: `count ${ch}` }
  }
  return deepGreenFinishPhase1(state)
}

function deepGreenApplyBatchResult(
  state: DeepGreenState,
  batchGuess: string,
  fb: { exact: number; misplaced: number },
): void {
  const testChars = deepGreenBatchTestChars(state)
  const isFullBatch = testChars.length >= state.length

  if (fb.exact === 0 && fb.misplaced === 0) {
    if (isFullBatch) {
      for (const c of testChars) deepGreenMarkEliminated(state, c)
    } else {
      // Partial batch (padded): repeat-count each test char instead of eliminating on (0,0).
      state.countBatches.push({
        guess: batchGuess,
        chars: testChars,
        exact: 0,
        misplaced: 0,
        charIdx: 0,
        explained: 0,
      })
      deepGreenRemoveFromPool(state, testChars)
    }
    return
  }
  state.countBatches.push({
    guess: batchGuess,
    chars: testChars,
    exact: fb.exact,
    misplaced: fb.misplaced,
    charIdx: 0,
    explained: 0,
  })
  deepGreenRemoveFromPool(state, testChars)
}

function deepGreenApplyCountResult(
  state: DeepGreenState,
  fb: { exact: number; misplaced: number },
): void {
  const batch = state.countBatches[state.countBatchIdx]
  if (!batch) return
  const ch = batch.chars[batch.charIdx]!
  const count = fb.exact
  state.charCounts[ch] = count
  state.totalCount += count
  if (count === 0) deepGreenMarkEliminated(state, ch)
  batch.explained += Math.min(count, deepGreenOccInGuess(batch.guess, ch))
  deepGreenCloseOutBatch(state, batch)
  if (batch.charIdx < batch.chars.length) {
    batch.charIdx++
  }
}

function deepGreenApplyTailResult(
  state: DeepGreenState,
  fb: { exact: number; misplaced: number },
): void {
  const ch = state.pool[state.tailIdx]!
  const count = fb.exact
  state.charCounts[ch] = count
  state.totalCount += count
  if (count === 0) deepGreenMarkEliminated(state, ch)
  state.tailIdx++
}

function deepGreenMultisetChars(state: DeepGreenState): string[] {
  const digits: string[] = []
  for (const [c, cnt] of Object.entries(state.charCounts)) {
    for (let i = 0; i < cnt; i++) digits.push(c)
  }
  return digits.slice(0, state.length)
}

function deepGreenEnterPhase2(state: DeepGreenState, multisetChars: string[]): void {
  const { chars, counts } = sortedCharsToMultiset([...multisetChars].sort())
  state.permCartesian = false
  state.permChars = chars
  state.permCounts = counts
  state.permTotal = multisetPermutationCount(counts)
  state.survivors = mastermindSurvivorsAll()
  state.totalCount = state.length
  deepGreenReplayConstraints(state)
}

function deepGreenSecretAt(state: DeepGreenState, index: number): string {
  if (state.permCartesian) {
    return mastermindCartesianAt(state.charset, state.length, index)!
  }
  return multisetPermutationAt(state.permChars, state.permCounts, index)!
}

const deepGreen: SolverModule<DeepGreenState> = {
  init(details) {
    const charset = mastermindCharset(details.passwordFormat)
    const cartSize = charset.length ** details.passwordLength
    const base: DeepGreenState = {
      type: "deepGreen",
      initialCharset: charset,
      charset,
      length: details.passwordLength,
      charCounts: {},
      totalCount: 0,
      phase1Mode: "batch",
      pool: [],
      eliminated: {},
      padChar: null,
      countBatches: [],
      countBatchIdx: 0,
      tailIdx: 0,
      constraints: [],
      permCartesian: false,
      permChars: [],
      permCounts: [],
      permTotal: 0,
      survivors: mastermindSurvivorsAll(),
    }
    if (cartSize <= MAX_MASTERMIND_CANDIDATES) {
      base.totalCount = details.passwordLength
      base.permCartesian = true
      base.permTotal = cartSize
      return base
    }
    deepGreenInitPhase1(base)
    return base
  },
  nextGuess(state) {
    if (state.totalCount >= state.length) {
      return deepGreenPhase2Guess(state)
    }

    if (state.phase1Mode === "batch") {
      const batchGuess = deepGreenBuildBatchGuess(state)
      if (batchGuess !== null) {
        return { guess: batchGuess, detail: "batch" }
      }
      if (state.countBatchIdx < state.countBatches.length) {
        state.phase1Mode = "count"
        return deepGreenNextCountGuess(state)
      }
      if (deepGreenUncountedPoolChars(state).length > 0 && state.padChar === null) {
        state.phase1Mode = "tail"
        state.tailIdx = 0
        return deepGreenNextTailGuess(state)
      }
      if (state.totalCount < state.length) {
        if (deepGreenStartUnknownTail(state)) return deepGreenNextTailGuess(state)
      }
      state.phase1Mode = "count"
      return deepGreenNextCountGuess(state)
    }

    if (state.phase1Mode === "count") {
      return deepGreenNextCountGuess(state)
    }

    return deepGreenNextTailGuess(state)
  },
  applyResult(state, guess, result) {
    if (result.success) return state

    if (state.totalCount < state.length) {
      const fbRaw = result.feedback ?? ""
      const fb = parseMastermindFeedback(fbRaw)
      if (!fb) return state

      if (state.phase1Mode === "batch") {
        const testChars = deepGreenBatchTestChars(state)
        const deferConstraint =
          testChars.length < state.length && fb.exact === 0 && fb.misplaced === 0
        if (!deferConstraint) deepGreenRecordConstraint(state, guess, fb)
        deepGreenApplyBatchResult(state, guess, fb)
      } else {
        deepGreenRecordConstraint(state, guess, fb)
        if (state.phase1Mode === "count") {
          deepGreenApplyCountResult(state, fb)
          if (deepGreenMaybeEnterPhase2(state)) return state
        } else {
          deepGreenApplyTailResult(state, fb)
          if (deepGreenMaybeEnterPhase2(state)) return state
        }
      }
      return state
    }

    const fbRaw = result.feedback ?? ""
    const fb = parseMastermindFeedback(fbRaw)
    if (!fb) return state
    deepGreenRecordConstraint(state, guess, fb)
    state.survivors = filterMastermindSurvivors(
      state.survivors,
      state.permTotal,
      (index) => {
        const f = mastermindFeedback(deepGreenSecretAt(state, index), guess)
        return f.exact === fb.exact && f.misplaced === fb.misplaced
      },
    )
    return state
  },
}

// #endregion

// #region Factori-Os

// #region Factori-Os helpers

function parseBoolFeedback(data: unknown): boolean | null {
  if (data === true || data === "true") return true
  if (data === false || data === "false") return false
  return null
}

// #endregion


/** Matches ServerGenerator.smallPrimes — tested first. */
const FACTORIOS_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97]
/** Matches ServerGenerator.largePrimes — appended at difficulty > 12 (and twice at > 24). */
const FACTORIOS_LARGE_PRIMES = [
  1069, 1409, 1471, 1567, 1597, 1601, 1697, 1747, 1801, 1889, 1979, 1999, 2063, 2207, 2371, 2503, 2539, 2693, 2741,
  2753, 2801, 2819, 2837, 2909, 2939, 3169, 3389, 3571, 3761, 3881, 4217, 4289, 4547, 4729, 4789, 4877, 4943, 4951,
  4957, 5393, 5417, 5419, 5441, 5519, 5527, 5647, 5779, 5881, 6007, 6089, 6133, 6389, 6451, 6469, 6547, 6661, 6719,
  6841, 7103, 7549, 7559, 7573, 7691, 7753, 7867, 8053, 8081, 8221, 8329, 8599, 8677, 8761, 8839, 8963, 9103, 9199,
  9343, 9467, 9551, 9601, 9739, 9749, 9859,
]

interface FactoriOsState extends SolverState {
  type: "factoriOs"
  primeIdx: number
  product: number
  phase: "prime" | "power"
  currentPower: number
  nextPower: number
  length: number
  finalDispatched: boolean
  needsRecheck: boolean
  /** Probe with 0 first; game reports bogus "divisible" (password % 0 is NaN). */
  probedZero: boolean
  /** After small primes, continue with largePrimes when product is still too short. */
  largePhase: boolean
}

function factoriOsPrimeList(state: FactoriOsState): readonly number[] {
  return state.largePhase ? FACTORIOS_LARGE_PRIMES : FACTORIOS_PRIMES
}

function factoriOsPrimeAt(state: FactoriOsState): number {
  return factoriOsPrimeList(state)[state.primeIdx]!
}

function factoriOsExhaustPrimeSearch(state: FactoriOsState): void {
  state.primeIdx = factoriOsPrimeList(state).length
}

const factoriOs: SolverModule<FactoriOsState> = {
  init(details) {
    return {
      type: "factoriOs",
      primeIdx: 0, product: 1,
      phase: "prime", currentPower: 0, nextPower: 0,
      length: details.passwordLength, finalDispatched: false,
      needsRecheck: false,
      probedZero: false,
      largePhase: false,
    }
  },
  nextGuess(state) {
    if (state.finalDispatched) return null
    if (!state.probedZero) {
      return { guess: "0", detail: "factoriOs discard" }
    }

    for (;;) {
      if (state.phase === "prime" || state.needsRecheck) {
        state.needsRecheck = false
        const primes = factoriOsPrimeList(state)
        while (state.primeIdx < primes.length) {
          const p = primes[state.primeIdx]!
          const pStr = String(p)
          if (pStr.length > state.length) {
            factoriOsExhaustPrimeSearch(state)
            break
          }
          return { guess: pStr, detail: `prime ${p}` }
        }
        if (!state.largePhase && String(state.product).length < state.length) {
          state.largePhase = true
          state.primeIdx = 0
          continue
        }
        const pw = String(state.product)
        if (pw.length !== state.length) return null
        return { guess: pw, detail: "factor product" }
      }

      if (String(state.nextPower).length <= state.length) {
        return { guess: String(state.nextPower), detail: `pow ${state.nextPower}` }
      }
      state.product *= state.currentPower
      if (String(state.product).length > state.length) return null
      state.phase = "prime"
      state.primeIdx++
      state.needsRecheck = true
    }
  },
  applyResult(state, guess, result) {
    if (result.success) return state

    // Divisor 0 always bogus; discard even if feedback says "true" or guess was lost on timeout.
    if (guess === "0" || guess === "") {
      if (!state.probedZero) state.probedZero = true
      return state
    }

    if (guess === String(state.product) && String(state.product).length === state.length) {
      state.finalDispatched = true
      return state
    }

    if (state.phase === "prime") {
      const fb = parseBoolFeedback(result.feedback)
      if (fb === null) return state // unparseable — retry same guess
      if (fb) {
        // Prime divides — enter power phase
        const p = Number(guess)
        state.currentPower = p
        state.nextPower = p * p
        state.phase = "power"
      } else {
        // Prime doesn't divide — advance
        state.primeIdx++
      }
    } else {
      // Power phase
      const fb = parseBoolFeedback(result.feedback)
      if (fb === null) return state // unparseable — retry same guess
      if (fb) {
        // This power divides — accumulate and try next
        state.currentPower = state.nextPower
        state.nextPower = state.currentPower * factoriOsPrimeAt(state)
      } else {
        // Power doesn't divide — done with this prime
        state.product *= state.currentPower
        if (String(state.product).length > state.length) {
          factoriOsExhaustPrimeSearch(state)
          return state
        }
        state.phase = "prime"
        state.primeIdx++
      }
    }
    return state
  },
}

// #endregion

// #region KingOfTheHill

const kingOfTheHill = kingOfTheHillImprovedSolver

// #endregion

// #region RateMyPix.Auth

const MAX_RATEMYPIX_PERM = 100_000

/** Count hot-pepper glyphs in RateMyPix feedback (e.g. "🌶️🌶️/6" or "0/6"). */
function rateMyPixPepperCount(feedback: string): number {
  const head = feedback.split("/")[0]?.trim() ?? ""
  if (!head || head === "0") return 0
  let count = 0
  for (const ch of head) {
    if (ch.codePointAt(0) === 0x1f336) count++
  }
  return count
}

function rateMyPixCharset(format: string): string {
  if (format === "alphabetic") return "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  if (format === "alphanumeric" || format === "ASCII") return "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  return "0123456789"
}

/** Charset char with zero freq-phase hits — safe filler for placement probes. */
function rateMyPixPickFiller(charset: string, freq: Record<string, number>): string {
  for (const ch of charset) {
    if (!freq[ch]) return ch
  }
  return charset[0]!
}

function rateMyPixNormalizeFreq(state: RateMyPixState): void {
  let total = Object.values(state.freq).reduce((a, b) => a + b, 0)
  if (total > state.length) {
    const entries = Object.entries(state.freq).sort((a, b) => b[1] - a[1])
    let excess = total - state.length
    for (const [ch, cnt] of entries) {
      if (excess <= 0) break
      const drop = Math.min(excess, cnt)
      const next = cnt - drop
      if (next <= 0) delete state.freq[ch]
      else state.freq[ch] = next
      excess -= drop
    }
    total = state.length
  }
  if (total < state.length) {
    let remaining = state.length - total
    for (const ch of state.charset) {
      if (remaining <= 0) break
      if (state.freq[ch]) continue
      state.freq[ch] = 1
      remaining--
    }
    if (remaining > 0) {
      const known = Object.keys(state.freq)[0] ?? state.charset[0]!
      state.freq[known] = (state.freq[known] ?? 0) + remaining
    }
  }
}

function rateMyPixFreqToMultiset(freq: Record<string, number>, length: number): { chars: string[]; counts: number[] } {
  const digits: string[] = []
  for (const [ch, cnt] of Object.entries(freq)) {
    for (let i = 0; i < cnt; i++) digits.push(ch)
  }
  while (digits.length < length) digits.push(Object.keys(freq)[0] ?? "0")
  return sortedCharsToMultiset(digits.slice(0, length).sort())
}

function rateMyPixSecretAt(state: RateMyPixState, index: number): string {
  return multisetPermutationAt(state.permChars, state.permCounts, index)!
}

function rateMyPixExactMatchCount(secret: string, guess: string): number {
  let matches = 0
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) matches++
  }
  return matches
}

function rateMyPixSolvedCount(state: RateMyPixState): number {
  let n = 0
  for (const ch of state.solved) if (ch !== null) n++
  return n
}

function rateMyPixBuildPlaceGuess(
  state: RateMyPixState,
  probeChar: string,
  probeOn: ReadonlySet<number>,
): string {
  const out: string[] = []
  for (let i = 0; i < state.length; i++) {
    const fixed = state.solved[i]
    if (fixed !== null) out.push(fixed)
    else if (probeOn.has(i)) out.push(probeChar)
    else out.push(state.filler)
  }
  return out.join("")
}

interface RateMyPixPlaceTask {
  char: string
  need: number
  pool: number[]
}

interface RateMyPixPlacePending {
  char: string
  need: number
  left: number[]
  right: number[]
  baseline: number
}

function rateMyPixEnterPlacePhase(state: RateMyPixState): void {
  state.phase = "place"
  state.filler = rateMyPixPickFiller(state.charset, state.freq)
  state.solved = Array.from({ length: state.length }, () => null)
  state.placeStack = []
  state.placePending = null
  state.finalDispatched = false

  const entries = Object.entries(state.freq)
    .filter(([, cnt]) => cnt > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  for (let i = entries.length - 1; i >= 0; i--) {
    const [ch, count] = entries[i]!
    state.placeStack.push({ char: ch, need: count, pool: [] })
  }
}

function rateMyPixFinishFreqPhase(state: RateMyPixState): boolean {
  rateMyPixNormalizeFreq(state)
  const { chars, counts } = rateMyPixFreqToMultiset(state.freq, state.length)
  state.permChars = chars
  state.permCounts = counts
  state.permTotal = multisetPermutationCount(counts)
  state.filler = rateMyPixPickFiller(state.charset, state.freq)
  if (state.permTotal <= 0) return false

  if (state.permTotal <= MAX_RATEMYPIX_PERM) {
    state.phase = "perm"
    state.survivors = mastermindSurvivorsAll()
    state.solved = []
    state.placeStack = []
    state.placePending = null
    state.finalDispatched = false
    return true
  }

  rateMyPixEnterPlacePhase(state)
  return true
}

function rateMyPixPlaceEnsurePool(state: RateMyPixState, task: RateMyPixPlaceTask): void {
  if (task.pool.length > 0) return
  for (let i = 0; i < state.length; i++) {
    if (state.solved[i] === null) task.pool.push(i)
  }
}

/** Resolve finished placement tasks without a network round-trip. */
function rateMyPixPlaceResolve(state: RateMyPixState): void {
  while (state.placeStack.length > 0) {
    const task = state.placeStack[state.placeStack.length - 1]!
    rateMyPixPlaceEnsurePool(state, task)
    if (task.need <= 0 || task.pool.length === 0) {
      state.placeStack.pop()
      continue
    }
    if (task.need === task.pool.length) {
      for (const i of task.pool) state.solved[i] = task.char
      state.placeStack.pop()
      continue
    }
    if (task.need === 1 && task.pool.length === 1) {
      state.solved[task.pool[0]!] = task.char
      state.placeStack.pop()
      continue
    }
    break
  }
}

function rateMyPixPlaceNextGuess(state: RateMyPixState): { guess: string; detail: string } | null {
  if (state.finalDispatched) return null

  rateMyPixPlaceResolve(state)

  if (state.solved.every((ch) => ch !== null)) {
    return { guess: state.solved.join(""), detail: "place final" }
  }

  if (state.placePending) {
    const pending = state.placePending
    const guess = rateMyPixBuildPlaceGuess(state, pending.char, new Set(pending.left))
    return {
      guess,
      detail: `place ${pending.char} ${pending.need}/${pending.left.length + pending.right.length}`,
    }
  }

  const task = state.placeStack[state.placeStack.length - 1]
  if (!task) return null

  rateMyPixPlaceEnsurePool(state, task)
  const mid = Math.ceil(task.pool.length / 2)
  const left = task.pool.slice(0, mid)
  const right = task.pool.slice(mid)

  state.placePending = {
    char: task.char,
    need: task.need,
    left,
    right,
    baseline: rateMyPixSolvedCount(state),
  }

  const guess = rateMyPixBuildPlaceGuess(state, task.char, new Set(left))
  return {
    guess,
    detail: `place ${task.char} ${task.need}/${task.pool.length}`,
  }
}

interface RateMyPixState extends SolverState {
  type: "rateMyPix"
  charset: string
  charIdx: number
  freq: Record<string, number>
  phase: "freq" | "perm" | "place"
  permChars: string[]
  permCounts: number[]
  permTotal: number
  survivors: MastermindSurvivors
  length: number
  retries: number   // retry count for unparseable feedback in freq phase
  filler: string
  solved: (string | null)[]
  placeStack: RateMyPixPlaceTask[]
  placePending: RateMyPixPlacePending | null
  finalDispatched: boolean
}

const rateMyPix: SolverModule<RateMyPixState> = {
  init(details) {
    return {
      type: "rateMyPix",
      charset: rateMyPixCharset(details.passwordFormat),
      charIdx: 0, freq: {}, phase: "freq",
      permChars: [], permCounts: [], permTotal: 0,
      survivors: mastermindSurvivorsAll(),
      length: details.passwordLength,
      retries: 0,
      filler: "",
      solved: [],
      placeStack: [],
      placePending: null,
      finalDispatched: false,
    }
  },
  nextGuess(state) {
    if (state.phase === "freq") {
      if (state.charIdx < state.charset.length) {
        const ch = state.charset[state.charIdx]!
        return { guess: ch.repeat(state.length), detail: `freq ${ch}` }
      }
      if (!rateMyPixFinishFreqPhase(state)) return null
    }

    if (state.phase === "place") {
      return rateMyPixPlaceNextGuess(state)
    }

    const count = mastermindSurvivorCount(state.survivors, state.permTotal)
    if (count === 0) return null
    const guess = pickMastermindGuessIndexed(
      state.survivors,
      state.permTotal,
      (index) => rateMyPixSecretAt(state, index),
    )
    return { guess, detail: `${count} cand` }
  },
  applyResult(state, guess, result) {
    if (result.success) return state

    if (state.phase === "freq") {
      const fb = result.feedback ?? ""
      if (!fb) {
        // Heartbleed missed — retry up to 3 times, then advance anyway
        state.retries++
        if (state.retries > 3) { state.retries = 0; state.charIdx++ }
        return state
      }
      state.retries = 0
      const emojiCount = rateMyPixPepperCount(fb)
      if (emojiCount > 0) state.freq[guess[0]!] = emojiCount
      state.charIdx++
      if (state.charIdx >= state.charset.length) rateMyPixNormalizeFreq(state)
      return state
    }

    if (state.phase === "place") {
      const fb = result.feedback ?? ""
      if (!fb || !state.placePending) return state
      const pending = state.placePending
      state.placePending = null
      if (state.placeStack.length > 0) state.placeStack.pop()

      const peppers = rateMyPixPepperCount(fb)
      let leftCount = peppers - pending.baseline
      if (!Number.isFinite(leftCount)) leftCount = 0
      leftCount = Math.max(0, Math.min(leftCount, pending.need, pending.left.length))
      const rightCount = pending.need - leftCount

      if (rightCount > 0) {
        state.placeStack.push({
          char: pending.char,
          need: rightCount,
          pool: [...pending.right],
        })
      }
      if (leftCount > 0) {
        state.placeStack.push({
          char: pending.char,
          need: leftCount,
          pool: [...pending.left],
        })
      }
      if (state.solved.every((ch) => ch !== null) && guess === state.solved.join("")) {
        state.finalDispatched = true
      }
      return state
    }

    // Perm phase: prune by exact-position match count (pepper count)
    const fb = result.feedback ?? ""
    if (!fb) return state
    const pruneCount = rateMyPixPepperCount(fb)
    state.survivors = filterMastermindSurvivors(
      state.survivors,
      state.permTotal,
      (index) => {
        const secret = rateMyPixSecretAt(state, index)
        if (secret === guess) return false
        return rateMyPixExactMatchCount(secret, guess) === pruneCount
      },
    )
    return state
  },
}

// #endregion

// #region TimingAttack (2G_cellular)


interface TimingAttackState extends SolverState {
  type: "timingAttack"
  chars: (string | null)[]
  charset: string
  pos: number
  charIdx: number
  length: number
  finalDispatched: boolean
}

const timingAttack: SolverModule<TimingAttackState> = {
  init(details) {
    const charset =
      details.passwordFormat === "alphabetic" ? "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
      : details.passwordFormat === "alphanumeric" ? "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
      : "0123456789"
    return {
      type: "timingAttack",
      chars: Array.from({ length: details.passwordLength }, () => null),
      charset, pos: 0, charIdx: 0, length: details.passwordLength, finalDispatched: false,
    }
  },
  nextGuess(state) {
    if (state.finalDispatched) return null
    while (state.pos < state.length) {
      if (state.charIdx >= state.charset.length) {
        // Failed to find char at this position
        return null
      }
      const ch = state.charset[state.charIdx]!
      // Build guess: known chars + candidate + padding for rest
      let guess = ""
      for (let j = 0; j < state.length; j++) {
        if (j < state.pos) guess += state.chars[j]!
        else if (j === state.pos) guess += ch
        else guess += state.charset[0]!
      }
      return { guess, detail: `pos ${state.pos} try ${ch}` }
    }
    return { guess: state.chars.join(""), detail: "final" }
  },
  applyResult(state, guess, result) {
    if (result.success) return state
    if (state.pos >= state.length) {
      state.finalDispatched = true
      return state
    }
    if (state.finalDispatched) return state

    const msg = result.message ?? ""
    if (!msg) return state
    const match = msg.match(/Found a mismatch while checking each character \((\d+)\)/)
    if (!match) return state
    const mismatchIdx = Number(match[1])

    if (mismatchIdx !== state.pos) {
      // Mismatch at later position => current char is correct
      state.chars[state.pos] = state.charset[state.charIdx]!
      state.pos++
      state.charIdx = 0
    } else {
      // Mismatch at current position => try next char
      state.charIdx++
    }
    return state
  },
}

// #endregion

// #region OpenWebAccessPoint (packetSniffer)

//
// Two difficulty levels from game source:
//   Difficulty <= 16: password embedded as " hostname:password " in varied noise
//   Difficulty > 16:  raw password embedded in getPassword(124..144, true) — pure alphanumeric noise
//
// Strategy:
//   1. Send hostname as guess -> get feedback data (the "packet capture")
//   2. Try "hostname:password" regex first (easy variant)
//   3. Hard variant: collect multiple captures from wrong guesses, intersect length-N substrings
//      (password appears verbatim once per capture). Prefer substrings that appear once per capture;
//      if still ambiguous after max captures, iterate remaining candidates or fall back to single-capture scan.

const OPEN_WEB_MAX_CAPTURES = 5

function openWebCharset(format: string): string {
  switch (format) {
    case "numeric": return "0123456789"
    case "alphabetic": return "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    case "alphanumeric": return "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    default: return "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  }
}

function openWebSubstringsOfLength(s: string, len: number): Set<string> {
  const out = new Set<string>()
  if (s.length < len) return out
  for (let i = 0; i <= s.length - len; i++) out.add(s.slice(i, i + len))
  return out
}

function openWebCountOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let idx = 0
  while (true) {
    const found = haystack.indexOf(needle, idx)
    if (found === -1) break
    count++
    idx = found + 1
  }
  return count
}

function openWebSharedSubstrings(captures: string[], pwLen: number): string[] {
  if (captures.length === 0) return []
  let shared = openWebSubstringsOfLength(captures[0]!, pwLen)
  for (let i = 1; i < captures.length; i++) {
    const subs = openWebSubstringsOfLength(captures[i]!, pwLen)
    shared = new Set([...shared].filter((c) => subs.has(c)))
  }
  return [...shared]
}

function openWebFallbackCandidates(capture: string, pwLen: number): string[] {
  return [...openWebSubstringsOfLength(capture, pwLen)].sort()
}

function openWebRefreshCandidates(
  captures: string[],
  pwLen: number,
  exclude: ReadonlySet<string>,
): string[] {
  if (captures.length < 2) return []
  const shared = openWebSharedSubstrings(captures, pwLen).filter((c) => !exclude.has(c))
  const uniqueOnce = shared.filter((c) => captures.every((cap) => openWebCountOccurrences(cap, c) === 1))
  const candidates = uniqueOnce.length > 0 ? uniqueOnce : shared
  return candidates.sort()
}

function openWebRandomWrongGuess(charset: string, len: number, avoid: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    let guess = ""
    for (let i = 0; i < len; i++) {
      guess += charset[Math.floor(Math.random() * charset.length)]!
    }
    if (!avoid.has(guess)) return guess
  }
  for (const ch of charset) {
    const guess = ch.repeat(len)
    if (!avoid.has(guess)) return guess
  }
  return charset[0]!.repeat(len)
}

interface OpenWebAccessPointState extends SolverState {
  type: "openWebAccessPoint"
  phase: "probe" | "easySubmit" | "collect" | "iterate"
  extractedPassword: string | null
  pwLen: number
  charset: string
  captures: string[]
  candidates: string[]
  candidateIdx: number
  triedGuesses: string[]
  maxCaptures: number
}

function openWebExcludeGuesses(state: OpenWebAccessPointState): Set<string> {
  return new Set(state.triedGuesses)
}

function openWebAfterCapture(state: OpenWebAccessPointState): OpenWebAccessPointState {
  if (state.captures.length < 2) return state

  state.candidates = openWebRefreshCandidates(state.captures, state.pwLen, openWebExcludeGuesses(state))
  if (state.candidates.length === 1) {
    state.extractedPassword = state.candidates[0]!
    state.phase = "easySubmit"
    return state
  }
  if (state.candidates.length > 1 && state.captures.length >= state.maxCaptures) {
    state.phase = "iterate"
    state.candidateIdx = 0
    return state
  }
  if (state.candidates.length === 0 && state.captures.length >= state.maxCaptures) {
    state.candidates = openWebFallbackCandidates(state.captures[0]!, state.pwLen)
      .filter((c) => !openWebExcludeGuesses(state).has(c))
    state.phase = "iterate"
    state.candidateIdx = 0
  }
  return state
}

const openWebAccessPoint: SolverModule<OpenWebAccessPointState> = {
  init(details) {
    return {
      type: "openWebAccessPoint", phase: "probe",
      extractedPassword: null, pwLen: details.passwordLength,
      charset: openWebCharset(details.passwordFormat),
      captures: [], candidates: [], candidateIdx: 0,
      triedGuesses: [], maxCaptures: OPEN_WEB_MAX_CAPTURES,
    }
  },
  nextGuess(state, context) {
    if (state.phase === "probe") {
      return { guess: context.target, detail: `probe ${context.target}` }
    }
    if (state.phase === "easySubmit" && state.extractedPassword) {
      return { guess: state.extractedPassword, detail: "submit" }
    }
    if (state.phase === "collect") {
      if (state.captures.length >= state.maxCaptures) return null
      const avoid = new Set([context.target, ...state.triedGuesses])
      const guess = openWebRandomWrongGuess(state.charset, state.pwLen, avoid)
      return {
        guess,
        detail: `collect ${state.captures.length + 1}/${state.maxCaptures}`,
      }
    }
    if (state.phase === "iterate") {
      if (state.candidateIdx < state.candidates.length) {
        const guess = state.candidates[state.candidateIdx]!
        return { guess, detail: `cand ${state.candidateIdx + 1}/${state.candidates.length}` }
      }
    }
    return null
  },
  applyResult(state, guess, result) {
    if (result.success) return state

    if (state.phase === "probe") {
      const fb = result.feedback ?? ""
      if (!fb) return state // no feedback — retry probe
      state.triedGuesses.push(guess)

      // Try easy variant: "hostname:password" embedded
      const escapedHost = guess.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const regex = new RegExp(escapedHost + `:(\\S+)`)
      const m = fb.match(regex)
      if (m) {
        state.extractedPassword = m[1]!
        state.phase = "easySubmit"
        return state
      }

      // Hard variant: gather more captures, then intersect substrings of password length.
      state.captures.push(fb)
      state.phase = "collect"
      return state
    }

    if (state.phase === "collect") {
      const fb = result.feedback ?? ""
      if (!fb) return state
      state.triedGuesses.push(guess)
      state.captures.push(fb)
      return openWebAfterCapture(state)
    }

    if (state.phase === "iterate") {
      state.candidateIdx++
    }

    return state
  },
}

// #endregion

// #region BigMo%od (triple modulo)

// #region BigMo helpers

function crtCombineBigInt(r1: bigint, m1: bigint, r2: bigint, m2: bigint): { r: bigint; m: bigint } | null {
  let a = m1
  let b = m2
  let s0 = 1n
  let s1 = 0n
  while (b !== 0n) {
    const q = a / b
    ;[a, b] = [b, a - q * b]
    ;[s0, s1] = [s1, s0 - q * s1]
  }
  const g = a
  if ((r2 - r1) % g !== 0n) return null
  const lcm = (m1 / g) * m2
  const x = (r1 + ((r2 - r1) / g) * s0 * m1) % lcm
  return { r: ((x % lcm) + lcm) % lcm, m: lcm }
}

function bigMoPasswordFromProbes(
  resolved: { d: number; r: number }[],
  pwMin: number,
  pwMax: number,
  length: number,
): string | null {
  if (resolved.length === 0) return null
  let r = BigInt(resolved[0]!.r)
  let m = BigInt(resolved[0]!.d)
  for (let i = 1; i < resolved.length; i++) {
    const combined = crtCombineBigInt(r, m, BigInt(resolved[i]!.r), BigInt(resolved[i]!.d))
    if (!combined) return null
    r = combined.r
    m = combined.m
  }
  const pwMinB = BigInt(pwMin)
  const pwMaxB = BigInt(pwMax)
  let candidate = r
  if (candidate < pwMinB) {
    const k = (pwMinB - r + m - 1n) / m
    candidate = r + k * m
  }
  if (candidate > pwMaxB) return null
  const raw = candidate.toString()
  if (raw.length > length) return null
  if (raw.length < length) return raw.padStart(length, "0")
  return raw
}

// #endregion

//
// Game formula: (password % n) % (((n - 1) % 32) + 1)
// Probe with n > password so feedback equals password % d for d = ((n-1)%32)+1.
// CRT over those remainders recovers the password. Use BigInt — Number CRT overflows
// once the product of moduli exceeds ~2^53 (length 7 needs product ~2e11).

// Primes usable as inner modulus d = ((n-1)%32)+1 (each ≤ 31)
const BIGMO_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31]

/** Smallest prefix of BIGMO_PRIMES whose product covers the password range. */
function bigMoPrimeModuliForLength(len: number): number[] {
  const span = 10 ** len - 10 ** (len - 1) + 1
  const moduli: number[] = []
  let product = 1
  for (const p of BIGMO_PRIMES) {
    moduli.push(p)
    product *= p
    if (product >= span) break
  }
  return moduli
}

function bigMoProbeN(pwMax: number, d: number): number {
  const target = d % 32
  let n = pwMax + 1
  while (n % 32 !== target) n++
  return n
}

interface BigMoState extends SolverState {
  type: "bigMo"
  phase: "probe" | "solve"
  probes: { n: number; d: number; r: number | null }[]
  probeIdx: number
  finalDispatched: boolean
  pwMin: number
  pwMax: number
  length: number
}

const bigMoSolver: SolverModule<BigMoState> = {
  init(details) {
    const len = details.passwordLength
    const pwMin = 10 ** (len - 1)
    const pwMax = 10 ** len - 1
    const probes: { n: number; d: number; r: number | null }[] = []
    for (const d of bigMoPrimeModuliForLength(len)) {
      probes.push({ n: bigMoProbeN(pwMax, d), d, r: null })
    }
    return {
      type: "bigMo",
      phase: probes.length > 0 ? "probe" : "solve",
      probes, probeIdx: 0, finalDispatched: false,
      pwMin, pwMax, length: len,
    }
  },
  nextGuess(state) {
    if (state.finalDispatched) return null
    if (state.phase === "probe") {
      if (state.probeIdx < state.probes.length) {
        const p = state.probes[state.probeIdx]!
        return { guess: String(p.n), detail: `bigMo d=${p.d}` }
      }
    }
    if (state.phase === "solve") {
      const resolved = state.probes.filter((p) => p.r !== null) as { d: number; r: number }[]
      if (resolved.length === 0) return null
      const padded = bigMoPasswordFromProbes(resolved, state.pwMin, state.pwMax, state.length)
      if (!padded) return null
      return { guess: padded, detail: "bigMo CRT" }
    }
    return null
  },
  applyResult(state, guess, result) {
    if (result.success) return state
    if (state.phase === "probe" && state.probeIdx < state.probes.length) {
      const fb = typeof result.feedback === "string" ? Number(result.feedback) : NaN
      if (Number.isFinite(fb) && fb >= 0) {
        state.probes[state.probeIdx]!.r = fb
      }
      state.probeIdx++
      if (state.probeIdx >= state.probes.length) state.phase = "solve"
      return state
    }
    if (state.phase === "solve") {
      state.finalDispatched = true
    }
    return state
  },
}

// #endregion

// #region Solver registry

export const SOLVER_MODULES: Record<string, SolverModule> = {
  'ZeroLogon|numeric': zeroLogon, 'ZeroLogon|alphabetic': zeroLogon,
  'ZeroLogon|alphanumeric': zeroLogon, 'ZeroLogon|ASCII': zeroLogon,
  'CloudBlare(tm)|numeric': cloudBlare,
  'DeskMemo_3.1|numeric': deskMemo,
  'BellaCuore|numeric': bellaCuoreSingle,
  'BellaCuore|numeric|range': bellaCuoreRange,
  'OctantVoxel|numeric': octantVoxel,
  'MathML|ASCII': mathML, 'MathML|numeric': mathML, 'MathML|alphabetic': mathML, 'MathML|alphanumeric': mathML,
  'PrimeTime 2|numeric': primeTime2,
  'BigMo%od|numeric': bigMoSolver,
  '110100100|alphanumeric': binaryToText, '110100100|alphabetic': binaryToText, '110100100|ASCII': binaryToText,
  'OrdoXenos|alphanumeric': ordoXenos, 'OrdoXenos|alphabetic': ordoXenos, 'OrdoXenos|ASCII': ordoXenos,
  'Pr0verFl0|numeric': proverFlo, 'Pr0verFl0|alphabetic': proverFlo, 'Pr0verFl0|alphanumeric': proverFlo, 'Pr0verFl0|ASCII': proverFlo,
  'Laika4|alphabetic': laika4,
  'PHP 5.4|numeric': php54,
  'EuroZone Free|ASCII': euroZone, 'EuroZone Free|alphabetic': euroZone,
  'TopPass|numeric': topPass, 'TopPass|alphabetic': topPass, 'TopPass|alphanumeric': topPass, 'TopPass|ASCII': topPass,
  'FreshInstall_1.0|numeric': freshInstall,
  'FreshInstall_1.0|alphabetic': freshInstall, 'FreshInstall_1.0|alphanumeric': freshInstall, 'FreshInstall_1.0|ASCII': freshInstall,
  'NIL|numeric': nilSolver, 'NIL|alphabetic': nilSolver, 'NIL|alphanumeric': nilSolver,
  'AccountsManager_4.2|numeric': accountsManager,
  'DeepGreen|numeric': deepGreen, 'DeepGreen|alphabetic': deepGreen, 'DeepGreen|alphanumeric': deepGreen, 'DeepGreen|ASCII': deepGreen,
  'Factori-Os|numeric': factoriOs,
  'KingOfTheHill|numeric': kingOfTheHill,
  'RateMyPix.Auth|numeric': rateMyPix, 'RateMyPix.Auth|alphabetic': rateMyPix, 'RateMyPix.Auth|alphanumeric': rateMyPix, 'RateMyPix.Auth|ASCII': rateMyPix,
  '2G_cellular|numeric': timingAttack, '2G_cellular|alphabetic': timingAttack, '2G_cellular|alphanumeric': timingAttack,
  'OpenWebAccessPoint|numeric': openWebAccessPoint, 'OpenWebAccessPoint|alphabetic': openWebAccessPoint,
  'OpenWebAccessPoint|alphanumeric': openWebAccessPoint, 'OpenWebAccessPoint|ASCII': openWebAccessPoint,
}

export { bellaCuoreRange }

// #endregion
