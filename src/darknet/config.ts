import { NS } from "@ns"

// ---- constants ----

export const DARKNET_CRAWL_SCRIPT = "darknet/worker.js"
export const DARKNET_STASIS_SCRIPT = "darknet/stasisLink.js"
export const DARKNET_REGISTRY_FILE = "darknet-registry.json"
export const DEFAULT_CRAWL_INTERVAL_MS = 60_000
export const DARKWEB = "darkweb"
export const WORKER_MODE_ARG = "worker"

// ---- file categorization (mirrored in darkwebArchiveDupes.ts via import) ----

/** Files whose basename contains one of these go to the lore port → darknet-lore.json. */
export const LORE_FILE_KEYWORDS = ["dreams", "journal", "notes", "search_history", "the_truth", "thoughts"]

/** Files whose basename contains one of these are parsed for password intel but NOT archived to disk. */
export const PASSWORD_FILE_KEYWORDS = ["access", "admin", "credentials", "key", "login", "password", "root", "secrets"]

export function isLoreFile(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return LORE_FILE_KEYWORDS.some((kw) => lower.includes(kw))
}

export function isPasswordFile(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return PASSWORD_FILE_KEYWORDS.some((kw) => lower.includes(kw))
}

export function flatFileName(fileName: string): string {
  return fileName.includes("/") ? (fileName.split("/").pop() ?? fileName) : fileName
}

// ---- persistent text storage files ----

export const DARKNET_LORE_FILE = "darknet-lore.json"
export const DARKWEB_ARCHIVE_DIR = "darkweb"

/**
 * Master-to-worker broadcast port. Workers peek this port each loop to get
 * runtime config. Inlined so the script stays standalone-copyable.
 */
export const CONTROL_PORT = 45109

/** Port pool for per-worker command ports. First port in the pool.
 *  Workers use adjacent port pairs: command port (even) and reply port (odd = command+1). */
export const PORT_POOL_START = 45110
/** Total ports in the pool (each worker uses a pair, so max concurrent workers = PORT_POOL_SIZE). */
export const PORT_POOL_SIZE = 512

/** Log raw dnet.authenticate / dnet.heartbleed return values to the browser dev console. */
export const DNET_DEBUG_RAW_API_CONSOLE = false

/** Log master target registration / prune / report-merge decisions (throttled per host). */
export const DNET_DEBUG_MASTER_DECISIONS = false

/** {@link DarknetServerDetails.modelId} for labyrinth servers (all variants). */
export const LABYRINTH_MODEL_ID = "(The Labyrinth)"

export interface ControlMessage {
  sessionId: number
  lorePort: number
}

// ---- file lists for SCP ----

/** Files that must be copied (via SCP) to darknet nodes for workers to run. */
export const DARKNET_WORKER_FILES = [
  "darknet/config.js",
  "darknet/solverState.js",
  "darknet/worker.js",
]

// --- types ---

export type DarknetPasswordFormat = "numeric" | "alphabetic" | "alphanumeric" | "ASCII" | "unicode"

