import { NS } from "@ns"

// --- config ---

export const DARKNET_CRAWL_SCRIPT = "darknetCrawl.js"
export const DARKNET_REGISTRY_FILE = "darknet-registry.json"
export const MAX_PROBE_DEPTH = 10
export const DEFAULT_CRAWL_INTERVAL_MS = 60_000
export const CRAWL_REPORT_PORT = 45107
const WORKER_MODE_ARG = "worker"
const OPEN_CACHES_MODE_ARG = "openCaches"
export const DARKWEB = "darkweb"
/** Flat archive folder on home for copied darknet .txt files and opened .cache rewards. */
export const DARKWEB_ARCHIVE_DIR = "darkweb"

// --- types ---

type DarknetPasswordFormat = "numeric" | "alphabetic" | "alphanumeric" | "ASCII" | "unicode"

interface DarknetAuthSolverInput {
  modelId: string
  passwordFormat: DarknetPasswordFormat
  passwordHint: string
  passwordLength: number
  data: string
  scrapedLogs: string[]
}

export interface CrawlHostReport {
  type?: "host"
  hostname: string
  parentHost?: string | null
  authenticated: boolean | null
  password: string | null
  authGuesses?: number | null
}

export type CrawlStatusPhase = "auth" | "heartbleed" | "probe" | "spawn" | "wait"

export interface CrawlStatusReport {
  type: "status"
  workerHost: string
  targetHost: string
  phase: CrawlStatusPhase
  etaMs: number
  detail: string | null
  authGuesses?: number
}

export type CrawlPortMessage = CrawlHostReport | CrawlStatusReport

export interface CrawlCacheOpen {
  host: string
  file: string
  message: string
  karmaLoss: number
  openedAt: number
}

export interface CrawlProgressState {
  reports: ReadonlyMap<string, CrawlHostReport>
  activeOps: readonly CrawlStatusReport[]
  workerRunning: boolean
  cacheOpens: readonly CrawlCacheOpen[]
}

export interface DarknetCrawlResult {
  reports: Map<string, CrawlHostReport>
  cacheOpens: CrawlCacheOpen[]
}

export type CrawlProgressHandler = (state: CrawlProgressState) => void | Promise<void>

export interface DarknetRegistryEntry {
  hostname: string
  parentHost: string | null
  password: string | null
  lastUpdated: number
}

export interface DarknetRegistry {
  version: 1
  servers: Record<string, DarknetRegistryEntry>
}

export function loadDarknetRegistry(ns: NS): DarknetRegistry {
  if (!ns.fileExists(DARKNET_REGISTRY_FILE, "home")) {
    return { version: 1, servers: {} }
  }
  try {
    const parsed: unknown = JSON.parse(ns.read(DARKNET_REGISTRY_FILE))
    if (typeof parsed !== "object" || parsed === null) {
      return { version: 1, servers: {} }
    }
    const row = parsed as Record<string, unknown>
    if (row.version !== 1 || typeof row.servers !== "object" || row.servers === null) {
      return { version: 1, servers: {} }
    }
    const servers: Record<string, DarknetRegistryEntry> = {}
    for (const [hostname, raw] of Object.entries(row.servers as Record<string, unknown>)) {
      if (typeof raw !== "object" || raw === null) continue
      const entry = raw as Record<string, unknown>
      if (typeof entry.hostname !== "string") continue
      servers[hostname] = {
        hostname: entry.hostname,
        parentHost:
          typeof entry.parentHost === "string" ? entry.parentHost : entry.parentHost === null ? null : null,
        password: typeof entry.password === "string" ? entry.password : null,
        lastUpdated: typeof entry.lastUpdated === "number" ? entry.lastUpdated : 0,
      }
    }
    return { version: 1, servers }
  } catch {
    return { version: 1, servers: {} }
  }
}

export function saveDarknetRegistry(ns: NS, registry: DarknetRegistry): void {
  ns.write(DARKNET_REGISTRY_FILE, JSON.stringify(registry), "w")
}

