import { NS } from "@ns"
import type { WorkerDnetApi } from "./dnetApi.js"
import type { FormulasServerDetails } from "./taskTiming.js"
import { estimateAuthMs, estimateHeartbleedMs, estimateLabreportMs, estimateReallocMs } from "./taskTiming.js"
import {
  NOT_NEIGHBOR_MESSAGE,
  noAuthFeedbackMessage,
  type NeighborProbeStatus,
  type WorkerCommand,
} from "./protocol.js"
import { WORKER_SCRIPT } from "./constants.js"
import { copyWorkerFiles } from "./deploy.js"
import { measureHostRam, priorityMet } from "./realloc.js"

function normalizeFeedback(data: unknown): string | undefined {
  if (typeof data === "string") return data
  if (typeof data === "boolean") return data ? "true" : "false"
  if (typeof data === "number" && Number.isFinite(data)) return String(data)
  return undefined
}

function parseAuthLog(log: string, guess: string): { data: string; message: string } | null {
  try {
    const entry: unknown = JSON.parse(log)
    if (typeof entry !== "object" || entry === null) return null
    const rec = entry as Record<string, unknown>
    if (String(rec.passwordAttempted) !== guess) return null
    if (rec.code !== 401) return null
    if (typeof rec.message !== "string") return null
    const data = normalizeFeedback(rec.data)
    if (data === undefined) return null
    return { data, message: rec.message }
  } catch {
    return null
  }
}

function isLabyrinthMoveGuess(guess: string): boolean {
  return guess === "n" || guess === "e" || guess === "s" || guess === "w"
}

function labyrinthMoveMessage(message: string | undefined): boolean {
  if (!message) return false
  return (
    message.includes("You have moved to") ||
    message.includes("still at") ||
    message.includes("You cannot go that way")
  )
}

function isNeighbor(dnet: WorkerDnetApi, target: string): boolean {
  try {
    return dnet.getServerDetails(target).isConnectedToCurrentServer
  } catch {
    return false
  }
}

function readFormulasDetails(dnet: WorkerDnetApi, target: string): FormulasServerDetails | null {
  try {
    return dnet.getServerDetails(target) as FormulasServerDetails
  } catch {
    return null
  }
}

type AuthCommand = Extract<WorkerCommand, { type: "auth" }>

export async function runAuthCommand(
  ns: NS,
  dnet: WorkerDnetApi,
  cmd: AuthCommand,
  replyPort: number,
): Promise<void> {
  const workerHost = ns.getHostname()

  const writeDeadline = (deadlineAt: number): void => {
    ns.writePort(
      replyPort,
      JSON.stringify({
        type: "deadline",
        workerHost,
        commandType: "auth",
        deadlineAt,
      }),
    )
  }

  const writeResult = (result: {
    success: boolean
    feedback?: string
    message?: string
    code?: number
  }): void => {
    ns.writePort(
      replyPort,
      JSON.stringify({
        type: "authResult",
        target: cmd.target,
        solverId: cmd.solverId,
        workerHost,
        guess: cmd.guess,
        ...result,
      }),
    )
  }

  if (!isNeighbor(dnet, cmd.target)) {
    writeResult({ success: false, message: NOT_NEIGHBOR_MESSAGE })
    return
  }

  const details = readFormulasDetails(dnet, cmd.target)
  if (!details) {
    writeResult({ success: false, message: "noDetails" })
    return
  }

  writeDeadline(Date.now() + estimateAuthMs(ns, details, cmd.guess))

  try {
    const result = await dnet.authenticate(cmd.target, cmd.guess)
    if (result.success || result.code === 200) {
      writeResult({
        success: true,
        feedback: normalizeFeedback(result.data),
        code: result.code,
      })
      return
    }

    if (result.code !== 401) {
      writeResult({
        success: false,
        message: result.message,
        code: result.code,
      })
      return
    }

    if (isLabyrinthMoveGuess(cmd.guess) && labyrinthMoveMessage(result.message)) {
      writeResult({
        success: false,
        feedback: normalizeFeedback(result.data),
        message: result.message,
        code: result.code,
      })
      return
    }

    while (true) {
      writeDeadline(Date.now() + estimateHeartbleedMs(ns, details))

      const hb = await dnet.heartbleed(cmd.target, { peek: true })
      if (!hb.success || hb.logs.length === 0) {
        writeResult({
          success: false,
          message: noAuthFeedbackMessage(hb),
          code: result.code,
        })
        return
      }

      const matched = parseAuthLog(hb.logs[0]!, cmd.guess)
      if (matched) {
        writeResult({
          success: false,
          feedback: matched.data,
          message: matched.message,
          code: result.code,
        })
        return
      }

      await dnet.heartbleed(cmd.target)
    }
  } catch {
    writeResult({ success: false, message: "auth command error" })
  }
}

