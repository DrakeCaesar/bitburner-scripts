import {
  type SolverState,
  type SolverModule,
  type DarknetServerDetailsForFormulas,
} from "./config"
import { DARKWEB_COMMON_PASSWORDS } from "./config"

// ============================================================
// Solver registry
// ============================================================

export function lookupSolver(details: DarknetServerDetailsForFormulas): SolverModule | null {
  const key = `${details.modelId}|${details.passwordFormat}`
  return (SOLVER_REGISTRY as Record<string, SolverModule>)[key] ?? null
}

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

// --- OctantVoxel ---

interface OctantVoxelState extends SolverState { type: "octantVoxel"; dispatched: boolean; guess: string | null }

const octantVoxel: SolverModule<OctantVoxelState> = {
  initSolver(details) {
    const parts = details.data.split(",")
    if (parts.length !== 2) return { type: "octantVoxel", dispatched: true, guess: null }
    const fromBase = Number(parts[0]?.trim())
    const numberStr = parts[1]?.trim()
    if (!Number.isInteger(fromBase) || fromBase < 2 || fromBase > 36 || !numberStr) {
      return { type: "octantVoxel", dispatched: true, guess: null }
    }
    const validChars = "0123456789abcdefghijklmnopqrstuvwxyz".slice(0, fromBase)
    for (const ch of numberStr.toLowerCase()) {
      if (!validChars.includes(ch)) return { type: "octantVoxel", dispatched: true, guess: null }
    }
    const decimal = parseInt(numberStr, fromBase)
    if (!Number.isFinite(decimal)) return { type: "octantVoxel", dispatched: true, guess: null }
    const password = String(decimal)
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

function cleanMathExpression(expr: string): string {
  return expr
    .replace(/\u2212/g, "-").replace(/\u00D7/g, "*").replace(/\u00F7/g, "/")
    .replace(/\u00B7/g, "*").replace(/\u2217/g, "*")
    .replace(/\u2795/g, "+").replace(/\u2796/g, "-")
    .replace(/[^\d\s+\-*/().]/g, "")
}

function evaluateMathExpression(expr: string): number {
  const cleaned = cleanMathExpression(expr)
  if (!cleaned) return NaN
  try { return Function(`"use strict"; return (${cleaned})`)() as number }
  catch { return NaN }
}

interface MathMLState extends SolverState { type: "mathML"; dispatched: boolean; guess: string | null }

const mathML: SolverModule<MathMLState> = {
  initSolver(details) {
    if (!details.data) return { type: "mathML", dispatched: true, guess: null }
    const result = evaluateMathExpression(details.data)
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
      charset, charIdx: 0, finalDispatched: false,
    }
  },
  nextGuess(state) {
    if (state.chars.every((d) => d !== null) && !state.finalDispatched) {
      state.finalDispatched = true
      return { guess: state.chars.join(""), detail: "NIL final" }
    }
    if (state.charIdx < state.charset.length) {
      const ch = state.charset[state.charIdx]!
      return { guess: ch.repeat(state.chars.length), detail: `NIL char ${ch}` }
    }
    return null
  },
  applyResult(state, guess, result) {
    if (result.success) return state
    if (guess.length > 1 && !state.finalDispatched) {
      const feedback = result.feedback ?? ""
      const parts = feedback.split(",")
      if (parts.length === state.chars.length) {
        let any = false
        for (let i = 0; i < parts.length; i++) {
          if (parts[i] === "yes") { state.chars[i] = guess[0]!; any = true }
        }
        state.charIdx++ // advance only when feedback was parseable
        if (!any && state.charIdx >= state.charset.length) {
          // End of charset with no matches — final guess is best effort
          state.finalDispatched = true
          state.chars.fill("0") // fallback digit
          return state
        }
      }
      // If parts length doesn't match, retry same char (charIdx not incremented)
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

interface DeepGreenState extends SolverState {
  type: "deepGreen"
  candidates: string[]
  charset: string
}

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

const deepGreen: SolverModule<DeepGreenState> = {
  initSolver(details) {
    const charset = mastermindCharset(details.passwordFormat)
    const initial = generateMastermindCandidates(details.passwordLength, charset)
    return { type: "deepGreen", candidates: initial ?? [], charset }
  },
  nextGuess(state) {
    if (state.candidates.length === 0) return null
    const guess = pickMastermindGuess(state.candidates)
    return { guess, detail: `${state.candidates.length} cand` }
  },
  applyResult(state, guess, result) {
    if (result.success) return state
    const fbRaw = result.feedback ?? ""
    const fb = parseMastermindFeedback(fbRaw)
    if (!fb) return state // unparseable — retry same guess
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
}

const factoriOs: SolverModule<FactoriOsState> = {
  initSolver(details) {
    return {
      type: "factoriOs",
      primeIdx: 0, product: 1,
      phase: "prime", currentPower: 0, nextPower: 0,
      length: details.passwordLength, finalDispatched: false,
      needsRecheck: false,
    }
  },
  nextGuess(state) {
    if (state.finalDispatched) return null
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

interface KingOfTheHillState extends SolverState {
  type: "kingOfTheHill"
  min: number
  max: number
  phase: "search" | "scan" | "done"
  // Search stack for recursive interval-halving
  stack: [number, number][]
  // Coarse sweep
  sweepIdx: number
  sweepStep: number
  sweepsDone: number
  bestVal: number
  bestAlt: number
  // Scan state
  scanLo: number
  scanHi: number
  scanIdx: number
  // Termination
  exhausted: boolean
  // When nextGuess pops a tiny interval for scanning, set this so applyResult
  // doesn't double-pop the stack (see applyResult).
  poppedForScan: boolean
}

const kingOfTheHill: SolverModule<KingOfTheHillState> = {
  initSolver(details) {
    const min = 10 ** (details.passwordLength - 1)
    const max = 10 ** details.passwordLength - 1
    const step = Math.max(1, Math.floor(Math.sqrt(max - min)))
    return {
      type: "kingOfTheHill",
      min, max, phase: "search",
      stack: [[min, max]],
      sweepIdx: min - step, sweepStep: step, sweepsDone: 0,
      bestVal: min, bestAlt: 0,
      scanLo: 0, scanHi: 0, scanIdx: 0,
      exhausted: false,
      poppedForScan: false,
    }
  },
  nextGuess(state) {
    if (state.exhausted) return null
    if (state.phase === "done") return null

    // Coarse sweep every sweepStep to find non-zero altitude regions
    if (state.sweepsDone < 3) {
      state.sweepIdx += state.sweepStep
      if (state.sweepIdx > state.max) {
        state.sweepsDone++
        state.sweepIdx = state.min - state.sweepStep + state.sweepsDone // offset subsequent sweeps
        if (state.sweepsDone >= 3) {
          // Sweeps done, fall through to search
        } else {
          return { guess: String(state.sweepIdx), detail: `sweep ${state.sweepIdx}` }
        }
      } else {
        return { guess: String(state.sweepIdx), detail: `sweep ${state.sweepIdx}` }
      }
    }

    if (state.phase === "scan") {
      // Linear scan within a narrow window found by the search
      if (state.scanIdx <= state.scanHi) {
        const g = state.scanIdx++
        return { guess: String(g), detail: `scan ${g}` }
      }
      state.phase = "search"
    }

    // Recursive interval-halving search
    while (state.stack.length > 0) {
      const [lo, hi] = state.stack[state.stack.length - 1]!
      if (hi - lo <= 2) {
        state.stack.pop()
        // Tiny interval — scan all values
        state.phase = "scan"
        state.poppedForScan = true
        state.scanLo = lo
        state.scanHi = hi
        state.scanIdx = lo
        if (state.scanIdx > state.scanHi) { state.phase = "search"; state.poppedForScan = false; continue }
        return { guess: String(state.scanIdx++), detail: `tiny ${lo}-${hi}` }
      }
      const mid = Math.floor((lo + hi) / 2)
      // We'll probe mid — stash the interval and wait for applyResult
      // The actual halving happens in applyResult
      return { guess: String(mid), detail: `bin ${mid}` }
    }

    // No more intervals — try neighbors of best value found
    if (state.bestAlt > 0) {
      for (const d of [0, -1, 1, -2, 2, -3, 3]) {
        const c = state.bestVal + d
        if (c >= state.min && c <= state.max) {
          state.exhausted = true
          return { guess: String(c), detail: `final ${c}` }
        }
      }
    }

    state.exhausted = true
    return null
  },
  applyResult(state, guess, result) {
    if (result.success) return state
    const g = Number(guess)
    const alt = typeof result.feedback === "string" ? Number(result.feedback) : 0

    if (alt > state.bestAlt) { state.bestAlt = alt; state.bestVal = g }

    if (state.phase === "scan" || state.sweepsDone < 3) return state

    // If nextGuess popped a tiny interval for scanning, skip the pop — the
    // interval was already consumed and applyResult shouldn't steal the next one.
    if (state.poppedForScan) {
      state.poppedForScan = false
      return state
    }

    // Search phase: process the midpoint probe and recurse
    if (state.stack.length > 0) {
      const [lo, hi] = state.stack.pop()!
      const mid = Math.floor((lo + hi) / 2)

      if (alt > 1e-10) {
        // Found signal — scan neighborhood
        const w = Math.max(1, Math.floor(Math.sqrt(hi - lo)))
        state.phase = "scan"
        state.scanLo = Math.max(state.min, mid - w)
        state.scanHi = Math.min(state.max, mid + w)
        state.scanIdx = state.scanLo
      } else {
        // No signal — split and recurse into both halves
        if (mid + 1 <= hi) state.stack.push([mid + 1, hi])
        if (lo <= mid - 1) state.stack.push([lo, mid - 1])
      }
    }
    return state
  },
}

// --- RateMyPix.Auth ---

interface RateMyPixState extends SolverState {
  type: "rateMyPix"
  charset: string
  charIdx: number
  freq: Record<string, number>
  phase: "freq" | "perm"
  candidates: string[]
  length: number
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

const rateMyPix: SolverModule<RateMyPixState> = {
  initSolver(details) {
    return {
      type: "rateMyPix",
      charset: rateMyPixCharset(details.passwordFormat),
      charIdx: 0, freq: {}, phase: "freq", candidates: [],
      length: details.passwordLength,
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
      if (!fb) return state // no feedback — retry same char
      const count = (fb.match(/🌶/g) ?? []).length
      if (count > 0) state.freq[guess[0]!] = count
      state.charIdx++
      // If all chars probed, validate total count
      if (state.charIdx >= state.charset.length) {
        const total = Object.values(state.freq).reduce((a, b) => a + b, 0)
        if (total !== state.length) { state.phase = "perm"; state.candidates = [] }
      }
      return state
    }

    // Perm phase: prune by exact match count
    const fb = result.feedback ?? ""
    const pruneCount = (fb.match(/🌶/g) ?? []).length
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

// --- OpenWebAccessPoint ---

interface OpenWebAccessPointState extends SolverState {
  type: "openWebAccessPoint"
  phase: "probe" | "submit"
  extractedPassword: string | null
}

const openWebAccessPoint: SolverModule<OpenWebAccessPointState> = {
  initSolver(_details) {
    return { type: "openWebAccessPoint", phase: "probe", extractedPassword: null }
  },
  nextGuess(state, context) {
    if (state.phase === "probe") {
      return { guess: context.target, detail: `probe ${context.target}` }
    }
    if (state.phase === "submit" && state.extractedPassword) {
      // One-shot submit
      return { guess: state.extractedPassword, detail: "submit" }
    }
    return null
  },
  applyResult(state, guess, result) {
    if (result.success) return state
    if (state.phase === "probe") {
      const fb = result.feedback ?? ""
      if (!fb) return state // no feedback — retry
      // Extract "hostname:password" from feedback
      const escapedHost = guess.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const regex = new RegExp(escapedHost + `:(\\S+)`)
      const m = fb.match(regex)
      if (m) {
        state.extractedPassword = m[1]!
        state.phase = "submit"
      } else {
        state.extractedPassword = null
        state.phase = "submit" // done trying
      }
    }
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

const SOLVER_REGISTRY: Record<string, SolverModule> = {
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

// Exported for master special-case handling (BellaCuore range detection)
export { bellaCuoreRange }
