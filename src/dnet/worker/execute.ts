import { NS } from "@ns"
import type { DnetApi } from "../types.js"
import type { WorkerCommand } from "./protocol.js"

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
  dnet: DnetApi,
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

function isNeighbor(dnet: DnetApi, target: string): boolean {
  try {
    return dnet.getServerDetails(target).isConnectedToCurrentServer
  } catch {
    return false
  }
}

export async function executeCommand(
  ns: NS,
  dnet: DnetApi,
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

export async function runProbe(
  ns: NS,
  dnet: DnetApi,
  replyPort: number,
): Promise<void> {
  const workerHost = ns.getHostname()
  let neighbors: string[] = []
  try {
    neighbors = dnet.probe()
  } catch {
    neighbors = []
  }
  const freeRam = ns.getServerMaxRam(workerHost) - ns.getServerUsedRam(workerHost)
  const blockedRam = dnet.getBlockedRam?.(workerHost) ?? 0
  ns.writePort(
    replyPort,
    JSON.stringify({
      type: "probeResult",
      workerHost,
      neighbors,
      freeRam,
      blockedRam,
    }),
  )
}

export async function ensureSelfAuth(
  dnet: DnetApi,
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
