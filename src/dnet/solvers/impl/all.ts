import type { ServerDetails } from '../../types.js'
import type { SolverModule, SolverState } from '../types.js'
import {
  romanToDecimal,
  mastermindCharset,
  mastermindFeedback,
  parseMastermindFeedback,
  parseBoolFeedback,
  bigMoPasswordFromProbes,
} from '../helpers.js'
import { COMMON_PASSWORDS, DEFAULT_FACTORY_PASSWORDS } from '../data/commonPasswords.js'

// --- ZeroLogon ---

interface ZeroLogonState extends SolverState { type: "zeroLogon"; dispatched: boolean }

const zeroLogon: SolverModule<ZeroLogonState> = {
  init(details) {
    return { type: "zeroLogon", dispatched: details.passwordLength !== 0 }
  },
  nextGuess(state) {
    if (state.dispatched) return null
    state.dispatched = true
    return { guess: "", detail: "zeroLogon" }
  },
  applyResult(state, _guess, _result) { return state },
}

// --- CloudBlare(tm) ---

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
    state.dispatched = true
    return { guess: state.guess, detail: "cloudBlare" }
  },
  applyResult(state, _guess, _result) { return state },
}

// --- DeskMemo_3.1 ---

interface DeskMemoState extends SolverState { type: "deskMemo"; dispatched: boolean; guess: string | null }

const deskMemo: SolverModule<DeskMemoState> = {
  init(details) {
    const numerals = details.passwordHint.replace(/\D/g, "")
    if (numerals.length !== details.passwordLength) return { type: "deskMemo", dispatched: true, guess: null }
    return { type: "deskMemo", dispatched: false, guess: numerals }
  },
  nextGuess(state) {
    if (state.dispatched || !state.guess) return null
    state.dispatched = true
    return { guess: state.guess, detail: "deskMemo" }
  },
  applyResult(state, _guess, _result) { return state },
}

// --- BellaCuore single-value ---

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
    state.dispatched = true
    return { guess: state.guess, detail: "bellaCuore" }
  },
  applyResult(state, _guess, _result) { return state },
}

// --- OctantVoxel (base-N conversion, including fractional bases like 15.1) ---

interface OctantVoxelState extends SolverState { type: "octantVoxel"; dispatched: boolean; guess: string | null }

const OCTANT_VOXEL_DIGITS = "0123456789abcdef"

function octantVoxelDigitValue(ch: string): number | null {
  const idx = OCTANT_VOXEL_DIGITS.indexOf(ch.toLowerCase())
  return idx >= 0 ? idx : null
}

function parseBaseNToDecimal(base: number, numberStr: string): number | null {
  const maxDigit = Math.ceil(base) - 1
  const dotIdx = numberStr.indexOf(".")
  const intPart = dotIdx >= 0 ? numberStr.slice(0, dotIdx) : numberStr
  const fracPart = dotIdx >= 0 ? numberStr.slice(dotIdx + 1) : ""

  let value = 0

  // Integer part (positions ≥ 0)
  for (let i = 0; i < intPart.length; i++) {
    const dv = octantVoxelDigitValue(intPart[intPart.length - 1 - i]!)
    if (dv === null || dv > maxDigit) return null
    value += dv * base ** i
  }

  // Fractional part (positions < 0)
  for (let i = 0; i < fracPart.length; i++) {
    const dv = octantVoxelDigitValue(fracPart[i]!)
    if (dv === null || dv > maxDigit) return null
    value += dv * base ** -(i + 1)
  }

  return value
}

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
    state.dispatched = true
    return { guess: state.guess, detail: "octantVoxel" }
  },
  applyResult(state, _guess, _result) { return state },
}

// --- MathML ---
//
// Game uses parseSimpleArithmeticExpression (not eval). Data may include unicode
// operators and a comma-suffix code-injection trap; only the part before "," counts.

function cleanArithmeticExpression(expression: string): string {
  return expression
    .replaceAll("\u04B3", "*").replaceAll("\u0445", "*")
    .replaceAll("\u00F7", "/").replaceAll("\u2796", "-")
    .replaceAll("\u2795", "+").replaceAll("\u2212", "-")
    .replaceAll("\u00D7", "*").replaceAll("\u00B7", "*").replaceAll("\u2217", "*")
    .replaceAll("ns.exit(),", "")
    .split(",")[0]!
}

