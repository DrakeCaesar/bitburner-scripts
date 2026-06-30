import { NS } from "@ns"
import type { WorkerDnetApi } from "./dnetApi.js"
import type { NeighborProbeStatus, WorkerCommand } from "./protocol.js"
import { WORKER_SCRIPT } from "./constants.js"

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

async function scrapeFeedbackAfter401(
  dnet: WorkerDnetApi,
  target: string,
  guess: string,
): Promise<{ data: string; message: string } | null> {
  for (;;) {
    const hb = await dnet.heartbleed(target, { peek: true })
    if (!hb.success || hb.logs.length === 0) return null
    const matched = parseAuthLog(hb.logs[0]!, guess)
    if (matched) return matched
    await dnet.heartbleed(target)
  }
}

function isNeighbor(dnet: WorkerDnetApi, target: string): boolean {
  try {
    return dnet.getServerDetails(target).isConnectedToCurrentServer
  } catch {
    return false
  }
}

export async function executeCommand(
  ns: NS,
  dnet: WorkerDnetApi,
  cmd: WorkerCommand,
  replyPort: number,
): Promise<void> {
  const workerHost = ns.getHostname()

  if (cmd.type === "guess") {
    if (!isNeighbor(dnet, cmd.target)) {
      ns.writePort(
        replyPort,
        JSON.stringify({
          type: "guessResult",
          target: cmd.target,
          solverId: cmd.solverId,
          workerHost,
          guess: cmd.guess,
          success: false,
          message: "notNeighbor",
        }),
      )
      return
    }
    try {
      const result = await dnet.authenticate(cmd.target, cmd.guess)
      if (result.success || result.code === 200) {
        ns.writePort(
          replyPort,
          JSON.stringify({
            type: "guessResult",
            target: cmd.target,
            solverId: cmd.solverId,
            workerHost,
            guess: cmd.guess,
            success: true,
            feedback: normalizeFeedback(result.data),
            code: result.code,
          }),
        )
        return
      }
      let feedback: string | undefined
      let message: string | undefined
      if (result.code === 401) {
        try {
          const authLog = await scrapeFeedbackAfter401(dnet, cmd.target, cmd.guess)
          if (authLog) {
            feedback = authLog.data
            message = authLog.message
          }
        } catch {
          /* heartbleed may fail */
        }
      }
      ns.writePort(
        replyPort,
        JSON.stringify({
          type: "guessResult",
          target: cmd.target,
          solverId: cmd.solverId,
          workerHost,
          guess: cmd.guess,
          success: false,
          feedback,
          message,
          code: result.code,
        }),
      )
    } catch {
      ns.writePort(
        replyPort,
        JSON.stringify({
          type: "guessResult",
          target: cmd.target,
          solverId: cmd.solverId,
          workerHost,
          guess: cmd.guess,
          success: false,
        }),
      )
    }
    return
  }

  if (cmd.type === "heartbleed") {
    if (!isNeighbor(dnet, cmd.target)) {
      ns.writePort(
        replyPort,
        JSON.stringify({
          type: "heartbleedResult",
          target: cmd.target,
          solverId: cmd.solverId,
          logEntries: [],
        }),
      )
      return
    }
    try {
      const result = await dnet.heartbleed(cmd.target)
      ns.writePort(
        replyPort,
        JSON.stringify({
          type: "heartbleedResult",
          target: cmd.target,
          solverId: cmd.solverId,
          logEntries: result.success ? result.logs : [],
        }),
      )
    } catch {
      ns.writePort(
        replyPort,
        JSON.stringify({
          type: "heartbleedResult",
          target: cmd.target,
          solverId: cmd.solverId,
          logEntries: [],
        }),
      )
    }
  }
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
  // isRunning on a neighbor only works when this worker can reach it and has a session there.
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
  if (!password) return
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
  if (!password) return
  try {
    const details = dnet.getServerDetails(hostname)
    if (details.hasSession) return
    await dnet.authenticate(hostname, password)
  } catch {
    /* ignore */
  }
}
