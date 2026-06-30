/** Worker command and response message types. */

export interface CommandMeta {
  expectedMs: number
  deadlineAt: number
}

export type WorkerCommandPayload =
  | { type: "probe" }
  | { type: "auth"; target: string; solverId: string; guess: string; detail: string | null }
  | { type: "heartbleed"; target: string; solverId: string }
  | { type: "spawn"; target: string; sessionId: number; port: number; password?: string }
  | { type: "realloc"; priority: 1 | 2 | 3 }
  | { type: "exit" }

/** Commands that still use master-attached expectedMs/deadlineAt metadata. */
export type WorkerCommandWithMeta = Exclude<WorkerCommandPayload, { type: "auth" | "probe" }> & CommandMeta

export type WorkerCommand =
  | ({ type: "auth" } & Extract<WorkerCommandPayload, { type: "auth" }>)
  | ({ type: "probe" } & Extract<WorkerCommandPayload, { type: "probe" }>)
  | WorkerCommandWithMeta

export interface NeighborProbeStatus {
  host: string
  /** getServerDetails succeeded for this host. */
  detailsKnown: boolean
  isOnline: boolean
  /** Direct link from the probing worker to this host. */
  isConnected: boolean
  /** Session for the probing worker PID on this host (only meaningful when connected). */
  hasSession: boolean
  workerRunning: boolean
  /** ns.isRunning succeeded (only checked when connected and hasSession). */
  workerKnown: boolean
}

export type WorkerResponse =
  | { type: "ready"; workerHost: string; pid: number }
  | { type: "executing"; workerHost: string; commandType: string; deadlineAt: number }
  | { type: "deadline"; workerHost: string; commandType: string; deadlineAt: number }
  | {
      type: "authResult"
      target: string
      solverId: string
      workerHost: string
      guess: string
      success: boolean
      feedback?: string
      message?: string
      code?: number
    }
  | { type: "heartbleedResult"; target: string; solverId: string; logEntries: string[] }
  | {
      type: "probeResult"
      workerHost: string
      neighbors: string[]
      neighborStatus: readonly NeighborProbeStatus[]
      freeRam: number
      blockedRam: number
    }
  | { type: "spawnResult"; workerHost: string; target: string; success: boolean; childPid: number }
  | { type: "reallocResult"; workerHost: string; priority: 1 | 2 | 3; freeRam: number; blockedRam: number }

export function parseWorkerResponse(raw: unknown): WorkerResponse | null {
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
    if (typeof parsed !== "object" || parsed === null) return null
    const row = parsed as Record<string, unknown>
    switch (row.type) {
      case "ready":
        if (typeof row.workerHost !== "string" || typeof row.pid !== "number") return null
        return { type: "ready", workerHost: row.workerHost, pid: row.pid }
      case "executing":
        if (typeof row.workerHost !== "string" || typeof row.commandType !== "string") return null
        return {
          type: "executing",
          workerHost: row.workerHost,
          commandType: row.commandType,
          deadlineAt: typeof row.deadlineAt === "number" ? row.deadlineAt : 0,
        }
      case "deadline":
        if (typeof row.workerHost !== "string" || typeof row.commandType !== "string") return null
        return {
          type: "deadline",
          workerHost: row.workerHost,
          commandType: row.commandType,
          deadlineAt: typeof row.deadlineAt === "number" ? row.deadlineAt : 0,
        }
      case "authResult": {
        if (typeof row.target !== "string" || typeof row.solverId !== "string") return null
        return {
          type: "authResult",
          target: row.target,
          solverId: row.solverId,
          workerHost: typeof row.workerHost === "string" ? row.workerHost : "",
          guess: typeof row.guess === "string" ? row.guess : "",
          success: row.success === true,
          feedback: typeof row.feedback === "string" ? row.feedback : undefined,
          message: typeof row.message === "string" ? row.message : undefined,
          code: typeof row.code === "number" ? row.code : undefined,
        }
      }
      case "heartbleedResult":
        if (typeof row.target !== "string" || typeof row.solverId !== "string") return null
        if (!Array.isArray(row.logEntries)) return null
        return {
          type: "heartbleedResult",
          target: row.target,
          solverId: row.solverId,
          logEntries: row.logEntries.filter((e): e is string => typeof e === "string"),
        }
      case "probeResult":
        if (typeof row.workerHost !== "string") return null
        return {
          type: "probeResult",
          workerHost: row.workerHost,
          neighbors: Array.isArray(row.neighbors) ? row.neighbors.filter((n): n is string => typeof n === "string") : [],
          neighborStatus: parseNeighborProbeStatus(row.neighborStatus),
          freeRam: typeof row.freeRam === "number" ? row.freeRam : 0,
          blockedRam: typeof row.blockedRam === "number" ? row.blockedRam : 0,
        }
      case "spawnResult":
        if (typeof row.workerHost !== "string" || typeof row.target !== "string") return null
        return {
          type: "spawnResult",
          workerHost: row.workerHost,
          target: row.target,
          success: row.success === true,
          childPid: typeof row.childPid === "number" ? row.childPid : 0,
        }
      case "reallocResult": {
        if (typeof row.workerHost !== "string") return null
        const priority = row.priority
        if (priority !== 1 && priority !== 2 && priority !== 3) return null
        return {
          type: "reallocResult",
          workerHost: row.workerHost,
          priority,
          freeRam: typeof row.freeRam === "number" ? row.freeRam : 0,
          blockedRam: typeof row.blockedRam === "number" ? row.blockedRam : 0,
        }
      }
      default:
        return null
    }
  } catch {
    return null
  }
}

function parseNeighborProbeStatus(raw: unknown): NeighborProbeStatus[] {
  if (!Array.isArray(raw)) return []
  const out: NeighborProbeStatus[] = []
  for (const row of raw) {
    if (typeof row !== "object" || row === null) continue
    const rec = row as Record<string, unknown>
    if (typeof rec.host !== "string") continue
    out.push({
      host: rec.host,
      detailsKnown: rec.detailsKnown === true,
      isOnline: rec.isOnline === true,
      isConnected: rec.isConnected === true,
      hasSession: rec.hasSession === true,
      workerRunning: rec.workerRunning === true,
      workerKnown: rec.workerKnown === true,
    })
  }
  return out
}

export function formatCommand(cmd: WorkerCommandPayload): string {
  switch (cmd.type) {
    case "probe":
      return "probe"
    case "auth":
      return `auth:${cmd.target}`
    case "heartbleed":
      return `heartbleed:${cmd.target}`
    case "spawn":
      return `spawn:${cmd.target}`
    case "realloc":
      return `realloc:p${cmd.priority}`
    case "exit":
      return "exit"
  }
}