/** Mirrors bitburner-src ServerGenerator.parseSimpleArithmeticExpression. */
function parseSimpleArithmeticExpression(expression: string): number {
  const tokens = cleanArithmeticExpression(expression).split("")

  let currentDepth = 0
  const depth = tokens.map((token) => {
    if (token === "(") {
      currentDepth += 1
    } else if (token === ")") {
      currentDepth -= 1
      return currentDepth + 1
    }
    return currentDepth
  })
  const depth1Start = depth.indexOf(1)
  const firstZeroAfterDepth1Start = depth.indexOf(0, depth1Start)
  const depth1End = firstZeroAfterDepth1Start === -1 ? depth.length - 1 : firstZeroAfterDepth1Start - 1
  if (depth1Start !== -1) {
    const subExpression = tokens.slice(depth1Start + 1, depth1End).join("")
    const result = parseSimpleArithmeticExpression(subExpression)
    tokens.splice(depth1Start, depth1End - depth1Start + 1, result.toString())
    return parseSimpleArithmeticExpression(tokens.join(""))
  }

  let remainingExpression = tokens.join("")
  const multiplicationDivisionRegex = /(-?\d*\.?\d+) *([*/]) *(-?\d*\.?\d+)/
  let match = remainingExpression.match(multiplicationDivisionRegex)
  while (match) {
    const left = match[1]!
    const operator = match[2]!
    const right = match[3]!
    const result = operator === "*"
      ? parseFloat(left) * parseFloat(right)
      : parseFloat(left) / parseFloat(right)
    const resultString = Math.abs(result) < 0.000001 ? result.toFixed(20) : result.toString()
    remainingExpression = remainingExpression.replace(match[0], resultString)
    match = remainingExpression.match(multiplicationDivisionRegex)
  }

  const additionSubtractionRegex = /(-?\d*\.?\d+) *([+-]) *(-?\d*\.?\d+)/
  match = remainingExpression.match(additionSubtractionRegex)
  while (match) {
    const left = match[1]!
    const operator = match[2]!
    const right = match[3]!
    const result = operator === "+"
      ? parseFloat(left) + parseFloat(right)
      : parseFloat(left) - parseFloat(right)
    remainingExpression = remainingExpression.replace(match[0], result.toString())
    match = remainingExpression.match(additionSubtractionRegex)
  }

  const leftover = remainingExpression.match(/(-?\d*\.?\d+)/)
  return parseFloat(leftover?.[1] ?? "NaN")
}

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
    state.dispatched = true
    return { guess: state.guess, detail: "mathML" }
  },
  applyResult(state, _guess, _result) { return state },
}

// --- PrimeTime 2 ---

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
    while (state.factorIdx < state.factors.length) {
      const guess = state.factors[state.factorIdx]!
      state.factorIdx++
      return { guess, detail: `primeTime2` }
    }
    state.dispatched = true
    return null
  },
  applyResult(state, _guess, result) {
    if (result.success) { state.dispatched = true }
    // On failure, nextGuess will try the next factor
    return state
  },
}

// --- 110100100 (binary-to-text) ---

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
    state.dispatched = true
    return { guess: state.guess, detail: "110100100" }
  },
  applyResult(state, _guess, _result) { return state },
}

// --- OrdoXenos (XOR decryption) ---

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
    state.dispatched = true
    return { guess: state.guess, detail: "ordoXenos" }
  },
  applyResult(state, _guess, _result) { return state },
}

// --- Pr0verFl0 (buffer overflow) ---

interface ProverFloState extends SolverState { type: "proverFlo"; dispatched: boolean; guess: string | null }

const proverFlo: SolverModule<ProverFloState> = {
  init(details) {
    const half = "0".repeat(details.passwordLength)
    return { type: "proverFlo", dispatched: false, guess: half + half }
  },
  nextGuess(state) {
    if (state.dispatched || !state.guess) return null
    state.dispatched = true
    return { guess: state.guess, detail: "proverFlo" }
  },
  applyResult(state, _guess, _result) { return state },
}

