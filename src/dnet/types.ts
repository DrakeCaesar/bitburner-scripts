/** Shared types for the dnet v2 darknet auth crawler. */

export type PasswordFormat = "numeric" | "alphabetic" | "alphanumeric" | "ASCII" | "unicode"

export interface ServerDetails {
  hasSession: boolean
  isOnline: boolean
  isConnectedToCurrentServer: boolean
  isStationary: boolean
  blockedRam: number
  modelId: string
  passwordFormat: PasswordFormat
  passwordHint: string
  passwordLength: number
  data: string
  depth: number
  difficulty: number
  requiredCharismaSkill: number
  logTrafficInterval: number
}

export interface DnetApi {
  probe(): string[]
  authenticate(
    host: string,
    password: string,
    additionalMsec?: number,
  ): Promise<{ success: boolean; code?: number; message?: string; data?: unknown }>
  heartbleed(host: string, options?: { peek?: boolean }): Promise<{ success: boolean; logs: string[] }>
  connectToSession?(host: string, password: string): { success: boolean }
  getServerDetails(host?: string): ServerDetails
  openCache(filename: string, suppressToast?: boolean): { success: boolean; message: string; karmaLoss: number }
  labreport?(): Promise<{
    success: boolean
    coords: number[]
    north: boolean
    east: boolean
    south: boolean
    west: boolean
  }>
  memoryReallocation?(host?: string): Promise<{ success: boolean }>
  getBlockedRam?(host?: string): number
}

export type TargetStatus =
  | "discovered"
  | "queued"
  | "active"
  | "waiting_worker"
  | "solved"
  | "exhausted"
  | "retry_wait"
  | "no_solver"
  | "unsupported"
  | "offline"

export interface AuthTarget {
  host: string
  modelId: string
  format: PasswordFormat
  status: TargetStatus
  password: string | null
  solverId: string | null
  solverState: unknown | null
  /** Monotonic session counter; increments on each solver restart. */
  session: number
  workerHost: string | null
  neighborWorkers: string[]
  pendingGuess: string | null
  pendingDetail: string | null
  guessCount: number
  retryAt: number | null
  lastError: string | null
  /** After notNeighbor, hold auth until an urgent probe refreshes neighbor links. */
  awaitProbeAfter: boolean
  /** Worker that must finish an urgent probe before awaitProbeAfter clears. */
  awaitProbeWorker: string | null
}

export type AttemptKind =
  | "session_start"
  | "session_end"
  | "guess_dispatch"
  | "guess_result"
  | "heartbleed"
  | "probe"
  | "spawn"
  | "note"

export interface AttemptRecord {
  id: number
  at: number
  host: string
  session: number
  kind: AttemptKind
  solverId: string
  modelId: string
  workerHost?: string
  guess?: string
  detail?: string
  success?: boolean
  feedback?: string
  message?: string
  heartbleedLogs?: readonly string[]
  solverState?: unknown
  note?: string
}

export interface SessionEvent {
  at: number
  kind: AttemptKind
  guess?: string
  detail?: string
  success?: boolean
  feedback?: string
  message?: string
  heartbleedLogs?: readonly string[]
  note?: string
  workerHost?: string
}

export interface AuthAssignment {
  host: string
  modelId: string
  format: PasswordFormat
  passwordHint: string
  passwordLength: number
  data: string
  depth: number
  difficulty: number
  requiredCharismaSkill: number
}

export interface FailedAuthSession {
  id: string
  host: string
  session: number
  solverId: string
  startedAt: number
  archivedAt: number
  reason: string
  assignment: AuthAssignment
  events: readonly SessionEvent[]
}

export interface WorkerSnapshot {
  host: string
  pid: number
  commandPort: number
  idle: boolean
  neighbors: string[]
  lastCommand: string | null
  lastReply: string | null
  freeRam: number
  blockedRam: number
}

export interface MasterActionRecord {
  id: number
  at: number
  action: string
  detail?: string
}

export interface MutationPortSnapshot {
  /** Raw ns.peek() value from MUTATION_PORT at loop start. */
  portRaw: string
  /** Parsed port timestamp, or null if empty/invalid. */
  portTs: number | null
  acked: number
  pending: number | null
  stale: boolean
  /** Port ts advanced past the in-flight pending sync generation. */
  pendingBehindPort: boolean
  /** Real-world time when the coordinator read the port this loop. */
  loopAt: number
}

export interface CrawlSnapshot {
  sessionId: number
  targets: readonly AuthTarget[]
  attempts: readonly AttemptRecord[]
  actions: readonly MasterActionRecord[]
  failedSessions: readonly FailedAuthSession[]
  mutation: MutationPortSnapshot
  workers: readonly WorkerSnapshot[]
  summary: {
    discovered: number
    active: number
    solved: number
    exhausted: number
    retryWait: number
    noSolver: number
    unsupported: number
  }
}

export type ProgressHandler = (snapshot: CrawlSnapshot) => void | Promise<void>
