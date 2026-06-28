import { NS } from "@ns"
import {
  type DarknetAuthSolverInput,
  type DarknetPasswordFormat,
  type DarknetCrawlApi,
  type DarknetServerDetailsForFormulas,
  type CrawlHostReport,
  type CrawlStatusReport,
  darkwebPasswordCandidates,
  darkwebHostDigitPool,
  tryConnectToSession,
} from "./config"

// --- auth solver helpers ---

/** Space before, digits, then space/dot/comma/end (avoids matching inside words/times). */
function extractLogNumbers(text: string): number[] {
  const numbers: number[] = []
  const re = /(?:^|\s)(\d+)(?=[\s.,]|$)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    numbers.push(Number(match[1]))
  }
  return numbers
}

function numericDefaultZeros(length: number): string {
  return "0".repeat(length)
}

function numericDefaultSequence(length: number): string {
  return Array.from({ length }, (_, i) => String(i + 1)).join("")
}

function freshInstallNumericCandidates(length: number, logs: string[]): string[] {
  const zeros = numericDefaultZeros(length)
  const sequence = numericDefaultSequence(length)

  const numbers: number[] = []
  for (const line of logs) {
    numbers.push(...extractLogNumbers(line))
  }
  const clues = numbers.filter((n) => n >= 0 && n <= length)
  if (clues.length === 0) {
    return [zeros, sequence]
  }

  if (clues.every((n) => n === 0)) {
    return [zeros]
  }

  if (clues.some((n) => n > 0)) {
    return [sequence]
  }

  return [zeros, sequence]
}

function solveFreshInstall(input: DarknetAuthSolverInput): string | null {
  if (input.modelId !== "FreshInstall_1.0") {
    return null
  }

  if (input.passwordFormat === "numeric") {
    return null
  }

  if (input.passwordFormat === "alphabetic") {
    if (input.passwordLength === 5) {
      return "admin"
    }
    if (input.passwordLength === 8) {
      return "password"
    }
  }

  return null
}

function solveZeroLogon(input: DarknetAuthSolverInput): string | null {
  if (input.modelId !== "ZeroLogon") {
    return null
  }
  if (input.passwordLength !== 0) {
    return null
  }

  return ""
}

function solveCloudBlare(input: DarknetAuthSolverInput): string | null {
  if (input.modelId !== "CloudBlare(tm)") {
    return null
  }
  if (input.passwordFormat !== "numeric") {
    return null
  }
  if (input.passwordHint !== "Type the numbers to prove you are human") {
    return null
  }

  const digits = input.data.replace(/\D/g, "")
  if (digits.length !== input.passwordLength) {
    return null
  }

  return digits
}

function solveDeskMemo(input: DarknetAuthSolverInput): string | null {
  if (input.modelId !== "DeskMemo_3.1") {
    return null
  }
  if (input.passwordFormat !== "numeric") {
    return null
  }

  const numerals = input.passwordHint.replace(/\D/g, "")
  if (numerals.length !== input.passwordLength) {
    return null
  }

  return numerals
}

function romanToDecimal(roman: string): number | null {
  const values: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  }

  const upper = roman.trim().toUpperCase()
  if (!upper || !/^[IVXLCDM]+$/.test(upper)) {
    return null
  }

  let total = 0
  for (let i = 0; i < upper.length; i++) {
    const current = values[upper[i]!]
    const next = values[upper[i + 1]!]
    if (current === undefined) {
      return null
    }
    if (next !== undefined && current < next) {
      total -= current
    } else {
      total += current
    }
  }

  return total
}

function solveBellaCuore(input: DarknetAuthSolverInput): string | null {
  if (input.modelId !== "BellaCuore") {
    return null
  }
  if (input.passwordFormat !== "numeric") {
    return null
  }

  const numeral = input.data.trim()
  if (input.passwordHint !== `The password is the value of the number '${numeral}'`) {
    return null
  }

  const decimal = romanToDecimal(numeral)
  if (decimal === null) {
    return null
  }

  const password = String(decimal)
  if (password.length !== input.passwordLength) {
    return null
  }

  return password
}

function solveOctantVoxel(input: DarknetAuthSolverInput): string | null {
  if (input.modelId !== "OctantVoxel") {
    return null
  }
  if (input.passwordFormat !== "numeric") {
    return null
  }

  // Hint: "the password is the base N number X in base 10"
  // Data: "N,X"
  const parts = input.data.split(",")
  if (parts.length !== 2) {
    return null
  }
  const fromBase = Number(parts[0]?.trim())
  const numberStr = parts[1]?.trim()
  if (!Number.isInteger(fromBase) || fromBase < 2 || fromBase > 36 || !numberStr) {
    return null
  }

  // Validate all digits are valid in the given base
  const validChars = "0123456789abcdefghijklmnopqrstuvwxyz".slice(0, fromBase)
  for (const ch of numberStr.toLowerCase()) {
    if (!validChars.includes(ch)) {
      return null
    }
  }

  const decimal = parseInt(numberStr, fromBase)
  if (!Number.isFinite(decimal)) {
    return null
  }
  const password = String(decimal)
  if (password.length !== input.passwordLength) {
    return null
  }

  return password
}