// ============================================================
// Candidate-list solvers
// ============================================================

// --- Laika4 ---

interface Laika4State extends SolverState { type: "laika4"; remaining: string[] }

const LAIKA4_DOGS = ["max", "fido", "spot", "rover"]

const laika4: SolverModule<Laika4State> = {
  init(details) {
    const candidates = LAIKA4_DOGS.filter((n) => n.length === details.passwordLength)
    return { type: "laika4", remaining: candidates }
  },
  nextGuess(state) {
    if (state.remaining.length === 0) return null
    const guess = state.remaining.pop()!
    return { guess, detail: `laika4 (${state.remaining.length + 1} left)` }
  },
  applyResult(state, _guess, result) {
    if (result.success) state.remaining = []
    return state
  },
}

// --- PHP 5.4 ---

interface Php54State extends SolverState { type: "php54"; remaining: string[] }

function php54Candidates(hint: string, length: number): string[] {
  const digits = hint.replace(/\D/g, "")
  if (digits.length !== length) return []
  const seen = new Set<string>()
  const result: string[] = []
  function permute(arr: string[], start: number) {
    if (start === arr.length) {
      const s = arr.join("")
      if (!seen.has(s)) { seen.add(s); result.push(s) }
      return
    }
    const used = new Set<string>()
    for (let i = start; i < arr.length; i++) {
      if (used.has(arr[i]!)) continue
      used.add(arr[i]!)
      ;[arr[start], arr[i]] = [arr[i]!, arr[start]!]
      permute(arr, start + 1)
      ;[arr[start], arr[i]] = [arr[i]!, arr[start]!]
    }
  }
  permute(digits.split(""), 0)
  return result
}

const php54: SolverModule<Php54State> = {
  init(details) {
    const candidates = php54Candidates(details.passwordHint, details.passwordLength)
    return { type: "php54", remaining: candidates }
  },
  nextGuess(state) {
    if (state.remaining.length === 0) return null
    const guess = state.remaining.pop()!
    return { guess, detail: `php54 (${state.remaining.length + 1} left)` }
  },
  applyResult(state, _guess, result) {
    if (result.success) state.remaining = []
    return state
  },
}

// --- EuroZone Free ---

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
    const guess = state.remaining.pop()!
    return { guess, detail: `euroZone (${state.remaining.length + 1} left)` }
  },
  applyResult(state, _guess, result) {
    if (result.success) state.remaining = []
    return state
  },
}

// --- TopPass ---

interface TopPassState extends SolverState { type: "topPass"; remaining: string[] }

const topPass: SolverModule<TopPassState> = {
  init(details) {
    const candidates = [...COMMON_PASSWORDS].filter((c) => c.length === details.passwordLength)
    return { type: "topPass", remaining: candidates }
  },
  nextGuess(state) {
    if (state.remaining.length === 0) return null
    const guess = state.remaining.pop()!
    return { guess, detail: `topPass (${state.remaining.length + 1} left)` }
  },
  applyResult(state, _guess, result) {
    if (result.success) state.remaining = []
    return state
  },
}

// --- FreshInstall_1.0 (factory default dictionary) ---

interface FreshInstallState extends SolverState { type: "freshInstall"; remaining: string[] }

const freshInstall: SolverModule<FreshInstallState> = {
  init(details) {
    const remaining = DEFAULT_FACTORY_PASSWORDS.filter((p) => p.length === details.passwordLength)
    return { type: "freshInstall", remaining: [...remaining] }
  },
  nextGuess(state) {
    if (state.remaining.length === 0) return null
    const guess = state.remaining.shift()!
    return { guess, detail: `default (${state.remaining.length} left)` }
  },
  applyResult(state, _guess, result) {
    if (result.success) state.remaining = []
    return state
  },
}

// ============================================================
// Sequential interactive solvers
// ============================================================

