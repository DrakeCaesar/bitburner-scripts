import { NS } from "@ns"

// --- config ---

export const DARKNET_CRAWL_SCRIPT = "darknetCrawl.js"
export const DARKNET_REGISTRY_FILE = "darknet-registry.json"
export const MAX_PROBE_DEPTH = 10
export const DEFAULT_CRAWL_INTERVAL_MS = 60_000
const WORKER_MODE_ARG = "worker"
export const DARKWEB = "darkweb"

// ---- file categorization (mirrored in darkwebArchiveDupes.ts via import) ----

/** Files whose basename contains one of these go to the lore port → darknet-lore.json. */
export const LORE_FILE_KEYWORDS = ["dreams", "journal", "notes", "search_history", "the_truth", "thoughts"]

/** Files whose basename contains one of these go to per-file archive. */
export const PASSWORD_FILE_KEYWORDS = ["access", "admin", "credentials", "key", "login", "password", "root", "secrets"]

export function isLoreFile(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return LORE_FILE_KEYWORDS.some((kw) => lower.includes(kw))
}

export function flatFileName(fileName: string): string {
  return fileName.includes("/") ? (fileName.split("/").pop() ?? fileName) : fileName
}

// ---- persistent text storage files ----

const DARKNET_LORE_FILE = "darknet-lore.json"
const DARKWEB_ARCHIVE_DIR = "darkweb"

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

export type CrawlCycleCompleteHandler = (result: DarknetCrawlResult) => void | Promise<void>

export type CrawlErrorHandler = (message: string) => void

/** A single hint discovery: "The password for X contains 7 and 8" */
interface PasswordHintRecord {
  /** Sorted unique characters (digits or letters). */
  chars: string
  timestamp: number
}

export interface DarknetRegistryEntry {
  hostname: string
  parentHost: string | null
  password: string | null
  /** When the password was last discovered from a file (explicit) or confirmed via auth. */
  timestamp: number | null
  /** Accumulated hint discoveries, each with its own timestamp. */
  passwordHints: PasswordHintRecord[]
}

export interface DarknetRememberedPassword {
  password: string
  sourceHost: string
  neighborHosts: string[]
  timestamp: number
}

export interface DarknetRegistry {
  servers: Record<string, DarknetRegistryEntry>
  rememberedPasswords: DarknetRememberedPassword[]
}

// #region darkweb-password-intel
// Password clues from darkweb archive files (home/darkweb/*.data.txt).

/** Sources: password.data.txt, credentials.data.txt, access.data.txt */
const DARKWEB_COMMON_PASSWORDS: readonly string[] = [
  "123456",
  "password",
  "12345678",
  "qwerty",
  "123456789",
  "12345",
  "1234",
  "111111",
  "1234567",
  "dragon",
  "123123",
  "baseball",
  "abc123",
  "football",
  "monkey",
  "letmein",
  "696969",
  "shadow",
  "master",
  "666666",
  "qwertyuiop",
  "123321",
  "mustang",
  "1234567890",
  "michael",
  "654321",
  "superman",
  "1qaz2wsx",
  "7777777",
  "121212",
  "0",
  "qazwsx",
  "123qwe",
  "trustno1",
  "jordan",
  "jennifer",
  "zxcvbnm",
  "asdfgh",
  "hunter",
  "buster",
  "soccer",
  "harley",
  "batman",
  "andrew",
  "tigger",
  "sunshine",
  "iloveyou",
  "2000",
  "charlie",
  "robert",
  "thomas",
  "hockey",
  "ranger",
  "daniel",
  "starwars",
  "112233",
  "george",
  "computer",
  "michelle",
  "jessica",
  "pepper",
  "1111",
  "zxcvbn",
  "555555",
  "11111111",
  "131313",
  "freedom",
  "777777",
  "pass",
  "maggie",
  "159753",
  "aaaaaa",
  "ginger",
  "princess",
  "joshua",
  "cheese",
  "amanda",
  "summer",
  "love",
  "ashley",
  "6969",
  "nicole",
  "chelsea",
  "biteme",
  "matthew",
  "access",
  "yankees",
  "987654321",
  "dallas",
  "austin",
  "thunder",
  "taylor",
]

/** Source: key.data.txt ("Remember this password: …") */
const DARKWEB_KNOWN_PASSWORDS: readonly string[] = ["27974"]

/**
 * Host -> digits known to appear in the password.
 * Sources: login.data.txt, admin.data.txt, secrets.data.txt, root.data.txt
 */
const DARKWEB_HOST_DIGIT_HINTS: Readonly<Record<string, readonly string[]>> = {
  "6969": ["5", "8"],
  "hacker-services": ["5", "6"],
  "speakers_for_the_dead:5801": ["1", "3"],
  apexsanctuary: ["0", "7"],
}