const LAIKA4_DOG_NAMES = ["max", "fido", "spot", "rover"]

function laika4Candidates(length: number): string[] {
  return LAIKA4_DOG_NAMES.filter((name) => name.length === length)
}

function isLaika4Model(details: DarknetServerDetailsForFormulas): boolean {
  return details.modelId === "Laika4" && details.passwordFormat === "alphabetic"
}

function isFactoriOsModel(details: DarknetServerDetailsForFormulas): boolean {
  return details.modelId === "Factori-Os" && details.passwordFormat === "numeric"
}

function isKingOfTheHillModel(details: DarknetServerDetailsForFormulas): boolean {
  return details.modelId === "KingOfTheHill" && details.passwordFormat === "numeric"
}

function isRateMyPixModel(details: DarknetServerDetailsForFormulas): boolean {
  return details.modelId === "RateMyPix.Auth" && details.passwordFormat === "numeric"
}

function isOpenWebAccessPointModel(details: DarknetServerDetailsForFormulas): boolean {
  return details.modelId === "OpenWebAccessPoint" && details.passwordFormat === "numeric"
}

function solveLaika4(input: DarknetAuthSolverInput): string | null {
  if (input.modelId !== "Laika4" || input.passwordFormat !== "alphabetic") {
    return null
  }
  const candidates = laika4Candidates(input.passwordLength)
  return candidates.length > 0 ? candidates[0]! : null
}

const PHP54_MODEL = "PHP 5.4"

/** Generate all distinct permutations of a multiset of digits. */
function multisetPermutations(digits: string[], length: number): string[] {
  if (digits.length < length) {
    return []
  }

  // Count frequencies
  const freq = new Map<string, number>()
  for (const d of digits.slice(0, length)) {
    freq.set(d, (freq.get(d) ?? 0) + 1)
  }
  const uniqueChars = [...freq.keys()].sort()

  const out: string[] = []
  const build = (prefix: string): void => {
    if (prefix.length === length) {
      out.push(prefix)
      return
    }
    for (const ch of uniqueChars) {
      const rem = freq.get(ch) ?? 0
      if (rem <= 0) continue
      freq.set(ch, rem - 1)
      build(prefix + ch)
      freq.set(ch, rem)
    }
  }
  build("")
  return out
}

function isPhp54Model(details: DarknetServerDetailsForFormulas): boolean {
  return details.modelId === PHP54_MODEL && details.passwordFormat === "numeric"
}

function php54NumericCandidates(host: string, hint: string, length: number): string[] {
  // The server hint format is "The password is shuffled 226"
  // — digits are the exact multiset with repeats preserved.
  const hintDigits = hint.replace(/\D/g, "").split("")
  if (hintDigits.length !== length) {
    return []
  }

  const candidates = multisetPermutations(hintDigits, length)

  // If archive hints exist, filter to only those containing all archive digits
  const archivePool = darkwebHostDigitPool(host)
  if (archivePool && archivePool.length > 0) {
    return candidates.filter((candidate) => {
      return [...archivePool].every((ch) => candidate.includes(ch))
    })
  }

  return candidates
}

/** Generate all unique-per-digit permutations (no repeats). Used by DeepGreen log clues. */
function permutationsFromDigitPool(pool: string, length: number): string[] {
  const chars = pool.replace(/\D/g, "").split("")
  if (chars.length < length) {
    return []
  }

  const out = new Set<string>()
  function walk(available: string[], prefix: string): void {
    if (prefix.length === length) {
      out.add(prefix)
      return
    }
    for (let i = 0; i < available.length; i++) {
      const ch = available[i]!
      const rest = available.slice(0, i).concat(available.slice(i + 1))
      walk(rest, prefix + ch)
    }
  }
  walk(chars, "")
  return [...out].sort((a, b) => a.localeCompare(b))
}

const ACCOUNTS_MANAGER_MODEL = "AccountsManager_4.2"
const GUESS_NUMBER_HINT_RE = /^The password is a number between 0 and (\d+)$/

function parseGuessNumberMax(hint: string): number | null {
  const match = hint.match(GUESS_NUMBER_HINT_RE)
  if (!match) {
    return null
  }
  const max = Number(match[1])
  return Number.isFinite(max) && max > 0 ? max : null
}

function isAccountsManagerGuessNumber(details: DarknetServerDetailsForFormulas): boolean {
  return (
    details.modelId === ACCOUNTS_MANAGER_MODEL &&
    details.passwordFormat === "numeric" &&
    parseGuessNumberMax(details.passwordHint) !== null
  )
}