export function mergeCrawlReportsIntoRegistry(
  registry: DarknetRegistry,
  reports: ReadonlyMap<string, CrawlHostReport>
): void {
  const now = Date.now()
  for (const report of reports.values()) {
    const existing = registry.servers[report.hostname]
    registry.servers[report.hostname] = {
      hostname: report.hostname,
      parentHost: report.parentHost != null ? report.parentHost : (existing?.parentHost ?? null),
      password:
        report.authenticated === true
          ? (report.password ?? existing?.password ?? null)
          : report.authenticated === false
            ? null
            : (existing?.password ?? null),
      lastUpdated: now,
    }
  }
}

export function mergeRegistryWithCrawl(
  registry: DarknetRegistry,
  crawlReports: ReadonlyMap<string, CrawlHostReport>
): Map<string, CrawlHostReport> {
  const merged = new Map<string, CrawlHostReport>()
  for (const entry of Object.values(registry.servers)) {
    merged.set(entry.hostname, {
      hostname: entry.hostname,
      parentHost: entry.parentHost,
      authenticated: entry.password != null ? true : null,
      password: entry.password,
      authGuesses: null,
    })
  }
  for (const report of crawlReports.values()) {
    const prev = merged.get(report.hostname)
    merged.set(report.hostname, {
      hostname: report.hostname,
      parentHost: report.parentHost != null ? report.parentHost : (prev?.parentHost ?? null),
      authenticated: report.authenticated ?? prev?.authenticated ?? null,
      password: report.password ?? prev?.password ?? null,
      authGuesses: report.authGuesses ?? prev?.authGuesses ?? null,
    })
  }
  return merged
}

function loadLocalPasswordCache(ns: NS): Map<string, string> {
  const cache = new Map<string, string>()
  const host = ns.getHostname()
  if (!ns.fileExists(DARKNET_REGISTRY_FILE, host)) {
    return cache
  }
  try {
    const parsed: unknown = JSON.parse(ns.read(DARKNET_REGISTRY_FILE))
    if (typeof parsed !== "object" || parsed === null) {
      return cache
    }
    const row = parsed as Record<string, unknown>
    if (typeof row.servers !== "object" || row.servers === null) {
      return cache
    }
    for (const raw of Object.values(row.servers as Record<string, unknown>)) {
      if (typeof raw !== "object" || raw === null) continue
      const entry = raw as Record<string, unknown>
      if (typeof entry.hostname !== "string" || typeof entry.password !== "string") continue
      cache.set(entry.hostname, entry.password)
    }
  } catch {
    // ignore corrupt local registry copy
  }
  return cache
}

export interface DarknetCrawlApi {
  probe(): string[]
  authenticate(host: string, password: string, additionalMsec?: number): Promise<{ success: boolean }>
  heartbleed(host: string, options?: { peek?: boolean }): Promise<{ success: boolean; logs: string[] }>
  connectToSession?(host: string, password: string): { success: boolean }
  openCache(filename: string, suppressToast?: boolean): { success: boolean; message: string; karmaLoss: number }
  getServerDetails(host?: string): DarknetServerDetailsForFormulas
}

export type DarknetServerDetailsForFormulas = {
  hasSession: boolean
  isOnline: boolean
  isConnectedToCurrentServer: boolean
  isStationary: boolean
  blockedRam: number
  modelId: string
  passwordFormat: DarknetPasswordFormat
  passwordHint: string
  passwordLength: number
  data: string
  depth: number
  difficulty: number
  requiredCharismaSkill: number
  logTrafficInterval: number
}

// --- auth-solver ---

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

const PHP54_MODEL = "PHP 5.4"

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

function isPhp54Model(details: ReturnType<DarknetCrawlApi["getServerDetails"]>): boolean {
  return details.modelId === PHP54_MODEL && details.passwordFormat === "numeric"
}