// --- NIL ---

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
      if (!state.finalDispatched) {
        state.finalDispatched = true
        return { guess: state.chars.join(""), detail: "NIL final" }
      }
      return null
    }
    if (state.charIdx < state.charset.length) {
      const ch = state.charset[state.charIdx]!
      return { guess: ch.repeat(state.chars.length), detail: `NIL char ${ch}` }
    }
    // Charset exhausted but some positions still null — fill with first char and dispatch
    for (let i = 0; i < state.chars.length; i++) {
      if (state.chars[i] === null) state.chars[i] = state.charset[0]!
    }
    if (!state.finalDispatched) {
      state.finalDispatched = true
      return { guess: state.chars.join(""), detail: "NIL final (fallback)" }
    }
    return null
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
    }
    return state
  },
}

// --- AccountsManager_4.2 ---

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

// --- BellaCuore range ---

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

// --- DeepGreen (Mastermind) ---

const MAX_MASTERMIND_CANDIDATES = 10000
const MINIMAX_THRESHOLD = 500

function generateMastermindCandidates(length: number, charset: string): string[] | null {
  if (length <= 0) return null
  const size = charset.length ** length
  if (size > MAX_MASTERMIND_CANDIDATES) return null
  const out: string[] = []
  const build = (prefix: string): void => {
    if (prefix.length === length) { out.push(prefix); return }
    for (let i = 0; i < charset.length; i++) { build(prefix + charset[i]) }
  }
  build("")
  return out
}

/** Generate all unique permutations of a multiset of characters. */
function multisetPermutations(chars: string[]): string[] {
  const results: string[] = []
  const sorted = [...chars].sort()
  const used = new Array(sorted.length).fill(false)

  function backtrack(current: string[]): void {
    if (current.length === sorted.length) {
      results.push(current.join(""))
      return
    }
    for (let i = 0; i < sorted.length; i++) {
      if (used[i]) continue
      if (i > 0 && sorted[i] === sorted[i - 1] && !used[i - 1]) continue
      used[i] = true
      current.push(sorted[i]!)
      backtrack(current)
      current.pop()
      used[i] = false
    }
  }
  backtrack([])
  return results
}