const DEEP_GREEN_MODEL = "DeepGreen"
const DEEP_GREEN_CLUE_LINE_RE = /remember|must use/i
/** Keep N low enough that pickMastermindGuess (O(N²)) won't freeze the game thread. */
const MAX_MASTERMIND_CANDIDATES = 1_000

function isDeepGreenModel(details: DarknetServerDetailsForFormulas): boolean {
  return details.modelId === DEEP_GREEN_MODEL
}

function extractDeepGreenClueDigits(line: string): string[] {
  if (!DEEP_GREEN_CLUE_LINE_RE.test(line)) {
    return []
  }
  const digits: string[] = []
  for (const ch of line) {
    if (ch >= "0" && ch <= "9") {
      digits.push(ch)
    }
  }
  return digits
}

function deepGreenLogPermutationCandidates(
  logs: string[],
  length: number,
  format: DarknetPasswordFormat
): string[] | null {
  if (format !== "numeric" || length <= 0) {
    return null
  }

  const clueDigits: string[] = []
  for (const line of logs) {
    clueDigits.push(...extractDeepGreenClueDigits(line))
  }

  const unique = [...new Set(clueDigits)]
  if (unique.length !== length) {
    return null
  }

  const candidates = permutationsFromDigitPool(unique.join(""), length)
  return candidates.length > 0 ? candidates : null
}

