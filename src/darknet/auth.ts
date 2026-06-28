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
  DARKWEB_COMMON_PASSWORDS,
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

function isProverFloModel(details: DarknetServerDetailsForFormulas): boolean {
  return details.modelId === "Pr0verFl0"
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
const LABYRINTH_MODEL = "(The Labyrinth)"
const EUROZONE_MODEL = "EuroZone Free"
const TIMING_ATTACK_MODEL = "2G_cellular"
const TOPPASS_MODEL = "TopPass"


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

const LARGE_PRIMES = [
  1069, 1409, 1471, 1567, 1597, 1601, 1697, 1747, 1801, 1889, 1979, 1999, 2063, 2207, 2371, 2503, 2539, 2693, 2741,
  2753, 2801, 2819, 2837, 2909, 2939, 3169, 3389, 3571, 3761, 3881, 4217, 4289, 4547, 4729, 4789, 4877, 4943, 4951,
  4957, 5393, 5417, 5419, 5441, 5519, 5527, 5647, 5779, 5881, 6007, 6089, 6133, 6389, 6451, 6469, 6547, 6661, 6719,
  6841, 7103, 7549, 7559, 7573, 7691, 7753, 7867, 8053, 8081, 8221, 8329, 8599, 8677, 8761, 8839, 8963, 9103, 9199,
  9343, 9467, 9551, 9601, 9739, 9749, 9859,
]
const DEEP_GREEN_CLUE_LINE_RE = /remember|must use/i
/** Keep N low enough that pickMastermindGuess (O(N²)) won't freeze the game thread. */
const MAX_MASTERMIND_CANDIDATES = 10_000

/** Don't run exhaustive minimax above this many candidates — use a simpler guess. */
const MINIMAX_THRESHOLD = 500

function isDeepGreenModel(details: DarknetServerDetailsForFormulas): boolean {
  return details.modelId === DEEP_GREEN_MODEL
}

function isLabyrinthModel(details: DarknetServerDetailsForFormulas): boolean {
  return details.modelId === LABYRINTH_MODEL
}

function isEuroZoneModel(details: DarknetServerDetailsForFormulas): boolean {
  return details.modelId === EUROZONE_MODEL
}

function isTimingAttackModel(details: DarknetServerDetailsForFormulas): boolean {
  return details.modelId === TIMING_ATTACK_MODEL
}

function isTopPassModel(details: DarknetServerDetailsForFormulas): boolean {
  return details.modelId === TOPPASS_MODEL
}

function isMathMLModel(details: DarknetServerDetailsForFormulas): boolean {
  return details.modelId === "MathML"
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
  // Exhaustive minimax is O(N²); use random guess above threshold to avoid freezing
  if (candidates.length > MINIMAX_THRESHOLD) {
    return candidates[Math.floor(Math.random() * candidates.length)]
  }
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
    (details.passwordFormat === "numeric" || details.passwordFormat === "alphabetic") &&
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

/**
 * Reads the most recent auth feedback for a specific guess from heartbleed logs.
 * Non-labyrinth darknet servers strip `data` from the `authenticate` response,
 * so we must fall back to heartbleed to extract interactive solver feedback.
 */
async function readLatestAuthFeedback(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  passwordAttempted: string
): Promise<string | null> {
  const entry = await readLatestAuthLog(ns, port, dnet, host, passwordAttempted)
  return entry !== null && typeof entry.data === "string" ? entry.data : null
}

/** Returns the full parsed heartbleed log entry (with message + data) for a specific guess. */
async function readLatestAuthLog(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  passwordAttempted: string
): Promise<{ message: string; data: unknown } | null> {
  const logs = await scrapeHeartbleedLogs(ns, port, dnet, host)
  for (const entry of logs) {
    try {
      const parsed = JSON.parse(entry)
      if (String(parsed.passwordAttempted) === passwordAttempted) {
        return { message: String(parsed.message ?? ""), data: parsed.data }
      }
    } catch {
      // noise entry, skip
    }
  }
  return null
}

async function authenticateNil(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  length: number,
  format: DarknetPasswordFormat
): Promise<{ password: string | null; authenticated: boolean; authGuesses: number }> {
  const chars: (string | null)[] = Array.from({ length }, () => null)
  let authGuesses = 0

  const charset = format === "alphabetic"
    ? "abcdefghijklmnopqrstuvwxyz"
    : "0123456789"

  for (const ch of charset) {
    authGuesses++
    const guess = ch.repeat(length)
    const detail = `NIL char ${ch}`
    const result = await authenticateWithStatus(ns, port, dnet, host, guess, detail, authGuesses)
    if (result.success) {
      return { password: guess, authenticated: true, authGuesses }
    }

    const data = await readLatestAuthFeedback(ns, port, dnet, host, guess)
    const feedback = data != null ? parseNilFeedback(data, length) : null
    if (feedback) {
      for (let i = 0; i < length; i++) {
        if (feedback[i]) {
          chars[i] = ch
        }
      }
    }

    if (chars.every((d) => d !== null)) {
      break
    }
  }

  if (!chars.every((d) => d !== null)) {
    return { password: null, authenticated: false, authGuesses }
  }

  authGuesses++
  const password = chars.join("")
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

    // Non-labyrinth servers strip `data` from authenticate responses;
    // read feedback from the heartbleed log entry for this attempt.
    const feedback = await readLatestAuthFeedback(ns, port, dnet, host, guess)
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

    const data = await readLatestAuthFeedback(ns, port, dnet, host, guess)
    const feedback = data != null ? parseMastermindFeedback(data) : null
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
 * Factori-Os reads this via heartbleed (non-labyrinth servers strip data from authenticate).
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

    const feedbackData = await readLatestAuthFeedback(ns, port, dnet, host, primeStr)
    const feedback = parseBoolFeedback(feedbackData)
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

        const powerData = await readLatestAuthFeedback(ns, port, dnet, host, nextStr)
        const powerFeedback = parseBoolFeedback(powerData)
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
 * where k varies per server instance (0.25 to 200+ observed).
 *
 * Strategy: binary search using altitude comparison.
 * At any point x: altitude(x+1) > altitude(x) means the password is to the right.
 * This holds for any k because the Gaussian is unimodal and symmetric.
 *
 * Underflow: when k is large, both probe points may give altitude 0.
 * In that case we expand the probe window exponentially until non-zero is found,
 * then reset bounds around the non-zero region and continue binary search.
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
  let lo = min
  let hi = max
  let authGuesses = 0

  // Cache altitude results to avoid re-probing
  const cache = new Map<number, number>()

  async function probe(g: number): Promise<number> {
    if (cache.has(g)) return cache.get(g)!
    const gStr = String(g)
    authGuesses++
    const result = await authenticateWithStatus(ns, port, dnet, host, gStr, `bin ${g}`, authGuesses)
    if (result.success) {
      cache.set(g, NaN) // sentinel: correct password
      return NaN
    }
    const data = await readLatestAuthFeedback(ns, port, dnet, host, gStr)
    const alt = typeof data === "string" ? Number(data) : 0
    cache.set(g, alt)
    return alt
  }

  while (lo < hi) {
    // When the interval is small enough, try every remaining value
    if (hi - lo <= 2) {
      for (let g = lo; g <= hi; g++) {
        const alt = await probe(g)
        if (Number.isNaN(alt)) return { password: String(g), authenticated: true, authGuesses }
      }
      // All failed — pick the one with highest altitude and its neighbors
      let bestG = lo
      let bestAlt = cache.get(lo) ?? 0
      for (let g = lo; g <= hi; g++) {
        const alt = cache.get(g) ?? 0
        if (alt > bestAlt) { bestAlt = alt; bestG = g }
      }
      for (const d of [0, -1, 1, -2, 2]) {
        const c = bestG + d
        if (c < min || c > max) continue
        if (cache.has(c) && !Number.isNaN(cache.get(c))) continue // already probed, not the answer
        const cStr = String(c)
        authGuesses++
        const r = await authenticateWithStatus(ns, port, dnet, host, cStr, `nbr ${c}`, authGuesses)
        if (r.success) return { password: cStr, authenticated: true, authGuesses }
      }
      return { password: null, authenticated: false, authGuesses }
    }

    const mid = Math.floor((lo + hi) / 2)
    const altMid = await probe(mid)
    if (Number.isNaN(altMid)) return { password: String(mid), authenticated: true, authGuesses }

    const altNext = await probe(mid + 1)
    if (Number.isNaN(altNext)) return { password: String(mid + 1), authenticated: true, authGuesses }

    if (altMid === 0 && altNext === 0) {
      // Both underflowed — expand outward exponentially to find non-zero region
      let found = false
      for (let exp = 1; exp <= hi - lo && !found; exp *= 2) {
        // Probe leftward from mid
        for (let g = mid - exp; g >= lo; g -= exp) {
          const alt = await probe(g)
          if (Number.isNaN(alt)) return { password: String(g), authenticated: true, authGuesses }
          if (alt > 0) {
            // Found non-zero on the left — peak is left of mid, reset hi
            hi = mid
            found = true
            break
          }
        }
        if (found) break
        // Probe rightward from mid+1
        for (let g = mid + 1 + exp; g <= hi; g += exp) {
          const alt = await probe(g)
          if (Number.isNaN(alt)) return { password: String(g), authenticated: true, authGuesses }
          if (alt > 0) {
            // Found non-zero on the right — peak is right of mid, reset lo
            lo = mid
            found = true
            break
          }
        }
      }
      if (!found) {
        // Entire range underflows — step through every value (last resort)
        for (let g = lo; g <= hi; g++) {
          if (cache.has(g)) continue
          const alt = await probe(g)
          if (Number.isNaN(alt)) return { password: String(g), authenticated: true, authGuesses }
        }
        // Find max altitude
        let bestG = lo
        let bestAlt = cache.get(lo) ?? 0
        for (let g = lo; g <= hi; g++) {
          const alt = cache.get(g) ?? 0
          if (alt > bestAlt) { bestAlt = alt; bestG = g }
        }
        if (bestAlt <= 0) return { password: null, authenticated: false, authGuesses }
        // Try around the max
        for (const d of [0, -1, 1, -2, 2]) {
          const c = bestG + d
          if (c < min || c > max) continue
          if (cache.has(c) && !Number.isNaN(cache.get(c))) continue
          const cStr = String(c)
          authGuesses++
          const r = await authenticateWithStatus(ns, port, dnet, host, cStr, `fallback ${c}`, authGuesses)
          if (r.success) return { password: cStr, authenticated: true, authGuesses }
        }
        return { password: null, authenticated: false, authGuesses }
      }
      continue
    }

    // Binary search: altitude(mid+1) > altitude(mid) → password > mid
    if (altNext > altMid) {
      lo = mid + 1
    } else if (altNext < altMid) {
      hi = mid
    } else {
      // Equal altitudes → symmetric around mid+0.5 → try both
      const midStr = String(mid)
      authGuesses++
      const r = await authenticateWithStatus(ns, port, dnet, host, midStr, `tie ${mid}`, authGuesses)
      if (r.success) return { password: midStr, authenticated: true, authGuesses }
      const nextStr = String(mid + 1)
      authGuesses++
      const r2 = await authenticateWithStatus(ns, port, dnet, host, nextStr, `tie ${mid + 1}`, authGuesses)
      if (r2.success) return { password: nextStr, authenticated: true, authGuesses }
      return { password: null, authenticated: false, authGuesses }
    }
  }

  // lo == hi — final try
  const finalStr = String(lo)
  authGuesses++
  const r = await authenticateWithStatus(ns, port, dnet, host, finalStr, `final ${lo}`, authGuesses)
  return { password: r.success ? finalStr : null, authenticated: r.success, authGuesses }
}

// ---- RateMyPix.Auth ----

/**
 * RateMyPix returns 🌶️ count = number of characters in the correct position.
 *
 * Strategy:
 *   1. Frequency phase: probe all-same-character guesses (10-62 auths depending on format)
 *      to learn which characters are in the password and their counts.
 *   2. Permutation phase: generate distinct permutations, try each.
 *      Each wrong guess returns the exact match count, pruning candidates.
 */
async function authenticateRateMyPix(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  length: number,
  format: DarknetPasswordFormat
): Promise<{ password: string | null; authenticated: boolean; authGuesses: number }> {
  let authGuesses = 0

  // ---- Phase 1: learn character frequencies ----
  // RateMyPix auth response data: pepper emoji count = number of correct position matches.
  // Submit a guess of all the same character; the pepper count = frequency of that character.
  let charset: string
  if (format === "alphabetic") {
    charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  } else if (format === "alphanumeric") {
    charset = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  } else {
    charset = "0123456789"
  }
  const freq = new Map<string, number>()
  for (const ch of charset) {
    const guess = ch.repeat(length)
    authGuesses++
    const result = await authenticateWithStatus(ns, port, dnet, host, guess, `freq ${ch}`, authGuesses)
    if (result.success) {
      return { password: guess, authenticated: true, authGuesses }
    }
    const data = await readLatestAuthFeedback(ns, port, dnet, host, guess)
    const count = (data?.match(/🌶/g) ?? []).length
    if (count > 0) {
      freq.set(ch, count)
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

    const phase2Data = await readLatestAuthFeedback(ns, port, dnet, host, guess)
    const pruneCount = (phase2Data?.match(/🌶/g) ?? []).length

    // Prune: keep only candidates that would produce the same match count
    candidates = candidates.filter((candidate) => {
      let matches = 0
      for (let i = 0; i < length; i++) {
        if (candidate[i] === guess[i]) matches++
      }
      return matches === pruneCount
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

// ---- TimingAttack (2G_cellular) ----

/**
 * TimingAttack: the auth response message contains the index of the first
 * mismatching character. We deduce the password one position at a time.
 *
 * Strategy: for position i, try digits 0-9 (with known digits fixed and 0s
 * for unknown positions). The mismatch index tells us when we've found the
 * correct digit — if the mismatch index moves past i, digit at position i
 * is correct.
 */
async function authenticateTimingAttack(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  length: number
): Promise<{ password: string | null; authenticated: boolean; authGuesses: number }> {
  let authGuesses = 0
  const digits: (string | null)[] = Array.from({ length }, () => null)

  for (let pos = 0; pos < length; pos++) {
    let found = false
    for (let d = 0; d <= 9; d++) {
      // Build guess: known digits + this candidate + zeros for the rest
      let guess = ""
      for (let j = 0; j < length; j++) {
        if (j < pos) guess += digits[j]!
        else if (j === pos) guess += String(d)
        else guess += "0"
      }
      authGuesses++
      const result = await authenticateWithStatus(ns, port, dnet, host, guess, `pos ${pos} try ${d}`, authGuesses)
      if (result.success) {
        return { password: guess, authenticated: true, authGuesses }
      }

      const log = await readLatestAuthLog(ns, port, dnet, host, guess)
      if (!log) continue

      // Parse mismatch index from message: "Found a mismatch while checking each character (2)"
      const match = log.message.match(/Found a mismatch while checking each character \((\d+)\)/)
      if (!match) continue
      const mismatchIdx = Number(match[1])

      if (mismatchIdx !== pos) {
        // Mismatch is at a later position → digit at `pos` is correct
        digits[pos] = String(d)
        found = true
        break
      }
      // mismatchIdx === pos → digit at `pos` is wrong, try next digit
    }
    if (!found) {
      return { password: null, authenticated: false, authGuesses }
    }
  }

  const password = digits.join("")
  authGuesses++
  const finalResult = await authenticateWithStatus(ns, port, dnet, host, password, "final", authGuesses)
  return { password, authenticated: finalResult.success, authGuesses }
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

  // Submit hostname as password to get the data leak in the response
  const probe = host
  authGuesses++
  const probeResult = await authenticateWithStatus(ns, port, dnet, host, probe, `probe ${host}`, authGuesses)
  if (probeResult.success) {
    return { password: probe, authenticated: true, authGuesses }
  }

  // Extract password from the auth response data (via heartbleed — non-labyrinth)
  const rawData = await readLatestAuthFeedback(ns, port, dnet, host, probe)
  const data = rawData ?? ""
  // Look for this server's hostname followed by colon, the password is the rest
  const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(escapedHost + `:(\\S+)`)
  const match = data.match(regex)
  if (!match) {
    return { password: null, authenticated: false, authGuesses }
  }

  const password = match[1]!
  authGuesses++
  const finalResult = await authenticateWithStatus(ns, port, dnet, host, password, `final ${password}`, authGuesses)
  return {
    password: finalResult.success ? password : null,
    authenticated: finalResult.success,
    authGuesses,
  }
}

// ---- Labyrinth maze solver ----

const LAB_DIRS = [
  { name: "n", dx: 0, dy: -2, field: "north" as const },
  { name: "e", dx: 2, dy: 0, field: "east" as const },
  { name: "s", dx: 0, dy: 2, field: "south" as const },
  { name: "w", dx: -2, dy: 0, field: "west" as const },
]
const LAB_OPPOSITE: Record<string, string> = { n: "s", s: "n", e: "w", w: "e" }

async function authenticateLabyrinth(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
): Promise<{ password: string | null; authenticated: boolean; authGuesses: number }> {
  let authGuesses = 0
  const visited = new Set<string>()
  const path: string[] = [] // stack of directions taken (for backtracking)

  while (true) {
    // Get current position and open directions
    const report = dnet.labreport ? await dnet.labreport() : null
    if (!report || !report.success) {
      return { password: null, authenticated: false, authGuesses }
    }
    const [x, y] = report.coords
    const key = `${x},${y}`
    visited.add(key)

    // Find an unvisited direction to explore
    let chosenDir: typeof LAB_DIRS[number] | null = null
    for (const dir of LAB_DIRS) {
      if (!report[dir.field]) continue
      const nKey = `${x + dir.dx},${y + dir.dy}`
      if (!visited.has(nKey)) {
        chosenDir = dir
        break
      }
    }

    if (chosenDir) {
      // Move forward into unexplored territory
      authGuesses++
      const result = await authenticateWithStatus(
        ns, port, dnet, host, chosenDir.name, `lab ${chosenDir.name}`, authGuesses,
      )
      if (result.success) {
        return { password: typeof result.data === "string" ? result.data : null, authenticated: true, authGuesses }
      }
      path.push(chosenDir.name)
    } else if (path.length > 0) {
      // Backtrack one step
      const prev = path.pop()!
      authGuesses++
      const result = await authenticateWithStatus(
        ns, port, dnet, host, LAB_OPPOSITE[prev], `back ${LAB_OPPOSITE[prev]}`, authGuesses,
      )
      if (result.success) {
        return { password: typeof result.data === "string" ? result.data : null, authenticated: true, authGuesses }
      }
    } else {
      // Explored entire maze without finding the endpoint
      return { password: null, authenticated: false, authGuesses }
    }
  }
}

// ---- MathML expression evaluator ----

function cleanMathExpression(expression: string): string {
  return expression
    .replaceAll("ҳ", "*")
    .replaceAll("÷", "/")
    .replaceAll("➕", "+")
    .replaceAll("➖", "-")
    .replaceAll("ns.exit(),", "")
    .split(",")[0]
}

function evaluateMathExpression(expression: string): number {
  const tokens = cleanMathExpression(expression).split("")

  // Resolve parentheses recursively
  let currentDepth = 0
  const depth = tokens.map((token) => {
    if (token === "(") { currentDepth += 1 }
    else if (token === ")") { currentDepth -= 1; return currentDepth + 1 }
    return currentDepth
  })
  const depth1Start = depth.indexOf(1)
  const firstZeroAfter = depth.indexOf(0, depth1Start)
  const depth1End = firstZeroAfter === -1 ? depth.length - 1 : firstZeroAfter - 1
  if (depth1Start !== -1) {
    const subExpression = tokens.slice(depth1Start + 1, depth1End).join("")
    const result = evaluateMathExpression(subExpression)
    tokens.splice(depth1Start, depth1End - depth1Start + 1, result.toString())
    return evaluateMathExpression(tokens.join(""))
  }

  let remaining = tokens.join("")

  // Multiplication and division, left to right
  const mulDivRe = /(-?\d*\.?\d+) *([*/]) *(-?\d*\.?\d+)/
  let match = remaining.match(mulDivRe)
  while (match) {
    const [, left, op, right] = match
    const result = op === "*" ? parseFloat(left) * parseFloat(right) : parseFloat(left) / parseFloat(right)
    const resultStr = Math.abs(result) < 0.000001 ? result.toFixed(20) : result.toString()
    remaining = remaining.replace(match[0], resultStr)
    match = remaining.match(mulDivRe)
  }

  // Addition and subtraction
  const addSubRe = /(-?\d*\.?\d+) *([+-]) *(-?\d*\.?\d+)/
  match = remaining.match(addSubRe)
  while (match) {
    const [, left, op, right] = match
    const result = op === "+" ? parseFloat(left) + parseFloat(right) : parseFloat(left) - parseFloat(right)
    remaining = remaining.replace(match[0], result.toString())
    match = remaining.match(addSubRe)
  }

  const [, leftover] = remaining.match(/(-?\d*\.?\d+)/) ?? ["", ""]
  return parseFloat(leftover)
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

  // MathML: evaluate the arithmetic expression
  if (input.modelId === "MathML" && input.data) {
    const result = evaluateMathExpression(input.data)
    if (!Number.isNaN(result) && Number.isFinite(result)) {
      const resultStr = Math.abs(result) < 0.000001 ? result.toFixed(20) : result.toString()
      if (resultStr.length === input.passwordLength) {
        return { password: resultStr }
      }
    }
  }

  // PrimeTime 2: largest prime factor of the target number.
  if (input.modelId === "PrimeTime 2" && input.data) {
    const target = Number(input.data)
    if (Number.isFinite(target) && Number.isSafeInteger(target)) {
      for (let i = LARGE_PRIMES.length - 1; i >= 0; i--) {
        if (target % LARGE_PRIMES[i]! === 0) {
          return { password: String(LARGE_PRIMES[i]) }
        }
      }
    }
  }

  // 110100100: binary → text. Data is space-separated 8-bit binary strings.
  if (input.modelId === "110100100" && input.data) {
    const chars: string[] = []
    for (const token of input.data.split(/\s+/)) {
      if (!/^[01]{8}$/.test(token)) continue
      chars.push(String.fromCharCode(parseInt(token, 2)))
    }
    if (chars.length > 0) {
      const result = chars.join("")
      if (result.length === input.passwordLength) {
        return { password: result }
      }
    }
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
    const nil = await authenticateNil(ns, port, dnet, neighbor, details.passwordLength, details.passwordFormat)
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
    const auth = await authenticateRateMyPix(ns, port, dnet, neighbor, details.passwordLength, details.passwordFormat)
    return {
      password: auth.password,
      authenticated: auth.authenticated ? true : auth.password !== null ? false : null,
      authGuesses: auth.authGuesses,
    }
  }

  if (isTimingAttackModel(details)) {
    const auth = await authenticateTimingAttack(ns, port, dnet, neighbor, details.passwordLength)
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

  if (isProverFloModel(details)) {
    // Buffer overflow: any string repeated twice matches itself.
    // The first half overflows into the comparison buffer and matches the second half.
    const half = "0".repeat(details.passwordLength)
    const overflow = half + half
    const result = await authenticateWithStatus(ns, port, dnet, neighbor, overflow, "overflow", 1)
    return {
      password: result.success ? overflow : null,
      authenticated: result.success ? true : null,
      authGuesses: 1,
    }
  }

  if (isLabyrinthModel(details)) {
    return await authenticateLabyrinth(ns, port, dnet, neighbor)
  }

  if (isEuroZoneModel(details)) {
    const candidates = EU_COUNTRIES.filter((c) => c.length === details.passwordLength)
    if (candidates.length > 0) {
      const auth = await authenticateCandidates(ns, port, dnet, neighbor, candidates)
      return {
        password: auth.password,
        authenticated: auth.authenticated ? true : false,
        authGuesses: auth.authGuesses,
      }
    }
  }

  if (isTopPassModel(details)) {
    const candidates = DARKWEB_COMMON_PASSWORDS.filter((c) => c.length === details.passwordLength)
    if (candidates.length > 0) {
      const auth = await authenticateCandidates(ns, port, dnet, neighbor, candidates)
      return {
        password: auth.password,
        authenticated: auth.authenticated ? true : false,
        authGuesses: auth.authGuesses,
      }
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