function php54NumericCandidates(hint: string, length: number): string[] {
  const numerals = hint.replace(/\D/g, "")
  if (numerals.length < length) {
    return []
  }
  return permutationsFromDigitPool(numerals, length)
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

function isAccountsManagerGuessNumber(details: ReturnType<DarknetCrawlApi["getServerDetails"]>): boolean {
  return (
    details.modelId === ACCOUNTS_MANAGER_MODEL &&
    details.passwordFormat === "numeric" &&
    parseGuessNumberMax(details.passwordHint) !== null
  )
}

const DEEP_GREEN_MODEL = "DeepGreen"
const DEEP_GREEN_CLUE_LINE_RE = /remember|must use/i
const MAX_MASTERMIND_CANDIDATES = 50_000

function isDeepGreenModel(details: ReturnType<DarknetCrawlApi["getServerDetails"]>): boolean {
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

/** Matches bitburner getMastermindResponse / getMisplacedCorrectCharsCount. */
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

function isNilModel(details: ReturnType<DarknetCrawlApi["getServerDetails"]>): boolean {
  return (
    details.modelId === "NIL" &&
    details.passwordFormat === "numeric" &&
    details.passwordHint === "you are one who's'nt authorized"
  )
}

interface AuthLogEntry {
  passwordAttempted: string
  data?: string
}

function parseAuthLogLine(logLine: string): AuthLogEntry | null {
  try {
    const parsed: unknown = JSON.parse(logLine)
    if (typeof parsed !== "object" || parsed === null) {
      return null
    }
    const row = parsed as Record<string, unknown>
    if (typeof row.passwordAttempted !== "string") {
      return null
    }
    return {
      passwordAttempted: row.passwordAttempted,
      data: typeof row.data === "string" ? row.data : undefined,
    }
  } catch {
    const attemptMatch = logLine.match(/passwordAttempted:\s*(\S+)/)
    const dataMatch = logLine.match(/data:\s*([^\n]+)/)
    if (!attemptMatch) {
      return null
    }
    return {
      passwordAttempted: attemptMatch[1]!,
      data: dataMatch?.[1]?.trim(),
    }
  }
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

async function readNilFeedback(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  guess: string
): Promise<boolean[] | null> {
  writeCrawlStatus(ns, port, {
    workerHost: ns.getHostname(),
    targetHost: host,
    phase: "heartbleed",
    etaMs: getHeartbleedEtaMs(ns, dnet, host),
    detail: "reading auth log",
  })

  const result = await dnet.heartbleed(host, { peek: true })
  if (!result.success) {
    return null
  }

  for (const logLine of result.logs) {
    const entry = parseAuthLogLine(logLine)
    if (entry?.passwordAttempted !== guess || !entry.data) {
      continue
    }
    const feedback = parseNilFeedback(entry.data, guess.length)
    if (feedback) {
      return feedback
    }
  }

  return null
}

type GuessNumberFeedback = "Higher" | "Lower"

async function readGuessNumberFeedback(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  guess: string
): Promise<GuessNumberFeedback | null> {
  writeCrawlStatus(ns, port, {
    workerHost: ns.getHostname(),
    targetHost: host,
    phase: "heartbleed",
    etaMs: getHeartbleedEtaMs(ns, dnet, host),
    detail: "reading auth log",
  })

  const result = await dnet.heartbleed(host, { peek: true })
  if (!result.success) {
    return null
  }

  for (const logLine of result.logs) {
    const entry = parseAuthLogLine(logLine)
    if (entry?.passwordAttempted !== guess || !entry.data) {
      continue
    }
    if (entry.data === "Higher" || entry.data === "Lower") {
      return entry.data
    }
  }

  return null
}

async function readMastermindFeedback(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  guess: string
): Promise<{ exact: number; misplaced: number } | null> {
  writeCrawlStatus(ns, port, {
    workerHost: ns.getHostname(),
    targetHost: host,
    phase: "heartbleed",
    etaMs: getHeartbleedEtaMs(ns, dnet, host),
    detail: "reading auth log",
  })

  const result = await dnet.heartbleed(host, { peek: true })
  if (!result.success) {
    return null
  }

  for (const logLine of result.logs) {
    const entry = parseAuthLogLine(logLine)
    if (entry?.passwordAttempted !== guess || !entry.data) {
      continue
    }
    const feedback = parseMastermindFeedback(entry.data)
    if (feedback) {
      return feedback
    }
  }

  return null
}

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

    const feedback = await readNilFeedback(ns, port, dnet, host, guess)
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

    const feedback = await readGuessNumberFeedback(ns, port, dnet, host, guess)
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

    const feedback = await readMastermindFeedback(ns, port, dnet, host, guess)
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

function solveDarknetPassword(input: DarknetAuthSolverInput): { password: string | null } {
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

  return { password: null }
}

function isFreshInstallNumeric(details: ReturnType<DarknetCrawlApi["getServerDetails"]>): boolean {
  return details.modelId === "FreshInstall_1.0" && details.passwordFormat === "numeric"
}

async function scrapeHeartbleedLogs(
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

function solverInputFromDetails(
  details: ReturnType<DarknetCrawlApi["getServerDetails"]>
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

// --- crawl-worker ---

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

function writeCrawlReport(ns: NS, port: number, report: CrawlHostReport): void {
  ns.writePort(port, JSON.stringify({ type: "host", ...report }))
}

function writeCrawlStatus(ns: NS, port: number, status: Omit<CrawlStatusReport, "type">): void {
  ns.writePort(port, JSON.stringify({ type: "status", ...status }))
}

async function authenticateWithStatus(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  password: string,
  detail: string | null = null,
  authGuesses?: number
): Promise<{ success: boolean }> {
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

async function authenticateCandidates(
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

async function tryAuthNeighbor(
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
    const candidates = php54NumericCandidates(details.passwordHint, details.passwordLength)
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

  const { password } = solveDarknetPassword(solverInputFromDetails(details))

  if (password !== null) {
    const result = await authenticateWithStatus(ns, port, dnet, neighbor, password, null, 1)
    return { password, authenticated: result.success, authGuesses: 1 }
  }

  return { password: null, authenticated: null, authGuesses: null }
}

async function waitForChildPids(ns: NS, pids: number[]): Promise<void> {
  for (const pid of pids) {
    if (pid <= 0) continue
    while (ns.isRunning(pid)) {
      await ns.sleep(50)
    }
  }
}

async function copyCrawlScript(ns: NS, target: string, source: string): Promise<void> {
  if (!ns.fileExists(DARKNET_CRAWL_SCRIPT, source)) {
    throw new Error(`${DARKNET_CRAWL_SCRIPT} not found on ${source}`)
  }
  await ns.scp(DARKNET_CRAWL_SCRIPT, target, source)
}

async function copyCrawlAssets(ns: NS, target: string, source: string): Promise<void> {
  await copyCrawlScript(ns, target, source)
  if (ns.fileExists(DARKNET_REGISTRY_FILE, source)) {
    await ns.scp(DARKNET_REGISTRY_FILE, target, source)
  }
}

function isArchivableTextFile(fileName: string): boolean {
  return flatFileName(fileName).endsWith(".txt")
}

function isLiteratureFile(fileName: string): boolean {
  return flatFileName(fileName).endsWith(".lit")
}

function isCacheFile(fileName: string): boolean {
  return flatFileName(fileName).endsWith(".cache")
}

function flatFileName(fileName: string): string {
  return fileName.includes("/") ? (fileName.split("/").pop() ?? fileName) : fileName
}

function archiveDestPath(fileName: string, suffix: number | null): string {
  const base = flatFileName(fileName)
  const dot = base.lastIndexOf(".")
  if (dot <= 0) {
    return suffix === null ? `${DARKWEB_ARCHIVE_DIR}/${base}` : `${DARKWEB_ARCHIVE_DIR}/${base} (${suffix})`
  }
  const stem = base.slice(0, dot)
  const ext = base.slice(dot)
  return suffix === null
    ? `${DARKWEB_ARCHIVE_DIR}/${base}`
    : `${DARKWEB_ARCHIVE_DIR}/${stem} (${suffix})${ext}`
}

function resolveArchiveWritePath(ns: NS, fileName: string, content: string): string | null {
  let suffix: number | null = null
  while (true) {
    const path = archiveDestPath(fileName, suffix)
    if (!ns.fileExists(path, "home")) {
      return path
    }
    if (ns.read(path) === content) {
      return null
    }
    suffix = suffix === null ? 1 : suffix + 1
  }
}

function finalizeArchiveContent(ns: NS, fileName: string, content: string): void {
  const destPath = resolveArchiveWritePath(ns, fileName, content)
  if (destPath === null) {
    return
  }
  ns.write(destPath, content, "w")
}

function finalizeArchiveFile(ns: NS, fileName: string): void {
  if (!ns.fileExists(fileName, "home")) {
    return
  }
  const content = ns.read(fileName)
  ns.rm(fileName)
  finalizeArchiveContent(ns, fileName, content)
}

function queueArchiveFile(
  ns: NS,
  fileName: string,
  reportPort: number | undefined
): void {
  if (ns.getHostname() === "home") {
    finalizeArchiveFile(ns, fileName)
  } else if (reportPort != null && reportPort > 0) {
    ns.writePort(reportPort, JSON.stringify({ type: "archive", file: flatFileName(fileName) }))
  }
}

function reportCacheOpen(
  ns: NS,
  host: string,
  fileName: string,
  result: { message: string; karmaLoss: number },
  reportPort: number | undefined,
  cacheOpens?: CrawlCacheOpen[]
): void {
  const entry: CrawlCacheOpen = {
    host,
    file: flatFileName(fileName),
    message: result.message,
    karmaLoss: result.karmaLoss,
    openedAt: Date.now(),
  }

  if (ns.getHostname() === "home") {
    finalizeArchiveContent(ns, entry.file, result.message)
    cacheOpens?.push(entry)
    return
  }

  if (reportPort != null && reportPort > 0) {
    ns.writePort(reportPort, JSON.stringify({ type: "cacheOpen", ...entry }))
  }
}

async function openCacheFilesOnCurrentHost(
  ns: NS,
  dnet: DarknetCrawlApi,
  reportPort: number | undefined,
  cacheOpens?: CrawlCacheOpen[]
): Promise<void> {
  const hostname = ns.getHostname()
  let files: string[]
  try {
    files = ns.ls(hostname)
  } catch {
    return
  }

  for (const file of files) {
    if (!isCacheFile(file)) {
      continue
    }
    const result = dnet.openCache(file, true)
    if (!result.success) {
      continue
    }
    reportCacheOpen(ns, hostname, file, result, reportPort, cacheOpens)
  }
}

async function execOpenCachesOnHost(
  ns: NS,
  host: string,
  reportPort: number | undefined
): Promise<void> {
  if (!ns.fileExists(DARKNET_CRAWL_SCRIPT, host)) {
    await copyCrawlScript(ns, host, ns.getHostname())
  }
  const port = reportPort ?? 0
  const pid = ns.exec(DARKNET_CRAWL_SCRIPT, host, 1, OPEN_CACHES_MODE_ARG, port)
  if (pid === 0) {
    return
  }
  while (ns.isRunning(pid)) {
    await ns.sleep(50)
  }
}

async function archiveServerFiles(
  ns: NS,
  dnet: DarknetCrawlApi,
  sourceHost: string,
  reportPort?: number,
  cacheOpens?: CrawlCacheOpen[]
): Promise<void> {
  let files: string[]
  try {
    files = ns.ls(sourceHost)
  } catch {
    return
  }

  const onHome = ns.getHostname() === "home"
  const onSource = ns.getHostname() === sourceHost

  for (const file of files) {
    const base = flatFileName(file)
    if (isLiteratureFile(file)) {
      if (!ns.fileExists(base, "home")) {
        ns.scp(file, "home", sourceHost)
      }
      continue
    }
    if (!isArchivableTextFile(file)) {
      continue
    }
    if (!ns.scp(file, "home", sourceHost)) {
      continue
    }
    if (onHome) {
      finalizeArchiveFile(ns, base)
    } else if (reportPort != null) {
      queueArchiveFile(ns, base, reportPort)
    }
  }

  if (onSource) {
    await openCacheFilesOnCurrentHost(ns, dnet, reportPort, cacheOpens)
  } else if (dnet.getServerDetails(sourceHost).hasSession) {
    await execOpenCachesOnHost(ns, sourceHost, reportPort)
  }
}

async function runCrawlWorker(ns: NS): Promise<void> {
  const reportPort = Number(ns.args[1])
  const remainingDepth = Number(ns.args[2])
  if (!Number.isInteger(reportPort) || reportPort <= 0 || !Number.isInteger(remainingDepth)) {
    return
  }

  const dnet = (ns as NS & { dnet?: DarknetCrawlApi }).dnet
  if (!dnet) {
    return
  }

  const hostname = ns.getHostname()
  const passwordCache = loadLocalPasswordCache(ns)

  writeCrawlReport(ns, reportPort, {
    hostname,
    authenticated: dnet.getServerDetails(hostname).hasSession ? true : null,
    password: null,
  })

  if (dnet.getServerDetails(hostname).hasSession) {
    await archiveServerFiles(ns, dnet, hostname, reportPort)
  }

  if (remainingDepth <= 0) {
    return
  }

  const childPids: number[] = []

  writeCrawlStatus(ns, reportPort, {
    workerHost: hostname,
    targetHost: hostname,
    phase: "probe",
    etaMs: 0,
    detail: null,
  })

  for (const neighbor of dnet.probe()) {
    const auth = await tryAuthNeighbor(
      ns,
      reportPort,
      dnet,
      neighbor,
      passwordCache.get(neighbor) ?? null
    )
    writeCrawlReport(ns, reportPort, {
      hostname: neighbor,
      parentHost: hostname,
      authenticated: auth.authenticated,
      password: auth.password,
      authGuesses: auth.authGuesses,
    })

    if (dnet.getServerDetails(neighbor).hasSession) {
      await archiveServerFiles(ns, dnet, neighbor, reportPort)
    }

    if (!dnet.getServerDetails(neighbor).hasSession || remainingDepth <= 1) {
      continue
    }

    writeCrawlStatus(ns, reportPort, {
      workerHost: hostname,
      targetHost: neighbor,
      phase: "spawn",
      etaMs: 0,
      detail: `depth ${remainingDepth - 1}`,
    })

    await copyCrawlAssets(ns, neighbor, hostname)
    const pid = ns.exec(DARKNET_CRAWL_SCRIPT, neighbor, 1, WORKER_MODE_ARG, reportPort, remainingDepth - 1)
    if (pid > 0) {
      childPids.push(pid)
    }
  }

  if (childPids.length > 0) {
    writeCrawlStatus(ns, reportPort, {
      workerHost: hostname,
      targetHost: hostname,
      phase: "wait",
      etaMs: 0,
      detail: `${childPids.length} child worker(s)`,
    })
  }

  await waitForChildPids(ns, childPids)
}

// --- crawl-master ---

function parseCrawlStatus(raw: Record<string, unknown>): CrawlStatusReport | null {
  if (raw.type !== "status") {
    return null
  }
  if (typeof raw.workerHost !== "string" || typeof raw.targetHost !== "string") {
    return null
  }
  if (
    raw.phase !== "auth" &&
    raw.phase !== "heartbleed" &&
    raw.phase !== "probe" &&
    raw.phase !== "spawn" &&
    raw.phase !== "wait"
  ) {
    return null
  }
  if (typeof raw.etaMs !== "number" || !Number.isFinite(raw.etaMs)) {
    return null
  }
  return {
    type: "status",
    workerHost: raw.workerHost,
    targetHost: raw.targetHost,
    phase: raw.phase,
    etaMs: raw.etaMs,
    detail: typeof raw.detail === "string" ? raw.detail : null,
    authGuesses: typeof raw.authGuesses === "number" ? raw.authGuesses : undefined,
  }
}

function parseCrawlReport(raw: unknown): CrawlHostReport | null {
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
    if (typeof parsed !== "object" || parsed === null) return null
    const row = parsed as Record<string, unknown>
    if (row.type === "status") {
      return null
    }
    if (row.type === "archive") {
      return null
    }
    if (row.type === "cacheOpen") {
      return null
    }
    if (typeof row.hostname !== "string") return null
    if (row.authenticated !== true && row.authenticated !== false && row.authenticated !== null) {
      return null
    }
    const parentHost =
      typeof row.parentHost === "string" ? row.parentHost : row.parentHost === null ? null : undefined
    const authGuesses =
      typeof row.authGuesses === "number"
        ? row.authGuesses
        : row.authGuesses === null
          ? null
          : undefined
    return {
      type: "host",
      hostname: row.hostname,
      parentHost,
      authenticated: row.authenticated,
      password: typeof row.password === "string" || row.password === null ? row.password : null,
      authGuesses,
    }
  } catch {
    return null
  }
}

function parseCacheOpen(row: Record<string, unknown>): CrawlCacheOpen | null {
  if (row.type !== "cacheOpen") {
    return null
  }
  if (typeof row.host !== "string" || typeof row.file !== "string" || typeof row.message !== "string") {
    return null
  }
  if (typeof row.karmaLoss !== "number" || !Number.isFinite(row.karmaLoss)) {
    return null
  }
  return {
    host: row.host,
    file: row.file,
    message: row.message,
    karmaLoss: row.karmaLoss,
    openedAt: typeof row.openedAt === "number" && Number.isFinite(row.openedAt) ? row.openedAt : Date.now(),
  }
}

function applyCrawlPortMessage(
  ns: NS,
  raw: unknown,
  reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>,
  cacheOpens: CrawlCacheOpen[]
): void {
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
    if (typeof parsed !== "object" || parsed === null) {
      return
    }
    const row = parsed as Record<string, unknown>
    const cacheOpen = parseCacheOpen(row)
    if (cacheOpen) {
      cacheOpens.push(cacheOpen)
      finalizeArchiveContent(ns, cacheOpen.file, cacheOpen.message)
      return
    }
    if (row.type === "archive" && typeof row.file === "string") {
      finalizeArchiveFile(ns, row.file)
      return
    }
    const status = parseCrawlStatus(row)
    if (status) {
      activeOps.set(status.workerHost, status)
      return
    }
    const report = parseCrawlReport(parsed)
    if (!report) {
      return
    }
    const existing = reports.get(report.hostname)
    reports.set(report.hostname, {
      hostname: report.hostname,
      authenticated: report.authenticated,
      password: report.password,
      parentHost: report.parentHost != null ? report.parentHost : (existing?.parentHost ?? null),
      authGuesses: report.authGuesses ?? existing?.authGuesses ?? null,
    })
    for (const [workerHost, op] of activeOps) {
      if (op.targetHost === report.hostname && (op.phase === "auth" || op.phase === "heartbleed")) {
        activeOps.delete(workerHost)
      }
    }
  } catch {
    // ignore malformed port data
  }
}

function drainCrawlPort(
  ns: NS,
  port: number,
  reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>,
  cacheOpens: CrawlCacheOpen[]
): void {
  while (true) {
    const raw = ns.readPort(port)
    if (raw === "NULL PORT DATA") break
    applyCrawlPortMessage(ns, raw, reports, activeOps, cacheOpens)
  }
}

function pollCrawlPort(
  ns: NS,
  port: number,
  reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>,
  cacheOpens: CrawlCacheOpen[]
): void {
  while (true) {
    const raw = ns.peek(port)
    if (raw === "NULL PORT DATA") break
    ns.readPort(port)
    applyCrawlPortMessage(ns, raw, reports, activeOps, cacheOpens)
  }
}

export function formatEtaMs(etaMs: number): string {
  if (etaMs <= 0) {
    return "-"
  }
  if (etaMs < 1000) {
    return `${Math.round(etaMs)}ms`
  }
  return `${(etaMs / 1000).toFixed(1)}s`
}

export function formatCrawlOpShort(status: CrawlStatusReport): string {
  const eta = formatEtaMs(status.etaMs)
  const detail = status.detail ? ` ${status.detail}` : ""
  return `${status.phase} ${eta}${detail}`.trim()
}

export function formatCrawlStatusLine(status: CrawlStatusReport): string {
  const eta = formatEtaMs(status.etaMs)
  const detail = status.detail ? ` | ${status.detail}` : ""
  return `${status.workerHost} -> ${status.targetHost}: ${status.phase} (est ${eta})${detail}`
}

async function authenticateDarkwebEntry(
  ns: NS,
  dnet: DarknetCrawlApi,
  cachedPassword: string | null | undefined
): Promise<void> {
  if (cachedPassword != null) {
    const cached = await dnet.authenticate(DARKWEB, cachedPassword)
    if (cached.success) {
      return
    }
  }

  const details = dnet.getServerDetails(DARKWEB)
  const { password } = solveDarknetPassword(solverInputFromDetails(details))

  if (password !== null) {
    await dnet.authenticate(DARKWEB, password)
  } else if (dnet.connectToSession) {
    dnet.connectToSession(DARKWEB, "")
  }
}

export async function runDarknetCrawl(
  ns: NS,
  dnet: DarknetCrawlApi,
  maxDepth = MAX_PROBE_DEPTH,
  onProgress?: CrawlProgressHandler,
  registry?: DarknetRegistry
): Promise<DarknetCrawlResult> {
  const source = ns.getHostname()

  if (registry) {
    saveDarknetRegistry(ns, registry)
  }

  await authenticateDarkwebEntry(ns, dnet, registry?.servers[DARKWEB]?.password)

  await copyCrawlAssets(ns, DARKWEB, source)
  ns.clearPort(CRAWL_REPORT_PORT)
  ns.scriptKill(DARKNET_CRAWL_SCRIPT, DARKWEB)

  const workerRam = ns.getScriptRam(DARKNET_CRAWL_SCRIPT, DARKWEB)
  const freeRam = ns.getServerMaxRam(DARKWEB) - ns.getServerUsedRam(DARKWEB)
  if (workerRam > freeRam) {
    throw new Error(
      `Not enough RAM on ${DARKWEB} for ${DARKNET_CRAWL_SCRIPT} (need ${ns.format.ram(workerRam)}, free ${ns.format.ram(freeRam)})`
    )
  }

  const pid = ns.exec(DARKNET_CRAWL_SCRIPT, DARKWEB, 1, WORKER_MODE_ARG, CRAWL_REPORT_PORT, maxDepth)
  if (pid === 0) {
    throw new Error(`Could not exec ${DARKNET_CRAWL_SCRIPT} on ${DARKWEB}`)
  }

  const reports = new Map<string, CrawlHostReport>()
  const activeOps = new Map<string, CrawlStatusReport>()
  const cacheOpens: CrawlCacheOpen[] = []

  const emitProgress = async (workerRunning: boolean): Promise<void> => {
    if (!onProgress) {
      return
    }
    await onProgress({
      reports,
      activeOps: [...activeOps.values()],
      workerRunning,
      cacheOpens,
    })
  }

  await emitProgress(true)

  while (ns.isRunning(pid)) {
    pollCrawlPort(ns, CRAWL_REPORT_PORT, reports, activeOps, cacheOpens)
    await emitProgress(true)
    await ns.sleep(100)
  }

  drainCrawlPort(ns, CRAWL_REPORT_PORT, reports, activeOps, cacheOpens)
  await emitProgress(false)

  return { reports, cacheOpens }
}

async function runOpenCachesWorker(ns: NS): Promise<void> {
  const reportPort = Number(ns.args[1])
  const dnet = (ns as NS & { dnet?: DarknetCrawlApi }).dnet
  if (!dnet) {
    return
  }
  const port = Number.isInteger(reportPort) && reportPort > 0 ? reportPort : undefined
  await openCacheFilesOnCurrentHost(ns, dnet, port)
}

// --- entry ---

export async function main(ns: NS): Promise<void> {
  if (ns.args[0] === WORKER_MODE_ARG) {
    await runCrawlWorker(ns)
  } else if (ns.args[0] === OPEN_CACHES_MODE_ARG) {
    await runOpenCachesWorker(ns)
  }
}