function mastermindCharset(format: DarknetPasswordFormat): string {
  switch (format) {
    case "numeric":
      return "0123456789"
    case "alphabetic":
      return "abcdefghijklmnopqrstuvwxyz"
    case "alphanumeric":
      return "0123456789abcdefghijklmnopqrstuvwxyz"
    default:
      return "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  }
}

function mastermindFeedback(secret: string, guess: string): { exact: number; misplaced: number } {
  const exact = secret.split("").filter((ch, i) => ch === guess[i]).length
  const remainingSecret = secret.split("").filter((ch, i) => ch !== guess[i])
  const remainingGuess = guess.split("").filter((ch, i) => ch !== secret[i])
  let misplaced = 0
  const used = remainingSecret.map(() => false)
  for (const ch of remainingGuess) {
    const idx = remainingSecret.findIndex((s, i) => !used[i] && s === ch)
    if (idx >= 0) {
      used[idx] = true
      misplaced++
    }
  }
  return { exact, misplaced }
}

function parseMastermindFeedback(data: string): { exact: number; misplaced: number } | null {
  const parts = data.split(",")
  if (parts.length !== 2) {
    return null
  }
  const exact = Number(parts[0]?.trim())
  const misplaced = Number(parts[1]?.trim())
  if (!Number.isInteger(exact) || !Number.isInteger(misplaced)) {
    return null
  }
  return { exact, misplaced }
}

function generateMastermindCandidates(length: number, charset: string): string[] | null {
  if (length <= 0) {
    return null
  }
  const size = charset.length ** length
  if (size > MAX_MASTERMIND_CANDIDATES) {
    return null
  }
  const out: string[] = []
  const build = (prefix: string): void => {
    if (prefix.length === length) {
      out.push(prefix)
      return
    }
    for (let i = 0; i < charset.length; i++) {
      build(prefix + charset[i])
    }
  }
  build("")
  return out
}

function pickMastermindGuess(candidates: string[]): string {
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

function isNilModel(details: DarknetServerDetailsForFormulas): boolean {
  return (
    details.modelId === "NIL" &&
    details.passwordFormat === "numeric" &&
    details.passwordHint === "you are one who's'nt authorized"
  )
}

function parseNilFeedback(data: string, length: number): boolean[] | null {
  const parts = data.split(",")
  if (parts.length !== length) {
    return null
  }
  const feedback: boolean[] = []
  for (const part of parts) {
    if (part === "yes") {
      feedback.push(true)
    } else if (part === "yesn't") {
      feedback.push(false)
    } else {
      return null
    }
  }
  return feedback
}

// --- worker helper utilities ---

interface DarknetFormulasApi {
  dnet?: {
    getAuthenticateTime(data: DarknetServerDetailsForFormulas, threads?: number): number
    getHeartbleedTime(data: DarknetServerDetailsForFormulas, threads?: number): number
  }
}

function getScriptThreads(ns: NS): number {
  const running = ns.getRunningScript(ns.getScriptName(), ns.getHostname())
  return running && running.threads > 0 ? running.threads : 1
}

function getFormulasApi(ns: NS): DarknetFormulasApi | null {
  return (ns as NS & { formulas?: DarknetFormulasApi }).formulas ?? null
}

function getAuthEtaMs(ns: NS, dnet: DarknetCrawlApi, host: string): number {
  const details = dnet.getServerDetails(host)
  if (!details.isOnline) {
    return 0
  }
  const formulas = getFormulasApi(ns)?.dnet
  if (!formulas) {
    return 0
  }
  return formulas.getAuthenticateTime(details, getScriptThreads(ns))
}

function getHeartbleedEtaMs(ns: NS, dnet: DarknetCrawlApi, host: string): number {
  const details = dnet.getServerDetails(host)
  if (!details.isOnline) {
    return 0
  }
  const formulas = getFormulasApi(ns)?.dnet
  if (!formulas) {
    return 0
  }
  return formulas.getHeartbleedTime(details, getScriptThreads(ns))
}

export function writeCrawlReport(ns: NS, port: number, report: CrawlHostReport): void {
  ns.writePort(port, JSON.stringify({ type: "host", ...report }))
}

export function writeCrawlStatus(ns: NS, port: number, status: Omit<CrawlStatusReport, "type">): void {
  ns.writePort(port, JSON.stringify({ type: "status", ...status }))
}

export async function authenticateWithStatus(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  password: string,
  detail: string | null = null,
  authGuesses?: number
): Promise<{ success: boolean; data?: unknown }> {
  writeCrawlStatus(ns, port, {
    workerHost: ns.getHostname(),
    targetHost: host,
    phase: "auth",
    etaMs: getAuthEtaMs(ns, dnet, host),
    detail,
    authGuesses,
  })
  return dnet.authenticate(host, password)
}

export async function authenticateCandidates(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  candidates: string[]
): Promise<{ password: string | null; authenticated: boolean; authGuesses: number }> {
  let authGuesses = 0
  for (let i = 0; i < candidates.length; i++) {
    authGuesses++
    const password = candidates[i]!
    const detail = candidates.length > 1 ? `try ${i + 1}/${candidates.length}` : null
    const result = await authenticateWithStatus(ns, port, dnet, host, password, detail, authGuesses)
    if (result.success) {
      return { password, authenticated: true, authGuesses }
    }
  }
  return {
    password: candidates[candidates.length - 1] ?? null,
    authenticated: false,
    authGuesses,
  }
}

// --- auth-solver functions ---

type GuessNumberFeedback = "Higher" | "Lower"

async function authenticateNil(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  length: number
): Promise<{ password: string | null; authenticated: boolean; authGuesses: number }> {
  const digits: (string | null)[] = Array.from({ length }, () => null)
  let authGuesses = 0

  for (let digit = 0; digit <= 9; digit++) {
    authGuesses++
    const guess = String(digit).repeat(length)
    const detail = `NIL digit ${digit}/9`
    const result = await authenticateWithStatus(ns, port, dnet, host, guess, detail, authGuesses)
    if (result.success) {
      return { password: guess, authenticated: true, authGuesses }
    }

    const data = typeof result.data === "string" ? result.data : ""
    const feedback = parseNilFeedback(data, length)
    if (feedback) {
      for (let i = 0; i < length; i++) {
        if (feedback[i]) {
          digits[i] = String(digit)
        }
      }
    }

    if (digits.every((d) => d !== null)) {
      break
    }
  }

  if (!digits.every((d) => d !== null)) {
    return { password: null, authenticated: false, authGuesses }
  }

  authGuesses++
  const password = digits.join("")
  const result = await authenticateWithStatus(ns, port, dnet, host, password, "NIL final", authGuesses)
  return { password, authenticated: result.success, authGuesses }
}

async function authenticateAccountsManager(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  maxExclusive: number
): Promise<{ password: string | null; authenticated: boolean; authGuesses: number }> {
  let min = 0
  let max = maxExclusive - 1
  let authGuesses = 0

  while (min <= max) {
    const mid = Math.floor((min + max) / 2)
    const guess = String(mid)
    authGuesses++
    const result = await authenticateWithStatus(ns, port, dnet, host, guess, `guess ${guess}`, authGuesses)
    if (result.success) {
      return { password: guess, authenticated: true, authGuesses }
    }

    const feedback = (result.data === "Higher" || result.data === "Lower") ? result.data : null
    if (feedback === "Lower") {
      max = mid - 1
    } else if (feedback === "Higher") {
      min = mid + 1
    } else {
      return { password: null, authenticated: false, authGuesses }
    }
  }

  return { password: null, authenticated: false, authGuesses }
}

async function authenticateDeepGreen(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  length: number,
  format: DarknetPasswordFormat
): Promise<{ password: string | null; authenticated: boolean; authGuesses: number }> {
  const initial = generateMastermindCandidates(length, mastermindCharset(format))
  if (!initial) {
    return { password: null, authenticated: false, authGuesses: 0 }
  }

  let candidates = initial
  let authGuesses = 0

  while (candidates.length > 0) {
    const guess = pickMastermindGuess(candidates)
    authGuesses++
    const detail = `${candidates.length} candidate(s)`
    const result = await authenticateWithStatus(ns, port, dnet, host, guess, detail, authGuesses)
    if (result.success) {
      return { password: guess, authenticated: true, authGuesses }
    }

    const data = typeof result.data === "string" ? result.data : ""
    const feedback = parseMastermindFeedback(data)
    if (!feedback) {
      return { password: null, authenticated: false, authGuesses }
    }

    candidates = candidates.filter((secret) => {
      const fb = mastermindFeedback(secret, guess)
      return fb.exact === feedback.exact && fb.misplaced === feedback.misplaced
    })
  }

  return { password: null, authenticated: false, authGuesses }
}

// ---- Factori-Os ----

/** Primes in ascending order, used as divisibility probes. */
const FACTORIOS_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97]

/**
 * Parse boolean-like auth response data (true/"true" / false/"false").
 * Used by Factori-Os solver — reads from authenticate() response, no heartbleed.
 */
function parseBoolFeedback(data: unknown): boolean | null {
  if (data === true || data === "true") return true
  if (data === false || data === "false") return false
  return null
}

async function authenticateFactoriOs(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  length: number
): Promise<{ password: string | null; authenticated: boolean; authGuesses: number }> {
  let product = 1
  let authGuesses = 0

  for (const prime of FACTORIOS_PRIMES) {
    // Skip primes too large to be a factor of a length-N number
    const primeStr = String(prime)
    if (primeStr.length > length) break

    authGuesses++
    const result = await authenticateWithStatus(ns, port, dnet, host, primeStr, `prime ${prime}`, authGuesses)
    if (result.success) {
      return { password: primeStr, authenticated: true, authGuesses }
    }

    const feedback = parseBoolFeedback(result.data)
    if (feedback === null) {
      return { password: null, authenticated: false, authGuesses }
    }

    if (feedback) {
      // This prime divides the password — find the highest power
      let power = prime
      let next = prime * prime
      while (String(next).length <= length) {
        const nextStr = String(next)
        authGuesses++
        const powerResult = await authenticateWithStatus(ns, port, dnet, host, nextStr, `pow ${next}`, authGuesses)
        if (powerResult.success) {
          return { password: nextStr, authenticated: true, authGuesses }
        }

        const powerFeedback = parseBoolFeedback(powerResult.data)
        if (powerFeedback) {
          power = next
          next *= prime
        } else {
          break
        }
      }
      product *= power
      // If product already exceeds the digit limit, bail
      if (String(product).length > length) {
        return { password: null, authenticated: false, authGuesses }
      }
    }
    // feedback === false: prime does not divide, continue
  }

  const password = String(product)
  if (password.length !== length) {
    return { password: null, authenticated: false, authGuesses }
  }

  authGuesses++
  const finalResult = await authenticateWithStatus(ns, port, dnet, host, password, "factor product", authGuesses)
  return {
    password: finalResult.success ? password : null,
    authenticated: finalResult.success,
    authGuesses,
  }
}

// ---- KingOfTheHill ----

/**
 * KingOfTheHill uses altitude = peak × exp(-k × (guess - password)²)
 * where k may vary per server instance (0.25 to 200+ observed).
 *
 * Strategy: scan the full numeric range, collect altitudes, and pick the maximum.
 * The altitude function is unimodal (peak at the password), so the max-altitude
 * guess is closest to the password. Auth at that point and its neighbors.
 *
 * For 2-digit passwords (max 90 probes) this is fast. For 3+ digit, we scan
 * coarsely (~20 probes) then fine-scan around the maximum.
 */
async function authenticateKingOfTheHill(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  length: number
): Promise<{ password: string | null; authenticated: boolean; authGuesses: number }> {
  const min = 10 ** (length - 1)
  const max = 10 ** length - 1
  const rangeSize = max - min + 1
  let authGuesses = 0

  // For small ranges, scan every value. For larger, scan coarsely.
  const step = rangeSize <= 100 ? 1 : Math.max(1, Math.floor(rangeSize / 20))
  let bestGuess = min
  let bestAlt = -Infinity
  let peak = 10000

  for (let g = min; g <= max; g += step) {
    const gStr = String(g)
    authGuesses++
    const result = await authenticateWithStatus(ns, port, dnet, host, gStr, `scan ${g}`, authGuesses)
    if (result.success) {
      return { password: gStr, authenticated: true, authGuesses }
    }

    const altitude = typeof result.data === "number" ? result.data : 0
    if (altitude > bestAlt) {
      bestAlt = altitude
      bestGuess = g
    }

    // Early exit: if altitude is already at peak
    if (altitude >= peak) {
      const exactStr = String(g)
      authGuesses++
      const exactResult = await authenticateWithStatus(ns, port, dnet, host, exactStr, `final ${g}`, authGuesses)
      if (exactResult.success) {
        return { password: exactStr, authenticated: true, authGuesses }
      }
    }
  }

  // If the maximum altitude is 0 everywhere, k is too large for this step size.
  // Fall back to step=1 full scan (only practical for ~200 or fewer values).
  if (bestAlt <= 0) {
    for (let g = min; g <= max && authGuesses < 200; g++) {
      // skip values already probed
      if ((g - min) % step === 0) continue
      const gStr = String(g)
      authGuesses++
      const result = await authenticateWithStatus(ns, port, dnet, host, gStr, `fine ${g}`, authGuesses)
      if (result.success) {
        return { password: gStr, authenticated: true, authGuesses }
      }
      const altitude = typeof result.data === "number" ? result.data : 0
      if (altitude > bestAlt) {
        bestAlt = altitude
        bestGuess = g
      }
    }
    if (bestAlt <= 0) {
      return { password: null, authenticated: false, authGuesses }
    }
  }

  // Try best guess and its immediate neighbors (password is at the maximum)
  for (const delta of [0, -1, 1, -2, 2]) {
    const candidate = bestGuess + delta
    if (candidate < min || candidate > max) continue
    if (delta !== 0) {
      authGuesses++
    }
    const cStr = String(candidate)
    const cResult = await authenticateWithStatus(ns, port, dnet, host, cStr, `candidate ${candidate}`, authGuesses)
    if (cResult.success) {
      return { password: cStr, authenticated: true, authGuesses }
    }
  }

  return { password: null, authenticated: false, authGuesses }
}

// ---- RateMyPix.Auth ----

/**
 * RateMyPix returns 🌶️ count = number of digits in the correct position.
 *
 * Strategy:
 *   1. Frequency phase: probe 00000-99999 (10 auths) to learn digit multiset
 *   2. Permutation phase: generate distinct permutations, try each.
 *      Each wrong guess returns the exact match count, pruning candidates.
 */
async function authenticateRateMyPix(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  length: number
): Promise<{ password: string | null; authenticated: boolean; authGuesses: number }> {
  let authGuesses = 0

  // ---- Phase 1: learn digit frequencies ----
  const freq = new Map<string, number>()
  for (let digit = 0; digit <= 9; digit++) {
    const guess = String(digit).repeat(length)
    authGuesses++
    const result = await authenticateWithStatus(ns, port, dnet, host, guess, `freq ${digit}`, authGuesses)
    if (result.success) {
      return { password: guess, authenticated: true, authGuesses }
    }
    // Count pepper emoji from auth response data (🌶️ is 2 code units in JS)
    const data = typeof result.data === "string" ? result.data : ""
    const count = (data.match(/🌶/g) ?? []).length
    if (count > 0) {
      freq.set(String(digit), count)
    }
  }

  // Sanity: total count should equal length
  const totalCount = [...freq.values()].reduce((a, b) => a + b, 0)
  if (totalCount !== length) {
    return { password: null, authenticated: false, authGuesses }
  }

  // ---- Phase 2: generate and test permutations with pruning ----
  let candidates = generatePermutations(freq, length)
  if (candidates.length === 0) {
    return { password: null, authenticated: false, authGuesses }
  }

  while (candidates.length > 0) {
    const guess = candidates[0]!
    authGuesses++
    const detail = `${candidates.length} candidate(s)`
    const result = await authenticateWithStatus(ns, port, dnet, host, guess, detail, authGuesses)
    if (result.success) {
      return { password: guess, authenticated: true, authGuesses }
    }

    const data = typeof result.data === "string" ? result.data : ""
    const count = (data.match(/🌶/g) ?? []).length

    // Prune: keep only candidates that would produce the same match count
    candidates = candidates.filter((candidate) => {
      let matches = 0
      for (let i = 0; i < length; i++) {
        if (candidate[i] === guess[i]) matches++
      }
      return matches === count
    })
  }

  return { password: null, authenticated: false, authGuesses }
}

/** Generate all distinct strings of `length` digits from the given frequency map. */
function generatePermutations(freq: Map<string, number>, length: number): string[] {
  const uniqueDigits = [...freq.keys()].sort()
  const remaining = new Map(freq)
  const out: string[] = []

  function build(prefix: string): void {
    if (prefix.length === length) {
      out.push(prefix)
      return
    }
    for (const digit of uniqueDigits) {
      const left = remaining.get(digit) ?? 0
      if (left <= 0) continue
      remaining.set(digit, left - 1)
      build(prefix + digit)
      remaining.set(digit, left)
    }
  }

  build("")
  return out
}

// ---- OpenWebAccessPoint ----

/**
 * OpenWebAccessPoint: submit empty password, the auth response's data
 * field contains a leak like "cryptosys:2680". Extract the digits.
 *
 * Example response data:
 *   "zxcvbnm76 There's definitely a 6 a cryptosys:2680 nd a 8..."
 *   -> password = "2680"
 */
async function authenticateOpenWebAccessPoint(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string
): Promise<{ password: string | null; authenticated: boolean; authGuesses: number }> {
  let authGuesses = 0

  // Submit empty password
  authGuesses++
  const emptyResult = await authenticateWithStatus(ns, port, dnet, host, "", "empty probe", authGuesses)
  if (emptyResult.success) {
    return { password: "", authenticated: true, authGuesses }
  }

  // Extract password from the auth response data
  const data = typeof emptyResult.data === "string" ? emptyResult.data : ""
  const match = data.match(/([a-zA-Z0-9_-]+):(\d+)/)
  if (!match) {
    return { password: null, authenticated: false, authGuesses }
  }

  const password = match[2]!
  authGuesses++
  const finalResult = await authenticateWithStatus(ns, port, dnet, host, password, `final ${password}`, authGuesses)
  return {
    password: finalResult.success ? password : null,
    authenticated: finalResult.success,
    authGuesses,
  }
}

export function solveDarknetPassword(input: DarknetAuthSolverInput): { password: string | null } {
  const zeroLogon = solveZeroLogon(input)
  if (zeroLogon !== null) {
    return { password: zeroLogon }
  }

  const freshInstall = solveFreshInstall(input)
  if (freshInstall !== null) {
    return { password: freshInstall }
  }

  const cloudBlare = solveCloudBlare(input)
  if (cloudBlare !== null) {
    return { password: cloudBlare }
  }

  const deskMemo = solveDeskMemo(input)
  if (deskMemo !== null) {
    return { password: deskMemo }
  }

  const bellaCuore = solveBellaCuore(input)
  if (bellaCuore !== null) {
    return { password: bellaCuore }
  }

  const octantVoxel = solveOctantVoxel(input)
  if (octantVoxel !== null) {
    return { password: octantVoxel }
  }

  // Single-shot Laika4 — for length 4 there are 2 candidates (fido, spot),
  // but the worker's tryAuthNeighbor branch handles the full sequence.
  const laika4 = solveLaika4(input)
  if (laika4 !== null) {
    return { password: laika4 }
  }

  return { password: null }
}

export function isFreshInstallNumeric(details: DarknetServerDetailsForFormulas): boolean {
  return details.modelId === "FreshInstall_1.0" && details.passwordFormat === "numeric"
}

export async function scrapeHeartbleedLogs(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string
): Promise<string[]> {
  writeCrawlStatus(ns, port, {
    workerHost: ns.getHostname(),
    targetHost: host,
    phase: "heartbleed",
    etaMs: getHeartbleedEtaMs(ns, dnet, host),
    detail: "scraping logs",
  })
  const result = await dnet.heartbleed(host, { peek: true })
  return result.success ? result.logs : []
}

export function solverInputFromDetails(
  details: DarknetServerDetailsForFormulas
): DarknetAuthSolverInput {
  return {
    modelId: details.modelId,
    passwordFormat: details.passwordFormat,
    passwordHint: details.passwordHint,
    passwordLength: details.passwordLength,
    data: details.data,
    scrapedLogs: [],
  }
}

// --- combined auth flow ---

async function tryDarkwebArchivePasswords(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  details: DarknetServerDetailsForFormulas
): Promise<{ password: string | null; authenticated: boolean; authGuesses: number } | null> {
  const candidates = darkwebPasswordCandidates(details.passwordLength, details.passwordFormat)
  if (candidates.length === 0) {
    return null
  }
  const auth = await authenticateCandidates(ns, port, dnet, host, candidates)
  if (!auth.authenticated && auth.password === null) {
    return null
  }
  return {
    password: auth.password,
    authenticated: auth.authenticated,
    authGuesses: auth.authGuesses,
  }
}

export async function tryAuthNeighbor(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  neighbor: string,
  knownPassword: string | null = null
): Promise<{ password: string | null; authenticated: boolean | null; authGuesses: number | null }> {
  const details = dnet.getServerDetails(neighbor)

  if (details.hasSession) {
    return { password: null, authenticated: true, authGuesses: 0 }
  }

  if (knownPassword != null) {
    if (tryConnectToSession(dnet, neighbor, knownPassword)) {
      return { password: knownPassword, authenticated: true, authGuesses: 0 }
    }
    const cached = await authenticateWithStatus(ns, port, dnet, neighbor, knownPassword, "cached", 1)
    if (cached.success) {
      return { password: knownPassword, authenticated: true, authGuesses: 1 }
    }
  }

  if (isNilModel(details)) {
    const nil = await authenticateNil(ns, port, dnet, neighbor, details.passwordLength)
    return {
      password: nil.password,
      authenticated: nil.authenticated ? true : nil.password !== null ? false : null,
      authGuesses: nil.authGuesses,
    }
  }

  if (isFreshInstallNumeric(details)) {
    const scrapedLogs = await scrapeHeartbleedLogs(ns, port, dnet, neighbor)
    const candidates = freshInstallNumericCandidates(details.passwordLength, scrapedLogs)
    const auth = await authenticateCandidates(ns, port, dnet, neighbor, candidates)
    return {
      password: auth.password,
      authenticated: auth.authenticated ? true : auth.password !== null ? false : null,
      authGuesses: auth.authGuesses,
    }
  }

  if (isPhp54Model(details)) {
    const candidates = php54NumericCandidates(neighbor, details.passwordHint, details.passwordLength)
    if (candidates.length === 0) {
      return { password: null, authenticated: null, authGuesses: null }
    }
    const auth = await authenticateCandidates(ns, port, dnet, neighbor, candidates)
    return {
      password: auth.password,
      authenticated: auth.authenticated ? true : false,
      authGuesses: auth.authGuesses,
    }
  }

  if (isAccountsManagerGuessNumber(details)) {
    const maxExclusive = parseGuessNumberMax(details.passwordHint)!
    const auth = await authenticateAccountsManager(ns, port, dnet, neighbor, maxExclusive)
    return {
      password: auth.password,
      authenticated: auth.authenticated ? true : auth.password !== null ? false : null,
      authGuesses: auth.authGuesses,
    }
  }

  if (isDeepGreenModel(details)) {
    // Disabled — explicit solvers only
    // const archiveAuth = await tryDarkwebArchivePasswords(ns, port, dnet, neighbor, details)
    // if (archiveAuth?.authenticated) {
    //   return {
    //     password: archiveAuth.password,
    //     authenticated: true,
    //     authGuesses: archiveAuth.authGuesses,
    //   }
    // }

    const scrapedLogs = await scrapeHeartbleedLogs(ns, port, dnet, neighbor)
    const logCandidates = deepGreenLogPermutationCandidates(
      scrapedLogs,
      details.passwordLength,
      details.passwordFormat
    )
    if (logCandidates != null) {
      const auth = await authenticateCandidates(ns, port, dnet, neighbor, logCandidates)
      return {
        password: auth.password,
        authenticated: auth.authenticated ? true : auth.password !== null ? false : null,
        authGuesses: auth.authGuesses,
      }
    }

    const auth = await authenticateDeepGreen(
      ns,
      port,
      dnet,
      neighbor,
      details.passwordLength,
      details.passwordFormat
    )
    return {
      password: auth.password,
      authenticated: auth.authenticated ? true : auth.password !== null ? false : null,
      authGuesses: auth.authGuesses,
    }
  }

  if (isLaika4Model(details)) {
    const candidates = laika4Candidates(details.passwordLength)
    if (candidates.length === 0) {
      return { password: null, authenticated: null, authGuesses: null }
    }
    const auth = await authenticateCandidates(ns, port, dnet, neighbor, candidates)
    return {
      password: auth.password,
      authenticated: auth.authenticated ? true : false,
      authGuesses: auth.authGuesses,
    }
  }

  if (isFactoriOsModel(details)) {
    const auth = await authenticateFactoriOs(ns, port, dnet, neighbor, details.passwordLength)
    return {
      password: auth.password,
      authenticated: auth.authenticated ? true : auth.password !== null ? false : null,
      authGuesses: auth.authGuesses,
    }
  }

  if (isKingOfTheHillModel(details)) {
    const auth = await authenticateKingOfTheHill(ns, port, dnet, neighbor, details.passwordLength)
    return {
      password: auth.password,
      authenticated: auth.authenticated ? true : auth.password !== null ? false : null,
      authGuesses: auth.authGuesses,
    }
  }

  if (isRateMyPixModel(details)) {
    const auth = await authenticateRateMyPix(ns, port, dnet, neighbor, details.passwordLength)
    return {
      password: auth.password,
      authenticated: auth.authenticated ? true : auth.password !== null ? false : null,
      authGuesses: auth.authGuesses,
    }
  }

  if (isOpenWebAccessPointModel(details)) {
    const auth = await authenticateOpenWebAccessPoint(ns, port, dnet, neighbor)
    return {
      password: auth.password,
      authenticated: auth.authenticated ? true : auth.password !== null ? false : null,
      authGuesses: auth.authGuesses,
    }
  }

  const { password } = solveDarknetPassword(solverInputFromDetails(details))

  if (password !== null) {
    const result = await authenticateWithStatus(ns, port, dnet, neighbor, password, null, 1)
    return { password, authenticated: result.success, authGuesses: 1 }
  }

  // Disabled — explicit solvers only
  // const archiveAuth = await tryDarkwebArchivePasswords(ns, port, dnet, neighbor, details)
  // if (archiveAuth != null) {
  //   return {
  //     password: archiveAuth.password,
  //     authenticated: archiveAuth.authenticated ? true : archiveAuth.password !== null ? false : null,
  //     authGuesses: archiveAuth.authGuesses,
  //   }
  // }

  return { password: null, authenticated: null, authGuesses: null }
}