function pickMastermindGuess(candidates: string[]): string {
  if (candidates.length > MINIMAX_THRESHOLD) {
    return candidates[Math.floor(Math.random() * candidates.length)]!
  }
  let bestGuess = candidates[0]!
  let bestWorstBucket = candidates.length + 1
  for (const guess of candidates) {
    const buckets = new Map<string, number>()
    for (const secret of candidates) {
      const fb = mastermindFeedback(secret, guess)
      const key = `${fb.exact},${fb.misplaced}`
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
    const worstBucket = Math.max(...buckets.values())
    if (worstBucket < bestWorstBucket) {
      bestWorstBucket = worstBucket
      bestGuess = guess
    }
  }
  return bestGuess
}

interface DeepGreenState extends SolverState {
  type: "deepGreen"
  charset: string
  length: number
  // Two-phase strategy for large character spaces (>10K candidates):
  // Phase 1 — count occurrences of each charset character
  // Phase 2 — solve via permutation candidates + minimax
  charCounts: Record<string, number>
  charList: string[]
  charIdx: number
  totalCount: number
  candidates: string[]
}

const deepGreen: SolverModule<DeepGreenState> = {
  init(details) {
    const charset = mastermindCharset(details.passwordFormat)
    const initial = generateMastermindCandidates(details.passwordLength, charset)
    if (initial) {
      // Small space — direct enumeration
      return {
        type: "deepGreen", charset, length: details.passwordLength,
        charCounts: {}, charList: [], charIdx: 0,
        totalCount: details.passwordLength, candidates: initial,
      }
    }
    // Large space — phase 1: count characters
    return {
      type: "deepGreen", charset, length: details.passwordLength,
      charCounts: {}, charList: charset.split(""), charIdx: 0,
      totalCount: 0, candidates: [],
    }
  },
  nextGuess(state) {
    // Phase 2: permutation-based solving
    if (state.totalCount >= state.length) {
      if (state.candidates.length === 0) return null
      return { guess: pickMastermindGuess(state.candidates), detail: `${state.candidates.length} cand` }
    }
    // Phase 1: count occurrences of each charset character
    if (state.charIdx < state.charList.length) {
      const ch = state.charList[state.charIdx]!
      return { guess: ch.repeat(state.length), detail: `count ${ch}` }
    }
    // Exhausted charset without finding all chars — build whatever we have
    const digits: string[] = []
    for (const [c, cnt] of Object.entries(state.charCounts)) {
      for (let i = 0; i < cnt; i++) digits.push(c)
    }
    while (digits.length < state.length) digits.push(state.charset[0]!)
    state.candidates = multisetPermutations(digits.slice(0, state.length))
    state.totalCount = state.length
    return state.candidates.length > 0
      ? { guess: pickMastermindGuess(state.candidates), detail: `${state.candidates.length} cand` }
      : null
  },
  applyResult(state, guess, result) {
    if (result.success) return state

    if (state.totalCount < state.length) {
      // Phase 1: parse counting feedback
      const fbRaw = result.feedback ?? ""
      const fb = parseMastermindFeedback(fbRaw)
      if (!fb) return state // unparseable — retry same guess
      const ch = state.charList[state.charIdx]!
      // Guessing "CCCCCCC" → exact = count of C in the password
      state.charCounts[ch] = fb.exact
      state.totalCount += fb.exact
      state.charIdx++
      // Early exit if we've accounted for all positions
      if (state.totalCount >= state.length || state.charIdx >= state.charList.length) {
        const digits: string[] = []
        for (const [c, cnt] of Object.entries(state.charCounts)) {
          for (let i = 0; i < cnt; i++) digits.push(c)
        }
        while (digits.length < state.length) digits.push(state.charset[0]!)
        state.candidates = multisetPermutations(digits.slice(0, state.length))
        state.totalCount = state.length
      }
      return state
    }

    // Phase 2: filter permutation candidates
    const fbRaw = result.feedback ?? ""
    const fb = parseMastermindFeedback(fbRaw)
    if (!fb) return state
    state.candidates = state.candidates.filter((secret) => {
      const f = mastermindFeedback(secret, guess)
      return f.exact === fb.exact && f.misplaced === fb.misplaced
    })
    return state
  },
}

// --- Factori-Os ---

const FACTORIOS_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97]

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
    }
  },
  nextGuess(state) {
    if (state.finalDispatched) return null
    if (!state.probedZero) {
      return { guess: "0", detail: "factoriOs discard" }
    }
    if (state.phase === "prime" || state.needsRecheck) {
      state.needsRecheck = false
      // Find next prime that fits within length
      while (state.primeIdx < FACTORIOS_PRIMES.length) {
        const p = FACTORIOS_PRIMES[state.primeIdx]!
        const pStr = String(p)
        if (pStr.length > state.length) { state.primeIdx = FACTORIOS_PRIMES.length; break }
        return { guess: pStr, detail: `prime ${p}` }
      }
      // All primes exhausted, submit product
      const pw = String(state.product)
      if (pw.length !== state.length) return null
      state.finalDispatched = true
      return { guess: pw, detail: "factor product" }
    }

    // Power phase: test next power of the current prime
    if (String(state.nextPower).length <= state.length) {
      return { guess: String(state.nextPower), detail: `pow ${state.nextPower}` }
    }
    // Power too large — done with this prime, go back to prime phase
    state.product *= state.currentPower
    if (String(state.product).length > state.length) return null
    state.phase = "prime"
    state.primeIdx++
    state.needsRecheck = true
    return null // master calls nextGuess again, needsRecheck triggers prime check
  },
  applyResult(state, guess, result) {
    if (result.success) return state

    // Divisor 0 always bogus; discard even if feedback says "true" or guess was lost on timeout.
    if (guess === "0" || guess === "") {
      if (!state.probedZero) state.probedZero = true
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
        const base = FACTORIOS_PRIMES[state.primeIdx]!
        state.nextPower = state.currentPower * base
      } else {
        // Power doesn't divide — done with this prime
        state.product *= state.currentPower
        if (String(state.product).length > state.length) { state.primeIdx = FACTORIOS_PRIMES.length; return state }
        state.phase = "prime"
        state.primeIdx++
      }
    }
    return state
  },
}

// --- KingOfTheHill ---
//
// Multi-scale search: sweep the numeric range at descending step sizes,
// each pass zooming into ±prev_step around the best value found so far.
// The underlying function is a sum of Gaussian hills; the widest, tallest one
// sits at the password. Side hills are narrower and lower (≤7400 vs 10000)
// and vanish when |guess - pw| / pw < 0.03 (only the main hill remains).
//
// Refinement factor ≈ 8 (ceil(step / 8)) keeps probe count bounded.
// Total probes: ~50 (len ≤ 3), ~100 (len ≤ 6), ~150 (len ≤ 10).

