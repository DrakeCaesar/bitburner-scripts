import {
  type SolverState,
  type SolverModule,
  type SolverContext,
  type SolverGuessResult,
  type DarknetServerDetailsForFormulas,
} from "./config"
import { DARKWEB_COMMON_PASSWORDS } from "./config"

// ============================================================
// Solver registry — lookupSolver is defined after SOLVER_REGISTRY below.
// ============================================================

// ============================================================
// Shared helpers
// ============================================================

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
    total += (next !== undefined && current < next) ? -current : current
  }
  return total
}

function mastermindCharset(format: string): string {
  switch (format) {
    case "numeric": return "0123456789"
    case "alphabetic": return "abcdefghijklmnopqrstuvwxyz"
    case "alphanumeric": return "0123456789abcdefghijklmnopqrstuvwxyz"
    default: return "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  }
}

function mastermindFeedback(secret: string, guess: string): { exact: number; misplaced: number } {
  let exact = 0
  const secretRem: string[] = []
  const guessRem: string[] = []
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) { exact++ }
    else { secretRem.push(secret[i]!); guessRem.push(guess[i]!) }
  }
  let misplaced = 0
  const used = secretRem.map(() => false)
  for (const ch of guessRem) {
    const idx = secretRem.findIndex((s, i) => !used[i] && s === ch)
    if (idx >= 0) { used[idx] = true; misplaced++ }
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

function parseBoolFeedback(data: unknown): boolean | null {
  if (data === true || data === "true") return true
  if (data === false || data === "false") return false
  return null
}

// ============================================================
// Static solvers
// ============================================================

// --- ZeroLogon ---

interface ZeroLogonState extends SolverState { type: "zeroLogon"; dispatched: boolean }

const zeroLogon: SolverModule<ZeroLogonState> = {
  initSolver(details) {
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
  initSolver(details) {
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
  initSolver(details) {
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
  initSolver(details) {
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
  initSolver(details) {
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
  initSolver(details) {
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
  initSolver(details) {
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
  initSolver(details) {
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
  initSolver(details) {
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
  initSolver(details) {
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
  initSolver(details) {
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
  initSolver(details) {
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
  "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "CzechRepublic",
  "Denmark", "Estonia", "Finland", "France", "Germany", "Greece", "Hungary",
  "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg", "Malta",
  "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia",
  "Spain", "Sweden",
]

const euroZone: SolverModule<EuroZoneState> = {
  initSolver(details) {
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
  initSolver(details) {
    const candidates = [...DARKWEB_COMMON_PASSWORDS].filter((c) => c.length === details.passwordLength)
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

// --- FreshInstall (numeric) ---

interface FreshInstallState extends SolverState { type: "freshInstall"; remaining: string[] }

const freshInstall: SolverModule<FreshInstallState> = {
  initSolver(details) {
    if (details.passwordFormat !== "numeric") return { type: "freshInstall", remaining: [] }
    const zeros = "0".repeat(details.passwordLength)
    const sequence = "123456789".slice(0, details.passwordLength)
    return { type: "freshInstall", remaining: zeros === sequence ? [zeros] : [zeros, sequence] }
  },
  nextGuess(state) {
    if (state.remaining.length === 0) return null
    const guess = state.remaining.pop()!
    return { guess, detail: `freshInstall (${state.remaining.length + 1} left)` }
  },
  applyResult(state, _guess, result) {
    if (result.success) state.remaining = []
    return state
  },
}

// --- FreshInstall (alphabetic) ---

interface FreshInstallAlphaState extends SolverState { type: "freshInstallAlpha"; dispatched: boolean; guess: string | null }

const freshInstallAlpha: SolverModule<FreshInstallAlphaState> = {
  initSolver(details) {
    if (details.passwordFormat === "numeric") return { type: "freshInstallAlpha", dispatched: true, guess: null }
    if (details.passwordLength === 5) return { type: "freshInstallAlpha", dispatched: false, guess: "admin" }
    if (details.passwordLength === 8) return { type: "freshInstallAlpha", dispatched: false, guess: "password" }
    return { type: "freshInstallAlpha", dispatched: true, guess: null }
  },
  nextGuess(state) {
    if (state.dispatched || !state.guess) return null
    state.dispatched = true
    return { guess: state.guess, detail: "freshInstall" }
  },
  applyResult(state, _guess, _result) { return state },
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
  initSolver(details) {
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
  initSolver(details) {
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
  initSolver(details) {
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
  initSolver(details) {
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
  initSolver(details) {
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

    if (!state.probedZero && guess === "0") {
      state.probedZero = true
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
  initSolver(details) {
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
  initSolver(details) {
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
      // Game returns "🌶🌶/N" or "0/N" — count 🌶 before the slash
      const emojiCount = (fb.split("/")[0]?.match(/🌶/g) ?? []).length
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
    const pruneCount = (fb.split("/")[0]?.match(/🌶/g) ?? []).length
    state.candidates = state.candidates.filter((candidate) => {
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
  initSolver(details) {
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
//   1. Send hostname as guess → get feedback data (the "packet capture")
//   2. Try "hostname:password" regex first (easy variant)
//   3. Fall back: extract all substrings of password length, iterate through them (hard variant)

interface OpenWebAccessPointState extends SolverState {
  type: "openWebAccessPoint"
  phase: "probe" | "easySubmit" | "hardIterate"
  extractedPassword: string | null
  pwLen: number
  candidates: string[]     // substrings from the feedback data
  candidateIdx: number
}

const openWebAccessPoint: SolverModule<OpenWebAccessPointState> = {
  initSolver(details) {
    return {
      type: "openWebAccessPoint", phase: "probe",
      extractedPassword: null, pwLen: details.passwordLength,
      candidates: [], candidateIdx: 0,
    }
  },
  nextGuess(state, context) {
    if (state.phase === "probe") {
      return { guess: context.target, detail: `probe ${context.target}` }
    }
    if (state.phase === "easySubmit" && state.extractedPassword) {
      return { guess: state.extractedPassword, detail: "submit (easy)" }
    }
    if (state.phase === "hardIterate") {
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

      // Try easy variant: "hostname:password" embedded
      const escapedHost = guess.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const regex = new RegExp(escapedHost + `:(\\S+)`)
      const m = fb.match(regex)
      if (m) {
        state.extractedPassword = m[1]!
        state.phase = "easySubmit"
        return state
      }

      // Hard variant: raw password embedded in alphanumeric noise.
      // Collect all substrings of password length from the feedback.
      if (fb.length < state.pwLen) {
        state.phase = "hardIterate" // dead end
        return state
      }
      const candidates: string[] = []
      for (let i = 0; i <= fb.length - state.pwLen; i++) {
        const sub = fb.slice(i, i + state.pwLen)
        if (!candidates.includes(sub)) candidates.push(sub)
      }
      state.candidates = candidates
      state.candidateIdx = 0
      state.phase = "hardIterate"
      return state
    }

    // For easySubmit — already dispatched, done
    // For hardIterate — nextGuess handles advancing candidateIdx
    return state
  },
}

// --- Labyrinth ---

interface LabyrinthState extends SolverState {
  type: "labyrinth"
  visited: string[]
  path: string[]
  coords: [number, number] | null
  walls: { north: boolean; east: boolean; south: boolean; west: boolean } | null
  phase: "labreport" | "move" | "done"
}

const LABYRINTH_DIRS: Record<string, [number, number]> = { n: [0, -2], e: [2, 0], s: [0, 2], w: [-2, 0] }
const LABYRINTH_OPPOSITE: Record<string, string> = { n: "s", e: "w", s: "n", w: "e" }

const labyrinth: SolverModule<LabyrinthState> = {
  initSolver(_details) {
    return { type: "labyrinth", visited: [], path: [], coords: null, walls: null, phase: "labreport" }
  },
  nextGuess(state) {
    if (state.phase === "done") return null
    // Needs labreport before moving — master should heartbleed first
    if (state.phase === "labreport" || !state.coords || !state.walls) return null

    const [x, y] = state.coords
    const key = `${x},${y}`
    if (!state.visited.includes(key)) state.visited.push(key)

    // Try each unvisited direction
    for (const [dir, [dx, dy]] of Object.entries(LABYRINTH_DIRS)) {
      if (!state.walls[dir as keyof typeof state.walls]) continue
      const nx = x + dx!
      const ny = y + dy!
      const nkey = `${nx},${ny}`
      if (state.visited.includes(nkey)) continue
      return { guess: dir, detail: `move ${dir}` }
    }

    // No unvisited — backtrack
    if (state.path.length > 0) {
      const last = state.path.pop()!
      return { guess: LABYRINTH_OPPOSITE[last]!, detail: `back ${last}` }
    }

    // Explored everything
    state.phase = "done"
    return null
  },
  applyResult(state, guess, result) {
    if (result.success) {
      // The authenticate data is the password
      return state
    }
    // Direction was accepted (player moved) — record in path
    if (guess === "n" || guess === "e" || guess === "s" || guess === "w") {
      // If this was a forward move (not backtrack), push to path
      if (state.path.length === 0 || guess !== LABYRINTH_OPPOSITE[state.path[state.path.length - 1]!]) {
        state.path.push(guess)
      }
      // Need labreport to get new position
      state.coords = null
      state.walls = null
      state.phase = "labreport"
    }
    return state
  },
  applyLabreport(state, report) {
    state.coords = report.coords as [number, number]
    state.walls = { north: report.north, east: report.east, south: report.south, west: report.west }
    state.phase = "move"
    // Mark current position as visited
    const [x, y] = state.coords
    const key = `${x},${y}`
    if (!state.visited.includes(key)) {
      state.visited.push(key)
    }
    return state
  },
}

// --- BigMo%od (triple modulo) ---

// CRT helper: combine two coprime constraints x ≡ r1 (mod m1), x ≡ r2 (mod m2)
function crtCombine(r1: number, m1: number, r2: number, m2: number): { r: number; m: number } | null {
  // Extended Euclidean algorithm: find a, b such that a*m1 + b*m2 = 1
  let [old_r, r] = [m1, m2]
  let [old_s, s] = [1, 0]
  let [old_t, t] = [0, 1]
  while (r !== 0) {
    const quotient = Math.floor(old_r / r)
    ;[old_r, r] = [r, old_r - quotient * r]
    ;[old_s, s] = [s, old_s - quotient * s]
    ;[old_t, t] = [t, old_t - quotient * t]
  }
  const g = old_r
  if ((r2 - r1) % g !== 0) return null // inconsistent constraints
  const lcm = (m1 / g) * m2
  const x = (r1 + (r2 - r1) / g * old_s * m1) % lcm
  return { r: (x + lcm) % lcm, m: lcm }
}

// Primes we can use as moduli (all < 32 since d = ((n-1)%32)+1 ≤ 32)
const BIGMO_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31]

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
  initSolver(details) {
    const len = details.passwordLength
    const pwMin = 10 ** (len - 1)
    const pwMax = 10 ** len - 1
    const probes: { n: number; d: number; r: number | null }[] = []
    for (const d of BIGMO_PRIMES) {
      const target = d % 32
      let n = pwMax + 1
      while (n % 32 !== target) n++
      probes.push({ n, d, r: null })
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
      const resolved = state.probes.filter((p) => p.r !== null)
      if (resolved.length === 0) {
        state.finalDispatched = true
        return null
      }
      let r = resolved[0]!.r!
      let m = resolved[0]!.d
      for (let i = 1; i < resolved.length; i++) {
        const combined = crtCombine(r, m, resolved[i]!.r!, resolved[i]!.d)
        if (!combined) { state.finalDispatched = true; return null }
        r = combined.r
        m = combined.m
      }
      const k = Math.ceil((state.pwMin - r) / m)
      const candidate = r + k * m
      if (candidate > state.pwMax) {
        state.finalDispatched = true
        return null
      }
      state.finalDispatched = true
      const raw = String(candidate)
      const padded = raw.length < state.length
        ? "0".repeat(state.length - raw.length) + raw
        : raw
      return { guess: padded, detail: `bigMo CRT` }
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

// ============================================================
// Registry
// ============================================================

export const SOLVER_REGISTRY: Record<string, SolverModule> = {
  // Static
  "ZeroLogon|numeric": zeroLogon,
  "ZeroLogon|alphabetic": zeroLogon,
  "ZeroLogon|alphanumeric": zeroLogon,
  "ZeroLogon|ASCII": zeroLogon,
  "CloudBlare(tm)|numeric": cloudBlare,
  "DeskMemo_3.1|numeric": deskMemo,
  "BellaCuore|numeric": bellaCuoreSingle,
  "OctantVoxel|numeric": octantVoxel,
  "MathML|ASCII": mathML,
  "MathML|numeric": mathML,
  "MathML|alphabetic": mathML,
  "MathML|alphanumeric": mathML,
  "PrimeTime 2|numeric": primeTime2,
  "BigMo%od|numeric": bigMoSolver,
  "110100100|alphanumeric": binaryToText,
  "110100100|alphabetic": binaryToText,
  "110100100|ASCII": binaryToText,
  "OrdoXenos|alphanumeric": ordoXenos,
  "OrdoXenos|alphabetic": ordoXenos,
  "OrdoXenos|ASCII": ordoXenos,
  "Pr0verFl0|numeric": proverFlo,
  "Pr0verFl0|alphabetic": proverFlo,
  "Pr0verFl0|alphanumeric": proverFlo,
  "Pr0verFl0|ASCII": proverFlo,
  // Candidate-list
  "Laika4|alphabetic": laika4,
  "PHP 5.4|numeric": php54,
  "EuroZone Free|ASCII": euroZone,
  "EuroZone Free|alphabetic": euroZone,
  "TopPass|alphabetic": topPass,
  "TopPass|alphanumeric": topPass,
  "TopPass|ASCII": topPass,
  "FreshInstall_1.0|numeric": freshInstall,
  "FreshInstall_1.0|alphabetic": freshInstallAlpha,
  "FreshInstall_1.0|alphanumeric": freshInstallAlpha,
  "FreshInstall_1.0|ASCII": freshInstallAlpha,
  // Sequential interactive
  "NIL|numeric": nilSolver,
  "NIL|alphabetic": nilSolver,
  "NIL|alphanumeric": nilSolver,
  "AccountsManager_4.2|numeric": accountsManager,
  "DeepGreen|numeric": deepGreen,
  "DeepGreen|alphabetic": deepGreen,
  "DeepGreen|alphanumeric": deepGreen,
  "DeepGreen|ASCII": deepGreen,
  "Factori-Os|numeric": factoriOs,
  "KingOfTheHill|numeric": kingOfTheHill,
  "RateMyPix.Auth|numeric": rateMyPix,
  "RateMyPix.Auth|alphabetic": rateMyPix,
  "RateMyPix.Auth|alphanumeric": rateMyPix,
  "RateMyPix.Auth|ASCII": rateMyPix,
  "2G_cellular|numeric": timingAttack,
  "2G_cellular|alphabetic": timingAttack,
  "2G_cellular|alphanumeric": timingAttack,
  "OpenWebAccessPoint|numeric": openWebAccessPoint,
  "OpenWebAccessPoint|alphabetic": openWebAccessPoint,
  "OpenWebAccessPoint|alphanumeric": openWebAccessPoint,
  "OpenWebAccessPoint|ASCII": openWebAccessPoint,
  "(The Labyrinth)|numeric": labyrinth,
  "(The Labyrinth)|alphabetic": labyrinth,
  "(The Labyrinth)|alphanumeric": labyrinth,
  "(The Labyrinth)|ASCII": labyrinth,
}

export function lookupSolver(details: DarknetServerDetailsForFormulas): SolverModule | null {
  // Range variant: Data is "nulla,MCXCVII" (comma-separated bounds), not a single numeral.
  if (details.modelId === "BellaCuore" && details.passwordFormat === "numeric" && details.data.includes(",")) {
    return bellaCuoreRange
  }
  const key = `${details.modelId}|${details.passwordFormat}`
  return SOLVER_REGISTRY[key] ?? null
}

// Exported for master + solverWorker
export { bellaCuoreRange }