const DARKWEB_NUMERIC_RE = /^\d+$/
const DARKWEB_ALPHA_RE = /^[a-z]+$/
const DARKWEB_ALNUM_RE = /^[a-z0-9]+$/

function normalizeDarkwebHost(host: string): string {
  return host.toLowerCase()
}

function darkwebHostDigitPool(host: string): string | null {
  const hints = DARKWEB_HOST_DIGIT_HINTS[normalizeDarkwebHost(host)]
  if (!hints || hints.length === 0) {
    return null
  }
  return hints.join("")
}

/** Union of digit characters from archive hint and server password hint text. */
function mergeDarkwebDigitPools(...pools: string[]): string {
  const digits = new Set<string>()
  for (const pool of pools) {
    for (const ch of pool.replace(/\D/g, "")) {
      digits.add(ch)
    }
  }
  return [...digits].sort().join("")
}

function darkwebKnownPasswordCandidates(length: number): string[] {
  return DARKWEB_KNOWN_PASSWORDS.filter((password) => password.length === length)
}

function darkwebCommonPasswordCandidates(length: number, format: DarknetPasswordFormat): string[] {
  const out: string[] = []
  for (const word of DARKWEB_COMMON_PASSWORDS) {
    if (word.length !== length) {
      continue
    }
    if (format === "numeric" && !DARKWEB_NUMERIC_RE.test(word)) {
      continue
    }
    if (format === "alphabetic" && !DARKWEB_ALPHA_RE.test(word)) {
      continue
    }
    if (format === "alphanumeric" && !DARKWEB_ALNUM_RE.test(word)) {
      continue
    }
    out.push(word)
  }
  return out
}

/** Archive-based guesses for a host (known literals + common-word list), deduped in order. */
function darkwebPasswordCandidates(length: number, format: DarknetPasswordFormat): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const password of [
    ...darkwebKnownPasswordCandidates(length),
    ...darkwebCommonPasswordCandidates(length, format),
  ]) {
    if (seen.has(password)) {
      continue
    }
    seen.add(password)
    out.push(password)
  }
  return out
}
// #endregion darkweb-password-intel

export function loadDarknetRegistry(ns: NS): DarknetRegistry {
  if (!ns.fileExists(DARKNET_REGISTRY_FILE, "home")) {
    return { servers: {}, rememberedPasswords: [] }
  }
  try {
    const parsed: unknown = JSON.parse(ns.read(DARKNET_REGISTRY_FILE))
    if (typeof parsed !== "object" || parsed === null) {
      return { servers: {}, rememberedPasswords: [] }
    }
    const row = parsed as Record<string, unknown>
    const serversRaw = (row.servers ?? row) as Record<string, unknown>
    if (typeof serversRaw !== "object" || serversRaw === null || Array.isArray(serversRaw)) {
      return { servers: {}, rememberedPasswords: [] }
    }
    const servers: Record<string, DarknetRegistryEntry> = {}
    for (const [hostname, raw] of Object.entries(serversRaw)) {
      if (typeof raw !== "object" || raw === null) continue
      const entry = raw as Record<string, unknown>
      if (typeof entry.hostname !== "string") continue
      const hints: PasswordHintRecord[] = []
      if (Array.isArray(entry.passwordHints)) {
        for (const h of entry.passwordHints) {
          const r = h as Record<string, unknown>
          if (typeof r.chars === "string" && typeof r.timestamp === "number") {
            hints.push({ chars: r.chars, timestamp: r.timestamp })
          }
        }
      }
      servers[hostname] = {
        hostname: entry.hostname,
        parentHost:
          typeof entry.parentHost === "string" ? entry.parentHost : entry.parentHost === null ? null : null,
        password: typeof entry.password === "string" ? entry.password : null,
        timestamp:
          typeof entry.timestamp === "number" ? entry.timestamp : null,
        passwordHints: hints,
      }
    }
    const rememberedPasswords: DarknetRememberedPassword[] = []
    if (Array.isArray(row.rememberedPasswords)) {
      for (const rp of row.rememberedPasswords) {
        const r = rp as Record<string, unknown>
        if (typeof r.password !== "string") continue
        if (typeof r.sourceHost !== "string") continue
        if (!Array.isArray(r.neighborHosts)) continue
        if (typeof r.timestamp !== "number") continue
        rememberedPasswords.push({
          password: r.password,
          sourceHost: r.sourceHost,
          neighborHosts: r.neighborHosts.filter((h): h is string => typeof h === "string"),
          timestamp: r.timestamp,
        })
      }
    }
    return { servers, rememberedPasswords }
  } catch {
    return { servers: {}, rememberedPasswords: [] }
  }
}

export function saveDarknetRegistry(ns: NS, registry: DarknetRegistry): void {
  ns.write(DARKNET_REGISTRY_FILE, JSON.stringify(registry, null, 2), "w")
}