export interface DarknetAuthSolverInput {
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

/** Snapshot of a single worker for the unified dashboard table. */
export interface WorkerSnapshot {
  host: string
  probed: boolean
  idle: boolean
  lastCommand: string | null
  lastCommandDetail: string | null // guess password, spawn target, etc.
  lastCommandAt: number
  lastReply: string | null
  lastReplyAt: number
  freeRam: number
  blockedRam: number
  neighbors: string[]
}

export interface SolverTiming {
  solverId: string
  count: number
  totalMs: number
}

/** Auth queue state for a target the master is solving via a neighbor worker. */
export type CrawlTargetQueueState = "queued" | "pending" | "unreachable" | "done" | "exhausted"

export interface CrawlTargetSnapshot {
  host: string
  queueState: CrawlTargetQueueState
}

export interface CrawlQueueSummary {
  queued: number
  pending: number
  unreachable: number
  exhausted: number
  staleReports: number
}

export interface CrawlProgressState {
  reports: ReadonlyMap<string, CrawlHostReport>
  activeOps: readonly CrawlStatusReport[]
  workerRunning: boolean
  cacheOpens: readonly CrawlCacheOpen[]
  /** Worker status snapshots for the unified dashboard table. */
  workers: readonly WorkerSnapshot[]
  /** Per-solver execution timing statistics. */
  solverTimings: readonly SolverTiming[]
  /** Targets the master is actively trying to authenticate. */
  targets: readonly CrawlTargetSnapshot[]
  /** Aggregate auth queue counts for the dashboard summary line. */
  queueSummary: CrawlQueueSummary
}

export interface DarknetCrawlResult {
  reports: Map<string, CrawlHostReport>
  cacheOpens: CrawlCacheOpen[]
}

export type CrawlProgressHandler = (state: CrawlProgressState) => void | Promise<void>

export type CrawlErrorHandler = (message: string) => void

/** A single hint discovery: "The password for X contains 7 and 8" */
export interface PasswordHintRecord {
  /** Sorted unique characters (digits or letters). */
  chars: string
  timestamp: number
}

export interface DarknetRegistryEntry {
  hostname: string
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

export const DARKWEB_COMMON_PASSWORDS: readonly string[] = [
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
  "matrix",
]

/** Source: key.data.txt ("Remember this password: …") */
export const DARKWEB_KNOWN_PASSWORDS: readonly string[] = ["27974"]

/**
 * Host -> digits known to appear in the password.
 * Sources: login.data.txt, admin.data.txt, secrets.data.txt, root.data.txt
 */
export const DARKWEB_HOST_DIGIT_HINTS: Readonly<Record<string, readonly string[]>> = {
  "6969": ["5", "8"],
  "hacker-services": ["5", "6"],
  "speakers_for_the_dead:5801": ["1", "3"],
  apexsanctuary: ["0", "7"],
}

export const DARKWEB_NUMERIC_RE = /^\d+$/
export const DARKWEB_ALPHA_RE = /^[a-z]+$/
export const DARKWEB_ALNUM_RE = /^[a-z0-9]+$/

export function normalizeDarkwebHost(host: string): string {
  return host.toLowerCase()
}

export function darkwebHostDigitPool(host: string): string | null {
  const hints = DARKWEB_HOST_DIGIT_HINTS[normalizeDarkwebHost(host)]
  if (!hints || hints.length === 0) {
    return null
  }
  return hints.join("")
}

/** Union of digit characters from archive hint and server password hint text. */
export function mergeDarkwebDigitPools(...pools: string[]): string {
  const digits = new Set<string>()
  for (const pool of pools) {
    for (const ch of pool.replace(/\D/g, "")) {
      digits.add(ch)
    }
  }
  return [...digits].sort().join("")
}

export function darkwebKnownPasswordCandidates(length: number): string[] {
  return DARKWEB_KNOWN_PASSWORDS.filter((password) => password.length === length)
}

export function darkwebCommonPasswordCandidates(length: number, format: DarknetPasswordFormat): string[] {
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

export function darkwebPasswordCandidates(length: number, format: DarknetPasswordFormat): string[] {
  const candidates = new Set([
    ...darkwebKnownPasswordCandidates(length),
    ...darkwebCommonPasswordCandidates(length, format),
  ])
  return [...candidates]
}

// --- shared utilities ---

export interface DarknetCrawlApi {
  probe(): string[]
  authenticate(host: string, password: string, additionalMsec?: number): Promise<{ success: boolean; code?: number; message?: string; data?: unknown }>
  heartbleed(host: string, options?: { peek?: boolean }): Promise<{ success: boolean; logs: string[] }>
  connectToSession?(host: string, password: string): { success: boolean }
  openCache(filename: string, suppressToast?: boolean): { success: boolean; message: string; karmaLoss: number }
  getServerDetails(host?: string): DarknetServerDetailsForFormulas
  labreport?(): Promise<{ success: boolean; coords: number[]; north: boolean; east: boolean; south: boolean; west: boolean }>
  labradar?(): Promise<{ success: boolean; message: string }>
  memoryReallocation?(host?: string): Promise<{ success: boolean }>
  getBlockedRam?(host?: string): number
  setStasisLink?(shouldLink?: boolean): Promise<{ success: boolean; code?: number; message?: string }>
  getStasisLinkLimit?(): number
  getStasisLinkedServers?(returnByIP?: boolean): string[]
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

// ---- worker command / response types ----

/** Per-command timing metadata set by the master before dispatch. */
export interface WorkerCommandMeta {
  /** Predicted execution time in ms (before multiplier). */
  expectedMs: number
  /** Absolute timestamp (Date.now()) by which the worker should finish. */
  deadlineAt: number
}

/** Command body without timing — master attaches expectedMs/deadlineAt at dispatch. */
export type WorkerCommandPayload =
  | { type: "probe" }
  | { type: "guess"; target: string; solverId: string; guess: string; detail: string | null }
  | { type: "heartbleed"; target: string; solverId: string }
  | { type: "labreport"; target: string; solverId: string }
  | { type: "spawn"; target: string; sessionId: number; port: number; password?: string }
  | { type: "realloc" }
  | { type: "stasis" }
  | { type: "exit" }

/** Master writes these to a worker's dedicated command port. Worker reads and executes. */
export type WorkerCommand = WorkerCommandPayload & WorkerCommandMeta

/** Workers write these to their reply port (command port + 1). */
export type WorkerResponse =
  | { type: "ready"; workerHost: string; pid: number }
  | { type: "executing"; workerHost: string; commandType: string; deadlineAt: number }
  | { type: "guessResult"; target: string; solverId: string; workerHost?: string; guess?: string; success: boolean; feedback?: string; message?: string }
  | { type: "heartbleedResult"; target: string; solverId: string; logEntries: string[] }
  | { type: "labreportResult"; target: string; solverId: string; workerHost: string; coords: number[]; north: boolean; east: boolean; south: boolean; west: boolean }
  | { type: "probeResult"; workerHost: string; targets: string[]; freeRam: number; blockedRam: number }
  | { type: "spawnResult"; workerHost: string; target: string; success: boolean; childPid: number }
  | { type: "reallocResult"; workerHost: string; freeRam: number; blockedRam: number }
  | { type: "stasisResult"; workerHost: string; success: boolean }

/** Base interface for solver state machines. Each solver adds its own fields. */
export interface SolverState {
  type: string // unique solver identifier, e.g. "nil", "kingOfTheHill"
}

/** A guess that the master should dispatch to a worker. */
export interface SolverNextGuess {
  guess: string
  detail: string | null
}

/** Result of a single authenticate call, as interpreted from auth response + heartbleed. */
export interface SolverGuessResult {
  success: boolean
  feedback?: string
  message?: string
}

/** Context passed to solver state machine functions. */
export interface SolverContext {
  target: string
  details: DarknetServerDetailsForFormulas
  /** Crawl worker host exploring a labyrinth (game tracks maze position per script PID). */
  explorerWorker?: string
}

/** Solver state machine functions — one module per model. */
export interface SolverModule<S extends SolverState = SolverState> {
  /** Create the initial serializable state from server details. */
  initSolver(details: DarknetServerDetailsForFormulas): S
  /** Return the next guess to dispatch, or null if the solver is done. */
  nextGuess(state: S, context: SolverContext): SolverNextGuess | null
  /** Process the result of a guess. Returns updated state. */
  applyResult(state: S, guess: string, result: SolverGuessResult, context?: SolverContext): S
  /** Process heartbleed log entries. Returns updated state. */
  applyHeartbleed?(state: S, logEntries: string[]): S
  /** Process labreport data (Labyrinth only). workerHost keys the per-worker maze session. */
  applyLabreport?(
    state: S,
    report: { coords: number[]; north: boolean; east: boolean; south: boolean; west: boolean; workerHost: string },
  ): S
}

export function tryConnectToSession(dnet: DarknetCrawlApi, host: string, password: string): boolean {
  if (!dnet.connectToSession || safeGetServerDetails(dnet, host) == null) {
    return false
  }
  try {
    return dnet.connectToSession(host, password).success
  } catch {
    return false
  }
}

// --- UI formatters ---

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

export function writeCrawlReport(ns: NS, port: number, report: CrawlHostReport): void {
  ns.writePort(port, JSON.stringify({ type: "host", ...report }))
}

export function writeCrawlStatus(ns: NS, port: number, status: Omit<CrawlStatusReport, "type">): void {
  ns.writePort(port, JSON.stringify({ type: "status", ...status }))
}