export async function runLabreportCommand(
  ns: NS,
  dnet: WorkerDnetApi,
  cmd: Extract<WorkerCommand, { type: "labreport" }>,
  replyPort: number,
): Promise<void> {
  const workerHost = ns.getHostname()

  const writeResult = (payload: {
    coords: [number, number]
    north: boolean
    east: boolean
    south: boolean
    west: boolean
  }): void => {
    ns.writePort(
      replyPort,
      JSON.stringify({
        type: "labreportResult",
        target: cmd.target,
        solverId: cmd.solverId,
        workerHost,
        ...payload,
      }),
    )
  }

  if (!dnet.labreport) return

  const details = readFormulasDetails(dnet, cmd.target)
  if (details) {
    ns.writePort(
      replyPort,
      JSON.stringify({
        type: "deadline",
        workerHost,
        commandType: "labreport",
        deadlineAt: Date.now() + estimateLabreportMs(ns, details),
      }),
    )
  }

  try {
    const result = await dnet.labreport()
    if (!result.success || !Array.isArray(result.coords) || result.coords.length < 2) return
    const x = Number(result.coords[0])
    const y = Number(result.coords[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    writeResult({
      coords: [x, y],
      north: result.north === true,
      east: result.east === true,
      south: result.south === true,
      west: result.west === true,
    })
  } catch {
    /* coordinator handles timeout */
  }
}

export async function runHeartbleedCommand(
  ns: NS,
  dnet: WorkerDnetApi,
  cmd: Extract<WorkerCommand, { type: "heartbleed" }>,
  replyPort: number,
): Promise<void> {
  const workerHost = ns.getHostname()

  const writeResult = (logEntries: string[]): void => {
    ns.writePort(
      replyPort,
      JSON.stringify({
        type: "heartbleedResult",
        target: cmd.target,
        solverId: cmd.solverId,
        logEntries,
      }),
    )
  }

  if (!isNeighbor(dnet, cmd.target)) {
    writeResult([])
    return
  }

  const details = readFormulasDetails(dnet, cmd.target)
  if (details) {
    ns.writePort(
      replyPort,
      JSON.stringify({
        type: "deadline",
        workerHost,
        commandType: "heartbleed",
        deadlineAt: Date.now() + estimateHeartbleedMs(ns, details),
      }),
    )
  }

  try {
    const result = await dnet.heartbleed(cmd.target)
    writeResult(result.success ? result.logs : [])
  } catch {
    writeResult([])
  }
}

export async function runReallocCommand(
  ns: NS,
  dnet: WorkerDnetApi,
  cmd: Extract<WorkerCommand, { type: "realloc" }>,
  replyPort: number,
): Promise<void> {
  const workerHost = ns.getHostname()
  const host = cmd.host

  const writeDeadline = (): void => {
    ns.writePort(
      replyPort,
      JSON.stringify({
        type: "deadline",
        workerHost,
        commandType: "realloc",
        deadlineAt: Date.now() + estimateReallocMs(ns),
      }),
    )
  }

  const writeResult = (freeRam: number, blockedRam: number): void => {
    ns.writePort(
      replyPort,
      JSON.stringify({
        type: "reallocResult",
        workerHost,
        host,
        priority: cmd.priority,
        freeRam,
        blockedRam,
      }),
    )
  }

  if (!dnet.memoryReallocation) {
    const ram = measureHostRam(ns, dnet, host)
    writeResult(ram.freeRam, ram.blockedRam)
    return
  }

  while (true) {
    if (priorityMet(ns, dnet, host, cmd.priority)) {
      const ram = measureHostRam(ns, dnet, host)
      writeResult(ram.freeRam, ram.blockedRam)
      return
    }
    const { blockedRam } = measureHostRam(ns, dnet, host)
    if (blockedRam <= 0) {
      const ram = measureHostRam(ns, dnet, host)
      writeResult(ram.freeRam, ram.blockedRam)
      return
    }

    writeDeadline()
    try {
      await dnet.memoryReallocation(host)
    } catch {
      const ram = measureHostRam(ns, dnet, host)
      writeResult(ram.freeRam, ram.blockedRam)
      return
    }
  }
}

export async function runSpawnCommand(
  ns: NS,
  dnet: WorkerDnetApi,
  cmd: Extract<WorkerCommand, { type: "spawn" }>,
  replyPort: number,
  activeSessionId: number,
): Promise<void> {
  const workerHost = ns.getHostname()
  let childPid = 0
  let success = false
  let message = ""

  try {
    let neighbors: string[] = []
    try {
      neighbors = dnet.probe()
    } catch {
      neighbors = []
    }
    if (!neighbors.includes(cmd.target)) {
      message = NOT_NEIGHBOR_MESSAGE
    }

    if (!message) {
      try {
        if (!dnet.getServerDetails(cmd.target).hasSession) {
          if (cmd.password === undefined) {
            message = "auth failed"
          } else {
            await ensureTargetAuth(dnet, cmd.target, cmd.password)
            if (!dnet.getServerDetails(cmd.target).hasSession) {
              message = "auth failed"
            }
          }
        }
      } catch {
        message = "auth failed"
      }
    }

    if (!message) {
      const scpError = await copyWorkerFiles(ns, cmd.target, workerHost)
      if (scpError != null) {
        message = scpError
      }
    }

    if (!message) {
      const childRam = ns.getScriptRam(WORKER_SCRIPT, cmd.target)
      const free = ns.getServerMaxRam(cmd.target) - ns.getServerUsedRam(cmd.target)
      if (childRam > free) {
        message = `need ${childRam.toFixed(1)}GB, ${free.toFixed(1)}GB free`
      } else {
        childPid = ns.exec(
          WORKER_SCRIPT,
          cmd.target,
          1,
          activeSessionId,
          cmd.port,
          cmd.password ?? "",
        )
        if (childPid > 0) {
          success = true
        } else {
          message = "exec failed"
        }
      }
    }
  } catch (err) {
    message = err instanceof Error ? err.message : "spawn error"
  }

  ns.writePort(
    replyPort,
    JSON.stringify({
      type: "spawnResult",
      workerHost,
      target: cmd.target,
      success,
      childPid,
      ...(message ? { message } : {}),
    }),
  )
}

function probeNeighbor(
  ns: NS,
  dnet: WorkerDnetApi,
  host: string,
): NeighborProbeStatus {
  let detailsKnown = false
  let isOnline = false
  let isConnected = false
  let hasSession = false
  try {
    const details = dnet.getServerDetails(host)
    detailsKnown = true
    isOnline = details.isOnline
    isConnected = details.isConnectedToCurrentServer
    hasSession = details.hasSession
  } catch {
    return {
      host,
      detailsKnown: false,
      isOnline: false,
      isConnected: false,
      hasSession: false,
      workerRunning: false,
      workerKnown: false,
    }
  }

  let workerRunning = false
  let workerKnown = false
  if (isOnline && isConnected && hasSession) {
    try {
      workerRunning = ns.isRunning(WORKER_SCRIPT, host)
      workerKnown = true
    } catch {
      workerKnown = false
    }
  }

  return {
    host,
    detailsKnown,
    isOnline,
    isConnected,
    hasSession,
    workerRunning,
    workerKnown,
  }
}

export async function ensureTargetAuth(
  dnet: WorkerDnetApi,
  target: string,
  password: string | undefined,
): Promise<void> {
  if (password === undefined) return
  try {
    if (dnet.getServerDetails(target).hasSession) return
    if (dnet.connectToSession?.(target, password).success) return
    await dnet.authenticate(target, password)
  } catch {
    /* ignore */
  }
}

export async function runProbe(
  ns: NS,
  dnet: WorkerDnetApi,
  replyPort: number,
): Promise<void> {
  const workerHost = ns.getHostname()
  let neighbors: string[] = []
  try {
    neighbors = dnet.probe()
  } catch {
    neighbors = []
  }
  const neighborStatus = neighbors.map((host) => probeNeighbor(ns, dnet, host))
  const workerRam = ns.getScriptRam(WORKER_SCRIPT, workerHost)
  const totalFree = ns.getServerMaxRam(workerHost) - ns.getServerUsedRam(workerHost)
  const blockedRam = dnet.getBlockedRam?.(workerHost) ?? 0
  ns.writePort(
    replyPort,
    JSON.stringify({
      type: "probeResult",
      workerHost,
      neighbors,
      neighborStatus,
      freeRam: totalFree - workerRam,
      blockedRam,
    }),
  )
}

export async function ensureSelfAuth(
  dnet: WorkerDnetApi,
  hostname: string,
  password: string | undefined,
): Promise<void> {
  if (password === undefined) return
  try {
    const details = dnet.getServerDetails(hostname)
    if (details.hasSession) return
    await dnet.authenticate(hostname, password)
  } catch {
    /* ignore */
  }
}