interface KingOfTheHillState extends SolverState {
  type: "kingOfTheHill"
  min: number
  max: number
  bestVal: number
  bestAlt: number
  step: number       // current sweep step size
  sweepIdx: number   // next value to probe
  sweepEnd: number   // end of current pass
  passNum: number    // which refinement pass (0 = initial coarse)
  finished: boolean  // sweep passes complete, trying finals
  finals: number[]   // bestVal ± small offsets
  finalIdx: number
  dispatched: boolean
}

const kingOfTheHill: SolverModule<KingOfTheHillState> = {
  init(details) {
    const min = 10 ** (details.passwordLength - 1)
    const max = 10 ** details.passwordLength - 1
    const step = Math.max(1, Math.ceil((max - min) / 25))
    return {
      type: "kingOfTheHill",
      min, max,
      bestVal: min, bestAlt: -Infinity,
      step, sweepIdx: min, sweepEnd: max,
      passNum: 0,
      finished: false, finals: [], finalIdx: 0,
      dispatched: false,
    }
  },
  nextGuess(state) {
    if (state.dispatched) return null

    // If pass complete → refine and start next pass
    while (state.sweepIdx > state.sweepEnd) {
      if (state.bestAlt <= 0 && state.passNum === 0) {
        // Coarse pass found nothing — scan entire range at step 1 (tiny range?)
        state.sweepIdx = state.min
        state.sweepEnd = state.max
        state.step = 1
        state.passNum = 999 // last pass
        continue
      }
      // Narrow around best: next pass covers ±prev_step of best
      const prevStep = state.step
      state.step = Math.max(1, Math.ceil(prevStep / 8))
      if (state.step >= prevStep) {
        // Refinement saturated — build final candidates
        state.finished = true
        break
      }
      state.sweepIdx = Math.max(state.min, state.bestVal - prevStep)
      state.sweepEnd = Math.min(state.max, state.bestVal + prevStep)
      state.passNum++
    }

    if (!state.finished) {
      const g = state.sweepIdx
      state.sweepIdx += state.step
      return { guess: String(g), detail: `p${state.passNum}-${g}` }
    }

    // Finished scanning — try candidates around best value
    if (state.finals.length === 0) {
      // Build ordered list: best first, then ±1, ±2, ±3
      for (const d of [0, -1, 1, -2, 2, -3, 3]) {
        const c = state.bestVal + d
        if (c >= state.min && c <= state.max) state.finals.push(c)
      }
    }
    if (state.finalIdx < state.finals.length) {
      const c = state.finals[state.finalIdx++]!
      return { guess: String(c), detail: `final ${c}` }
    }
    state.dispatched = true
    return null
  },
  applyResult(state, _guess, result) {
    if (result.success) return state
    const g = Number(_guess)
    const alt = typeof result.feedback === "string" ? Number(result.feedback) : 0
    if (alt > state.bestAlt) { state.bestAlt = alt; state.bestVal = g }
    return state
  },
}

// --- RateMyPix.Auth ---

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

function generateRateMyPixPermutations(freq: Record<string, number>, length: number): string[] {
  const uniqueChars = Object.keys(freq).sort()
  const remaining = { ...freq }
  const out: string[] = []
  function build(prefix: string) {
    if (prefix.length === length) { out.push(prefix); return }
    for (const ch of uniqueChars) {
      if (!(remaining[ch]! > 0)) continue
      remaining[ch]!--
      build(prefix + ch)
      remaining[ch]!++
    }
  }
  build("")
  return out
}

interface RateMyPixState extends SolverState {
  type: "rateMyPix"
  charset: string
  charIdx: number
  freq: Record<string, number>
  phase: "freq" | "perm"
  candidates: string[]
  length: number
  retries: number   // retry count for unparseable feedback in freq phase
}