function registryToPasswordMap(registry: DarknetRegistry): Map<string, string> {
  const map = new Map<string, string>()
  for (const entry of Object.values(registry.servers)) {
    if (entry.password != null) {
      map.set(entry.hostname, entry.password)
    }
  }
  return map
}

function serializePasswordMap(cache: Map<string, string>): string {
  return JSON.stringify(Object.fromEntries(cache))
}

function parsePasswordMapArg(raw: unknown): Map<string, string> {
  const cache = new Map<string, string>()
  if (typeof raw !== "string" || raw.length === 0) {
    return cache
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) {
      return cache
    }
    for (const [hostname, password] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof hostname === "string" && typeof password === "string") {
        cache.set(hostname, password)
      }
    }
  } catch {
    // ignore malformed registry arg
  }
  return cache
}

function loadWorkerPasswordCache(ns: NS): Map<string, string> {
  return parsePasswordMapArg(ns.args[4])
}

export function mergeCrawlReportsIntoRegistry(
  registry: DarknetRegistry,
  reports: ReadonlyMap<string, CrawlHostReport>
): void {
  const now = Date.now()
  for (const report of reports.values()) {
    const existing = registry.servers[report.hostname]
    const password =
      report.authenticated === true
        ? (report.password ?? existing?.password ?? null)
        : report.authenticated === false
          ? null
          : (existing?.password ?? null)
    const timestamp =
      report.authenticated === true && report.password != null
        ? now
        : existing?.timestamp ?? null
    registry.servers[report.hostname] = {
      hostname: report.hostname,
      parentHost: report.parentHost != null ? report.parentHost : (existing?.parentHost ?? null),
      password,
      timestamp,
      passwordHints: existing?.passwordHints ?? [],
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

/** Returns null when the host no longer exists in the darknet (offline graph, stale registry). */
export function safeGetServerDetails(
  dnet: DarknetCrawlApi,
  host: string
): DarknetServerDetailsForFormulas | null {
  try {
    return dnet.getServerDetails(host)
  } catch {
    return null
  }
}

function tryConnectToSession(dnet: DarknetCrawlApi, host: string, password: string): boolean {
  if (!dnet.connectToSession || safeGetServerDetails(dnet, host) == null) {
    return false
  }
  try {
    return dnet.connectToSession(host, password).success
  } catch {
    return false
  }
}

/** Drop registry entries for hosts removed from the darknet graph. */
export function pruneInvalidRegistryHosts(dnet: DarknetCrawlApi, registry: DarknetRegistry): string[] {
  const removed: string[] = []
  for (const hostname of Object.keys(registry.servers)) {
    if (safeGetServerDetails(dnet, hostname) == null) {
      delete registry.servers[hostname]
      removed.push(hostname)
    }
  }
  return removed
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

function php54NumericCandidates(host: string, hint: string, length: number): string[] {
  const pool = mergeDarkwebDigitPools(darkwebHostDigitPool(host) ?? "", hint)
  if (pool.length < length) {
    return []
  }
  return permutationsFromDigitPool(pool, length)
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

function writeCrawlCycleComplete(ns: NS, port: number): void {
  ns.writePort(port, JSON.stringify({ type: "cycleComplete" }))
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

async function tryDarkwebArchivePasswords(
  ns: NS,
  port: number,
  dnet: DarknetCrawlApi,
  host: string,
  details: ReturnType<DarknetCrawlApi["getServerDetails"]>
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
    const archiveAuth = await tryDarkwebArchivePasswords(ns, port, dnet, neighbor, details)
    if (archiveAuth?.authenticated) {
      return {
        password: archiveAuth.password,
        authenticated: true,
        authGuesses: archiveAuth.authGuesses,
      }
    }

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

  const archiveAuth = await tryDarkwebArchivePasswords(ns, port, dnet, neighbor, details)
  if (archiveAuth != null) {
    return {
      password: archiveAuth.password,
      authenticated: archiveAuth.authenticated ? true : archiveAuth.password !== null ? false : null,
      authGuesses: archiveAuth.authGuesses,
    }
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
  if (!ns.scp(DARKNET_CRAWL_SCRIPT, target, source)) {
    throw new Error(`Failed to scp ${DARKNET_CRAWL_SCRIPT} to ${target} from ${source}`)
  }
}

function crawlWorkerArgs(
  reportPort: number,
  lorePort: number,
  remainingDepth: number,
  registryJson: string,
  waitForChildren: boolean
): (string | number)[] {
  return [WORKER_MODE_ARG, reportPort, lorePort, remainingDepth, waitForChildren ? 1 : 0, registryJson]
}

async function spawnCrawlWorkerOnHost(
  ns: NS,
  host: string,
  reportPort: number,
  lorePort: number,
  remainingDepth: number,
  passwordCache: Map<string, string>,
  assetSource: string,
  waitForChildren: boolean
): Promise<number> {
  await copyCrawlScript(ns, host, assetSource)
  const workerRam = ns.getScriptRam(DARKNET_CRAWL_SCRIPT, host)
  const freeRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host)
  if (workerRam > freeRam) {
    return 0
  }
  return ns.exec(
    DARKNET_CRAWL_SCRIPT,
    host,
    1,
    ...crawlWorkerArgs(reportPort, lorePort, remainingDepth, serializePasswordMap(passwordCache), waitForChildren)
  )
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

// --- text-file json merge (replaces per-file archiving) ---

function loadDarknetTextSet(ns: NS, file: string): Set<string> {
  if (!ns.fileExists(file, "home")) return new Set()
  try {
    const parsed: unknown = JSON.parse(ns.read(file))
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === "string"))
  } catch {
    return new Set()
  }
}

function syncDarknetTextFile(ns: NS, file: string, textSet: Set<string>): void {
  const sorted = [...textSet].sort()
  ns.write(file, JSON.stringify(sorted, null, 2), "w")
}

// ---- per-file archive (non-journaling .txt / .lit files) ----

function archiveDestPath(fileName: string, suffix: number | null): string {
  const base = flatFileName(fileName)
  if (suffix === null) {
    return `${DARKWEB_ARCHIVE_DIR}/${base}`
  }
  const dot = base.lastIndexOf(".")
  if (dot <= 0) {
    return `${DARKWEB_ARCHIVE_DIR}/${base}.${suffix}`
  }
  const stem = base.slice(0, dot)
  const ext = base.slice(dot)
  return `${DARKWEB_ARCHIVE_DIR}/${stem}.${suffix}${ext}`
}

function listArchivePaths(ns: NS, fileName: string): string[] {
  const paths: string[] = []
  const basePath = archiveDestPath(fileName, null)
  if (ns.fileExists(basePath, "home")) {
    paths.push(basePath)
  }
  let suffix = 1
  while (true) {
    const path = archiveDestPath(fileName, suffix)
    if (!ns.fileExists(path, "home")) {
      break
    }
    paths.push(path)
    suffix++
  }
  return paths
}

function resolveArchiveWritePath(ns: NS, fileName: string, content: string): string | null {
  for (const path of listArchivePaths(ns, fileName)) {
    if (ns.read(path) === content) {
      return null
    }
  }
  let suffix: number | null = null
  while (true) {
    const path = archiveDestPath(fileName, suffix)
    if (!ns.fileExists(path, "home")) {
      return path
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

// ---- password file content parsing ----

const COMMON_PASSWORDS_PREFIX_NOSPACE = "Some common passwords include"
const REMEMBER_PASSWORD_RE = /^Remember this password:\s*(\S+)/im
const EXPLICIT_PASSWORD_RE = /^Server:\s+(.+?)\s+Password:\s*"(\S+?)"/gm
const HOST_HINT_RE = /^The password for (.+?) contains (\d+)\s+and\s+(\d+)/gm

interface PasswordFileIntel {
  kind: "explicit" | "remember" | "hint"
  /** Target hostname (null for "remember" — we don't know which neighbor yet). */
  host: string | null
  password: string | null
  /** Sorted unique hint digits/letters. */
  chars: string | null
}

function parsePasswordFileContent(
  content: string,
  sourceHost: string,
  neighbors: string[],
  timestamp: number
): { cleanContent: string; intel: PasswordFileIntel[]; intelJson: string } {
  const intel: PasswordFileIntel[] = []
  const lines = content.split("\n")
  const cleanLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Type 1 — discard common password lists
    if (trimmed.startsWith(COMMON_PASSWORDS_PREFIX_NOSPACE)) {
      continue
    }

    // Type 2 — "Remember this password: XXXX"
    const rememberMatch = REMEMBER_PASSWORD_RE.exec(trimmed)
    if (rememberMatch) {
      const pw = rememberMatch[1]!
      intel.push({ kind: "remember", host: null, password: pw, chars: null })
      cleanLines.push(line)
      continue
    }

    // Type 3 — "Server: HOST Password: \"PW\""
    EXPLICIT_PASSWORD_RE.lastIndex = 0
    const explicitMatch = EXPLICIT_PASSWORD_RE.exec(trimmed)
    if (explicitMatch) {
      intel.push({ kind: "explicit", host: explicitMatch[1]!.trim(), password: explicitMatch[2]!, chars: null })
      cleanLines.push(line)
      continue
    }

    // Type 4 — "The password for HOST contains X and Y"
    HOST_HINT_RE.lastIndex = 0
    const hintMatch = HOST_HINT_RE.exec(trimmed)
    if (hintMatch) {
      const chars = [...new Set([hintMatch[2]!, hintMatch[3]!])].sort().join("")
      intel.push({ kind: "hint", host: hintMatch[1]!.trim(), password: null, chars })
      cleanLines.push(line)
      continue
    }

    cleanLines.push(line)
  }

  const cleanContent = cleanLines.join("\n")
  const intelJson = JSON.stringify({
    type: "passwordIntel",
    sourceHost,
    neighbors,
    timestamp,
    entries: intel,
  })

  return { cleanContent, intel, intelJson }
}

function queueArchiveContent(
  ns: NS,
  fileName: string,
  content: string,
  reportPort: number | undefined,
  lorePort: number | undefined,
  neighbors: string[] | undefined
): void {
  if (isLoreFile(flatFileName(fileName))) {
    // journaling files go to lore port → darknet-lore.json
    if (lorePort != null && lorePort > 0) {
      ns.writePort(lorePort, content)
    }
    return
  }
  // non-journaling files: parse for password intel, strip type-1, archive the rest
  const base = flatFileName(fileName)
  const hostname = ns.getHostname()

  const { cleanContent, intelJson } = parsePasswordFileContent(
    content,
    hostname,
    neighbors ?? [],
    Date.now()
  )

  if (hostname === "home") {
    finalizeArchiveContent(ns, base, cleanContent)
    // On home, apply password intel directly to the in-memory registry
    // (handled by caller via return value or by archiving)
    return
  }

  // On workers: send cleaned content for archiving + parsed password intel
  if (reportPort != null && reportPort > 0) {
    ns.writePort(reportPort, JSON.stringify({ type: "archive", file: base, content: cleanContent }))
    ns.writePort(reportPort, intelJson)
  }
}

function reportCacheOpen(
  ns: NS,
  host: string,
  fileName: string,
  result: { message: string; karmaLoss: number },
  reportPort: number | undefined,
  lorePort: number | undefined,
  cacheOpens?: CrawlCacheOpen[]
): void {
  const entry: CrawlCacheOpen = {
    host,
    file: flatFileName(fileName),
    message: result.message,
    karmaLoss: result.karmaLoss,
    openedAt: Date.now(),
  }

  cacheOpens?.push(entry)

  if (reportPort != null && reportPort > 0) {
    ns.writePort(reportPort, JSON.stringify({ type: "cacheOpen", ...entry }))
  }
  // cache messages are lore snippets, not password data
  if (lorePort != null && lorePort > 0) {
    ns.writePort(lorePort, result.message)
  }
}

async function openCacheFilesOnCurrentHost(
  ns: NS,
  dnet: DarknetCrawlApi,
  reportPort: number | undefined,
  lorePort: number | undefined,
  neighbors: string[] | undefined,
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
    reportCacheOpen(ns, hostname, file, result, reportPort, lorePort, cacheOpens)
  }
}

async function archiveLocalServerFiles(
  ns: NS,
  dnet: DarknetCrawlApi,
  reportPort?: number,
  lorePort?: number,
  neighbors?: string[],
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
    if (!isLiteratureFile(file) && !isArchivableTextFile(file)) {
      continue
    }
    if (!ns.fileExists(file)) {
      continue
    }
    queueArchiveContent(ns, flatFileName(file), ns.read(file), reportPort, lorePort, neighbors)
  }

  await openCacheFilesOnCurrentHost(ns, dnet, reportPort, lorePort, neighbors, cacheOpens)
}

function safeGetSessionDetails(
  dnet: DarknetCrawlApi,
  host: string
): DarknetServerDetailsForFormulas | null {
  try {
    return dnet.getServerDetails(host)
  } catch {
    return null
  }
}

async function runOneCrawlPass(
  ns: NS,
  reportPort: number,
  lorePort: number,
  remainingDepth: number,
  dnet: DarknetCrawlApi,
  passwordCache: Map<string, string>,
  waitForChildren: boolean
): Promise<void> {
  const hostname = ns.getHostname()

  try {
    await ensureSessionOnSelf(ns, dnet, passwordCache)
  } catch {
    return
  }

  const selfDetails = safeGetSessionDetails(dnet, hostname)
  if (!selfDetails) {
    return
  }

  writeCrawlReport(ns, reportPort, {
    hostname,
    authenticated: selfDetails.hasSession ? true : null,
    password: null,
  })

  if (remainingDepth <= 0) {
    if (selfDetails.hasSession) {
      await archiveLocalServerFiles(ns, dnet, reportPort, lorePort)
    }
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

  let neighbors: string[]
  try {
    neighbors = dnet.probe()
  } catch {
    return
  }

  // Archive files after probe so we have neighbors for password-intel parsing
  if (selfDetails.hasSession) {
    await archiveLocalServerFiles(ns, dnet, reportPort, lorePort, neighbors)
  }

  for (const neighbor of neighbors) {
    const auth = await tryAuthNeighbor(
      ns,
      reportPort,
      dnet,
      neighbor,
      passwordCache.get(neighbor) ?? null
    )
    if (auth.password != null) {
      passwordCache.set(neighbor, auth.password)
    }
    writeCrawlReport(ns, reportPort, {
      hostname: neighbor,
      parentHost: hostname,
      authenticated: auth.authenticated,
      password: auth.password,
      authGuesses: auth.authGuesses,
    })

    const neighborDetails = safeGetSessionDetails(dnet, neighbor)
    if (!neighborDetails?.hasSession) {
      continue
    }

    const childDepth = remainingDepth - 1
    if (childDepth < 0) {
      continue
    }

    writeCrawlStatus(ns, reportPort, {
      workerHost: hostname,
      targetHost: neighbor,
      phase: "spawn",
      etaMs: 0,
      detail: childDepth === 0 ? "archive" : `depth ${childDepth}`,
    })

    const pid = await spawnCrawlWorkerOnHost(
      ns,
      neighbor,
      reportPort,
      lorePort,
      childDepth,
      passwordCache,
      hostname,
      waitForChildren
    )
    if (pid > 0 && waitForChildren) {
      childPids.push(pid)
    }
  }

  if (waitForChildren && childPids.length > 0) {
    writeCrawlStatus(ns, reportPort, {
      workerHost: hostname,
      targetHost: hostname,
      phase: "wait",
      etaMs: 0,
      detail: `${childPids.length} child worker(s)`,
    })
    await waitForChildPids(ns, childPids)
  }
}

async function runCrawlWorker(ns: NS): Promise<void> {
  const reportPort = Number(ns.args[1])
  const lorePort = Number(ns.args[2])
  const remainingDepth = Number(ns.args[3])
  const waitForChildren = Number(ns.args[4]) === 1
  if (
    !Number.isInteger(reportPort) || reportPort <= 0 ||
    !Number.isInteger(lorePort) || lorePort <= 0 ||
    !Number.isInteger(remainingDepth)
  ) {
    return
  }

  const dnet = (ns as NS & { dnet?: DarknetCrawlApi }).dnet
  if (!dnet) {
    return
  }

  const passwordCache = loadWorkerPasswordCache(ns)
  await runOneCrawlPass(ns, reportPort, lorePort, remainingDepth, dnet, passwordCache, waitForChildren)
  if (ns.getHostname() === DARKWEB) {
    writeCrawlCycleComplete(ns, reportPort)
  }
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
    if (row.type === "cycleComplete") {
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

function applyPasswordIntel(registry: DarknetRegistry, raw: unknown): void {
  const parsed = raw as Record<string, unknown>
  if (!Array.isArray(parsed.entries)) return
  const msgTimestamp = typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now()
  const sourceHost = typeof parsed.sourceHost === "string" ? parsed.sourceHost : "unknown"
  const neighbors: string[] = Array.isArray(parsed.neighbors)
    ? parsed.neighbors.filter((n): n is string => typeof n === "string")
    : []

  for (const entry of parsed.entries) {
    const e = entry as Record<string, unknown>
    const kind = e.kind as string | undefined

    if (kind === "explicit" || kind === "remember") {
      const password = typeof e.password === "string" ? e.password : null
      if (!password) continue

      if (kind === "explicit") {
        const host = typeof e.host === "string" ? e.host.trim() : null
        if (!host) continue
        const server = registry.servers[host]
        // Only overwrite if we have newer data
        if (server) {
          if (server.timestamp != null && server.timestamp >= msgTimestamp) continue
          server.password = password
          server.timestamp = msgTimestamp
        } else {
          registry.servers[host] = {
            hostname: host,
            parentHost: null,
            password,
            timestamp: msgTimestamp,
            passwordHints: [],
          }
        }
      } else {
        // "remember" — password for one of the neighbors
        const dedupKey = `${password}|${sourceHost}`
        const exists = registry.rememberedPasswords.some(
          (rp) => `${rp.password}|${rp.sourceHost}` === dedupKey
        )
        if (!exists) {
          registry.rememberedPasswords.push({
            password,
            sourceHost,
            neighborHosts: neighbors,
            timestamp: msgTimestamp,
          })
        }
      }
    } else if (kind === "hint") {
      const host = typeof e.host === "string" ? e.host.trim() : null
      const chars = typeof e.chars === "string" ? e.chars : null
      if (!host || !chars) continue
      const server = registry.servers[host]
      // Check if this exact hint was already recorded at the same or newer time
      const duplicate = server?.passwordHints.some(
        (h) => h.chars === chars && h.timestamp >= msgTimestamp
      )
      if (!duplicate) {
        const record: PasswordHintRecord = { chars, timestamp: msgTimestamp }
        if (server) {
          server.passwordHints.push(record)
        } else {
          registry.servers[host] = {
            hostname: host,
            parentHost: null,
            password: null,
            timestamp: null,
            passwordHints: [record],
          }
        }
      }
    }
  }
}

function applyCrawlPortMessage(
  ns: NS,
  raw: unknown,
  reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>,
  cacheOpens: CrawlCacheOpen[],
  cycleComplete?: { value: boolean },
  registry?: DarknetRegistry
): void {
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
    if (typeof parsed !== "object" || parsed === null) {
      return
    }
    const row = parsed as Record<string, unknown>
    if (row.type === "cycleComplete") {
      if (cycleComplete) {
        cycleComplete.value = true
      }
      return
    }
    const cacheOpen = parseCacheOpen(row)
    if (cacheOpen) {
      cacheOpens.push(cacheOpen)
      return
    }
    if (row.type === "archive" && typeof row.file === "string" && typeof row.content === "string") {
      finalizeArchiveContent(ns, row.file, row.content)
      return
    }
    if (row.type === "passwordIntel" && registry) {
      applyPasswordIntel(registry, parsed)
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
  cacheOpens: CrawlCacheOpen[],
  cycleComplete?: { value: boolean },
  registry?: DarknetRegistry
): void {
  while (true) {
    const raw = ns.readPort(port)
    if (raw === "NULL PORT DATA") break
    applyCrawlPortMessage(ns, raw, reports, activeOps, cacheOpens, cycleComplete, registry)
  }
}

function pollCrawlPort(
  ns: NS,
  port: number,
  reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>,
  cacheOpens: CrawlCacheOpen[],
  cycleComplete?: { value: boolean },
  registry?: DarknetRegistry
): void {
  while (true) {
    const raw = ns.peek(port)
    if (raw === "NULL PORT DATA") break
    ns.readPort(port)
    applyCrawlPortMessage(ns, raw, reports, activeOps, cacheOpens, cycleComplete, registry)
  }
}

function pollTextPort(ns: NS, port: number, textSet: Set<string>, file: string): void {
  while (true) {
    const raw = ns.peek(port)
    if (raw === "NULL PORT DATA") break
    ns.readPort(port)
    if (typeof raw !== "string") continue
    if (textSet.has(raw)) continue
    textSet.add(raw)
    syncDarknetTextFile(ns, file, textSet)
  }
}

function drainTextPort(ns: NS, port: number, textSet: Set<string>, file: string): void {
  while (true) {
    const raw = ns.readPort(port)
    if (raw === "NULL PORT DATA") break
    if (typeof raw !== "string") continue
    if (textSet.has(raw)) continue
    textSet.add(raw)
    syncDarknetTextFile(ns, file, textSet)
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
  } else {
    tryConnectToSession(dnet, DARKWEB, "")
  }
}

async function launchDarkwebCrawlWorker(
  ns: NS,
  reportPort: number,
  lorePort: number,
  source: string,
  maxDepth: number,
  registry: DarknetRegistry | undefined,
  waitForChildren: boolean
): Promise<number> {
  await copyCrawlScript(ns, DARKWEB, source)
  const registryJson = registry
    ? serializePasswordMap(registryToPasswordMap(registry))
    : "{}"
  const workerRam = ns.getScriptRam(DARKNET_CRAWL_SCRIPT, DARKWEB)
  const freeRam = ns.getServerMaxRam(DARKWEB) - ns.getServerUsedRam(DARKWEB)
  if (workerRam > freeRam) {
    throw new Error(
      `Not enough RAM on ${DARKWEB} for ${DARKNET_CRAWL_SCRIPT} (need ${ns.format.ram(workerRam)}, free ${ns.format.ram(freeRam)})`
    )
  }
  const pid = ns.exec(
    DARKNET_CRAWL_SCRIPT,
    DARKWEB,
    1,
    ...crawlWorkerArgs(reportPort, lorePort, maxDepth, registryJson, waitForChildren)
  )
  if (pid === 0) {
    throw new Error(`Could not exec ${DARKNET_CRAWL_SCRIPT} on ${DARKWEB}`)
  }
  return pid
}

async function ensureSessionOnSelf(
  ns: NS,
  dnet: DarknetCrawlApi,
  passwordCache: Map<string, string>
): Promise<void> {
  const hostname = ns.getHostname()
  if (dnet.getServerDetails(hostname).hasSession) {
    return
  }
  const password = passwordCache.get(hostname)
  if (password == null) {
    return
  }
  if (tryConnectToSession(dnet, hostname, password)) {
    return
  }
  await dnet.authenticate(hostname, password)
}

function crawlWorkerHosts(ns: NS, registry?: DarknetRegistry): string[] {
  const hosts = new Set<string>([ns.getHostname(), DARKWEB])
  if (registry) {
    for (const hostname of Object.keys(registry.servers)) {
      hosts.add(hostname)
    }
  }
  return [...hosts]
}

async function killCrawlWorkersOnHost(
  ns: NS,
  dnet: DarknetCrawlApi,
  host: string,
  password: string | null | undefined
): Promise<void> {
  if (host !== ns.getHostname() && password != null) {
    tryConnectToSession(dnet, host, password)
  }
  try {
    ns.scriptKill(DARKNET_CRAWL_SCRIPT, host)
  } catch {
    // host removed from darknet or no access
  }
}

/** Kill every darknetCrawl.js instance on known crawl hosts (registry + home + darkweb). */
export async function killAllCrawlWorkers(
  ns: NS,
  dnet: DarknetCrawlApi,
  registry?: DarknetRegistry
): Promise<void> {
  for (const host of crawlWorkerHosts(ns, registry)) {
    await killCrawlWorkersOnHost(ns, dnet, host, registry?.servers[host]?.password ?? null)
  }
}

export async function runDarknetCrawl(
  ns: NS,
  dnet: DarknetCrawlApi,
  reportPort: number,
  lorePort: number,
  maxDepth = MAX_PROBE_DEPTH,
  onProgress?: CrawlProgressHandler,
  registry?: DarknetRegistry,
  intervalMs = 0,
  onCycleComplete?: CrawlCycleCompleteHandler,
  onWorkerError?: CrawlErrorHandler
): Promise<DarknetCrawlResult> {
  const source = ns.getHostname()
  const continuous = intervalMs > 0

  if (registry) {
    pruneInvalidRegistryHosts(dnet, registry)
    saveDarknetRegistry(ns, registry)
  }

  await authenticateDarkwebEntry(ns, dnet, registry?.servers[DARKWEB]?.password)
  await killAllCrawlWorkers(ns, dnet, registry)
  await ns.sleep(5000)

  ns.clearPort(reportPort)
  ns.clearPort(lorePort)

  const loreSet = loadDarknetTextSet(ns, DARKNET_LORE_FILE)

  let pid = await launchDarkwebCrawlWorker(ns, reportPort, lorePort, source, maxDepth, registry, !continuous)

  const reports = new Map<string, CrawlHostReport>()
  const activeOps = new Map<string, CrawlStatusReport>()
  const cacheOpens: CrawlCacheOpen[] = []
  const cycleComplete = { value: false }

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

  if (continuous) {
    while (true) {
      pollCrawlPort(ns, reportPort, reports, activeOps, cacheOpens, cycleComplete, registry)
      pollTextPort(ns, lorePort, loreSet, DARKNET_LORE_FILE)
      if (cycleComplete.value) {
        cycleComplete.value = false
        const result: DarknetCrawlResult = {
          reports: new Map(reports),
          cacheOpens: [...cacheOpens],
        }
        if (onCycleComplete) {
          await onCycleComplete(result)
        }
        if (registry) {
          saveDarknetRegistry(ns, registry)
        }
        reports.clear()
        activeOps.clear()
        cacheOpens.length = 0
        await killAllCrawlWorkers(ns, dnet, registry)
        await ns.sleep(intervalMs)
        pid = await launchDarkwebCrawlWorker(ns, reportPort, lorePort, source, maxDepth, registry, false)
      }
      await emitProgress(true)
      if (!ns.isRunning(pid)) {
        onWorkerError?.(`${DARKNET_CRAWL_SCRIPT} worker on ${DARKWEB} stopped unexpectedly — restarting crawl`)
        try {
          await killAllCrawlWorkers(ns, dnet, registry)
          await authenticateDarkwebEntry(ns, dnet, registry?.servers[DARKWEB]?.password)
          reports.clear()
          activeOps.clear()
          ns.clearPort(reportPort)
          ns.clearPort(lorePort)
          await ns.sleep(5000)
          pid = await launchDarkwebCrawlWorker(ns, reportPort, lorePort, source, maxDepth, registry, false)
        } catch (restartErr) {
          onWorkerError?.(`Failed to restart crawl worker: ${String(restartErr)} — retrying in 30s`)
          await ns.sleep(30000)
          continue
        }
      }
      await ns.sleep(100)
    }
  }

  while (ns.isRunning(pid)) {
    pollCrawlPort(ns, reportPort, reports, activeOps, cacheOpens, undefined, registry)
    pollTextPort(ns, lorePort, loreSet, DARKNET_LORE_FILE)
    await emitProgress(true)
    await ns.sleep(100)
  }

  drainCrawlPort(ns, reportPort, reports, activeOps, cacheOpens, undefined, registry)
  drainTextPort(ns, lorePort, loreSet, DARKNET_LORE_FILE)
  await emitProgress(false)

  return { reports, cacheOpens }
}

// --- entry ---

export async function main(ns: NS): Promise<void> {
  if (ns.args[0] === WORKER_MODE_ARG) {
    await runCrawlWorker(ns)
  }
}
