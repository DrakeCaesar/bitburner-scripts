/** Worker command and response message types. */

/** Worker result message when a command target is not a direct neighbor. */
export const NOT_NEIGHBOR_MESSAGE = "notNeighbor"

/** Auth returned 401 (expected wrong guess) but heartbleed did not yield model feedback. */
export function noAuthFeedbackMessage(hb: {
  success: boolean
  logs: string[]
  message?: string
}): string {
  if (!hb.success) {
    if (hb.message === "Direct Connection Required") {
      return "no auth feedback (not connected)"
    }
    if (hb.message === "Not Enough Charisma") {
      return "no auth feedback (charisma too low)"
    }
    if (hb.message && hb.message !== "Unauthorized" && hb.message !== "Success") {
      return `no auth feedback (${hb.message})`
    }
    return "no auth feedback (heartbleed failed)"
  }
  return "no auth feedback (empty log)"
}

export type WorkerCommandPayload =
  | { type: "probe" }
  | { type: "auth"; target: string; solverId: string; guess: string; detail: string | null }
  | { type: "heartbleed"; target: string; solverId: string }
  | {
      type: "spawn"
      target: string
      sessionId: number
      port: number
      password?: string
      /** Spawn via stasis link (connectToSession + scp + exec at distance). */
      remote?: boolean
    }
  | { type: "realloc"; host: string; priority: 1 | 2 | 3 }
  | { type: "migrate" }
  | { type: "stasis" }
  | { type: "labreport"; target: string; solverId: string }
  | { type: "exit" }

export type WorkerCommand = WorkerCommandPayload

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
  /** Darknet depth from getDepth / getServerDetails when detailsKnown. */
  depth: number | null
}

export type WorkerResponse =
  | { type: "ready"; workerHost: string; pid: number }
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
      /** Probing worker host depth from getDepth / getServerDetails. */
      workerDepth: number | null
      freeRam: number
      blockedRam: number
    }
  | {
      type: "spawnResult"
      workerHost: string
      target: string
      success: boolean
      childPid: number
      message?: string
    }
  | {
      type: "migrateResult"
      workerHost: string
      target: string
      success: boolean
      message?: string
    }
  | {
      type: "reallocResult"
      workerHost: string
      host: string
      priority: 1 | 2 | 3
      freeRam: number
      blockedRam: number
    }
  | { type: "stasisResult"; workerHost: string; success: boolean; message?: string }
  | {
      type: "labreportResult"
      target: string
      solverId: string
      workerHost: string
      coords: [number, number]
      north: boolean
      east: boolean
      south: boolean
      west: boolean
    }

export function parseWorkerResponse(raw: unknown): WorkerResponse | null {
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
    if (typeof parsed !== "object" || parsed === null) return null
    const row = parsed as Record<string, unknown>
    switch (row.type) {
      case "ready":
        if (typeof row.workerHost !== "string" || typeof row.pid !== "number") return null
        return { type: "ready", workerHost: row.workerHost, pid: row.pid }
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
          workerDepth: parseOptionalDepth(row.workerDepth),
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
          message: typeof row.message === "string" ? row.message : undefined,
        }
      case "reallocResult": {
        if (typeof row.workerHost !== "string" || typeof row.host !== "string") return null
        const priority = row.priority
        if (priority !== 1 && priority !== 2 && priority !== 3) return null
        return {
          type: "reallocResult",
          workerHost: row.workerHost,
          host: row.host,
          priority,
          freeRam: typeof row.freeRam === "number" ? row.freeRam : 0,
          blockedRam: typeof row.blockedRam === "number" ? row.blockedRam : 0,
        }
      }
      case "migrateResult":
        if (typeof row.workerHost !== "string" || typeof row.target !== "string") return null
        return {
          type: "migrateResult",
          workerHost: row.workerHost,
          target: row.target,
          success: row.success === true,
          message: typeof row.message === "string" ? row.message : undefined,
        }
      case "stasisResult":
        if (typeof row.workerHost !== "string") return null
        return {
          type: "stasisResult",
          workerHost: row.workerHost,
          success: row.success === true,
          message: typeof row.message === "string" ? row.message : undefined,
        }
      case "labreportResult": {
        if (typeof row.target !== "string" || typeof row.solverId !== "string") return null
        if (!Array.isArray(row.coords) || row.coords.length < 2) return null
        const x = Number(row.coords[0])
        const y = Number(row.coords[1])
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null
        return {
          type: "labreportResult",
          target: row.target,
          solverId: row.solverId,
          workerHost: typeof row.workerHost === "string" ? row.workerHost : "",
          coords: [x, y],
          north: row.north === true,
          east: row.east === true,
          south: row.south === true,
          west: row.west === true,
        }
      }
      default:
        return null
    }
  } catch {
    return null
  }
}

function parseOptionalDepth(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null
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
      depth: parseOptionalDepth(rec.depth),
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
      return `realloc:${cmd.host}:p${cmd.priority}`
    case "migrate":
      return "migrate"
    case "stasis":
      return "stasis"
    case "labreport":
      return `labreport:${cmd.target}`
    case "exit":
      return "exit"
  }
}

export function usesWorkerDeadlines(cmd: WorkerCommandPayload): boolean {
  return (
    cmd.type === "auth" ||
    cmd.type === "heartbleed" ||
    cmd.type === "realloc" ||
    cmd.type === "labreport" ||
    cmd.type === "migrate"
  )
}

export function isInstantCommand(cmd: WorkerCommandPayload): boolean {
  return cmd.type === "probe" || cmd.type === "spawn"
}