const rateMyPix: SolverModule<RateMyPixState> = {
  init(details) {
    return {
      type: "rateMyPix",
      charset: rateMyPixCharset(details.passwordFormat),
      charIdx: 0, freq: {}, phase: "freq", candidates: [],
      length: details.passwordLength,
      retries: 0,
    }
  },
  nextGuess(state) {
    if (state.phase === "freq") {
      if (state.charIdx < state.charset.length) {
        const ch = state.charset[state.charIdx]!
        return { guess: ch.repeat(state.length), detail: `freq ${ch}` }
      }
      // Frequency phase done — generate permutations
      state.candidates = generateRateMyPixPermutations(state.freq, state.length)
      state.phase = "perm"
      if (state.candidates.length === 0) return null
    }
    if (state.phase === "perm") {
      if (state.candidates.length === 0) return null
      return { guess: state.candidates[0]!, detail: `${state.candidates.length} cand` }
    }
    return null
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
      // End of charset — validate
      if (state.charIdx >= state.charset.length) {
        const total = Object.values(state.freq).reduce((a, b) => a + b, 0)
        if (total < state.length) {
          // Some chars undetected (possibly outside charset).
          // Pad with the first charset character to reach length.
          let remaining = state.length - total
          for (const ch of state.charset) {
            if (remaining <= 0) break
            if (state.freq[ch]) continue
            state.freq[ch] = 1
            remaining--
          }
          // Still short — just put the rest on the first known char
          if (remaining > 0) {
            const known = Object.keys(state.freq)[0] ?? state.charset[0]!
            state.freq[known] = (state.freq[known] ?? 0) + remaining
          }
        }
      }
      return state
    }

    // Perm phase: prune by exact position match count
    const fb = result.feedback ?? ""
    if (!fb) return state
    const pruneCount = rateMyPixPepperCount(fb)
    state.candidates = state.candidates.filter((candidate) => {
      if (candidate === guess) return false
      let matches = 0
      for (let i = 0; i < state.length; i++) {
        if (candidate[i] === guess[i]) matches++
      }
      return matches === pruneCount
    })
    return state
  },
}

// --- TimingAttack (2G_cellular) ---

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
    // All positions resolved, dispatch final
    state.finalDispatched = true
    return { guess: state.chars.join(""), detail: "final" }
  },
  applyResult(state, guess, result) {
    if (result.success) return state
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

// --- OpenWebAccessPoint (packetSniffer) ---
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
        state.candidateIdx++
        return { guess, detail: `cand ${state.candidateIdx}/${state.candidates.length}` }
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

    return state
  },
}

// --- BigMo%od (triple modulo) ---
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
        // Return the probe — applyResult will store feedback at this index
        return { guess: String(p.n), detail: `bigMo d=${p.d}` }
      }
      state.phase = "solve"
    }
    if (state.phase === "solve") {
      const resolved = state.probes.filter((p) => p.r !== null) as { d: number; r: number }[]
      if (resolved.length === 0) {
        state.finalDispatched = true
        return null
      }
      const padded = bigMoPasswordFromProbes(resolved, state.pwMin, state.pwMax, state.length)
      state.finalDispatched = true
      if (!padded) return null
      return { guess: padded, detail: "bigMo CRT" }
    }
    state.finalDispatched = true
    return null
  },
  applyResult(state, _guess, result) {
    if (result.success) return state
    if (state.phase === "probe" && state.probeIdx < state.probes.length) {
      const fb = typeof result.feedback === "string" ? Number(result.feedback) : NaN
      if (Number.isFinite(fb) && fb >= 0) {
        state.probes[state.probeIdx]!.r = fb
      }
      state.probeIdx++
    }
    return state
  },
}



export const SOLVER_MODULES: Record<string, SolverModule> = {
  'ZeroLogon|numeric': zeroLogon, 'ZeroLogon|alphabetic': zeroLogon,
  'ZeroLogon|alphanumeric': zeroLogon, 'ZeroLogon|ASCII': zeroLogon,
  'CloudBlare(tm)|numeric': cloudBlare,
  'DeskMemo_3.1|numeric': deskMemo,
  'BellaCuore|numeric': bellaCuoreSingle,
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
  'TopPass|alphabetic': topPass, 'TopPass|alphanumeric': topPass, 'TopPass|ASCII': topPass,
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
