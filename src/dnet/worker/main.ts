import { NS } from "@ns"
import {
  CONTROL_PORT,
  WORKER_SCRIPT,
  type ControlMessage,
} from "./constants.js"
import type { WorkerDnetApi } from "./dnetApi.js"
import type { WorkerCommand } from "./protocol.js"
import { copyWorkerFiles } from "./deploy.js"
import { ensureTargetAuth, executeCommand, ensureSelfAuth, runProbe } from "./execute.js"
import { runReallocUntil } from "./realloc.js"

/** NS with port wait API (available on current Bitburner fork). */
type NSPortWait = NS & { nextPortWrite(port: number): Promise<void> }

function refreshSessionId(ns: NS, sessionId: number): number {
  const controlRaw = ns.peek(CONTROL_PORT)
  if (controlRaw === "NULL PORT DATA") return sessionId
  try {
    const msg = JSON.parse(String(controlRaw)) as ControlMessage
    if (msg.sessionId > 0) return msg.sessionId
  } catch {
    /* ignore */
  }
  return sessionId
}

/** Read the next command payload, waiting on the port when empty. */
async function readCommandPayload(ns: NS, commandPort: number): Promise<string> {
  let raw = ns.readPort(commandPort)
  if (raw !== "NULL PORT DATA") return String(raw)

  await (ns as NSPortWait).nextPortWrite(commandPort)
  raw = ns.readPort(commandPort)
  return raw === "NULL PORT DATA" ? "" : String(raw)
}

export async function main(ns: NS): Promise<void> {
  const dnet = (ns as NS & { dnet?: WorkerDnetApi }).dnet
  if (!dnet) return

  const sessionId = Number(ns.args[0])
  const commandPort = Number(ns.args[1])
  if (!Number.isFinite(sessionId) || sessionId <= 0) return
  if (!Number.isFinite(commandPort) || commandPort <= 0) return

  const replyPort = commandPort + 1
  const hostname = ns.getHostname()
  const selfPassword = typeof ns.args[2] === "string" && ns.args[2].length > 0 ? ns.args[2] : undefined

  ns.writePort(replyPort, JSON.stringify({ type: "ready", workerHost: hostname, pid: ns.pid }))

  let activeSessionId = sessionId

  while (true) {
    activeSessionId = refreshSessionId(ns, activeSessionId)

    const raw = await readCommandPayload(ns, commandPort)
    if (!raw) continue

    let cmd: WorkerCommand
    try {
      cmd = JSON.parse(raw) as WorkerCommand
    } catch {
      continue
    }

    ns.writePort(
      replyPort,
      JSON.stringify({
        type: "executing",
        workerHost: hostname,
        commandType: cmd.type,
        deadlineAt: cmd.deadlineAt ?? Date.now(),
      }),
    )

    if (cmd.type === "exit") break

    if (cmd.type === "probe") {
      await ensureSelfAuth(dnet, hostname, selfPassword)
      await runProbe(ns, dnet, replyPort)
    } else if (cmd.type === "spawn") {
      await ensureSelfAuth(dnet, hostname, selfPassword)
      let childPid = 0
      let success = false
      try {
        await runReallocUntil(ns, dnet, cmd.target, 1)
        await ensureTargetAuth(dnet, cmd.target, cmd.password)
        if (!(await copyWorkerFiles(ns, cmd.target, hostname))) {
          success = false
        } else {
          const childRam = ns.getScriptRam(WORKER_SCRIPT, cmd.target)
          const free = ns.getServerMaxRam(cmd.target) - ns.getServerUsedRam(cmd.target)
          if (childRam <= free) {
            childPid = ns.exec(
              WORKER_SCRIPT,
              cmd.target,
              1,
              activeSessionId,
              cmd.port,
              cmd.password ?? "",
            )
            success = childPid > 0
          }
        }
      } catch {
        success = false
      }
      ns.writePort(
        replyPort,
        JSON.stringify({
          type: "spawnResult",
          workerHost: hostname,
          target: cmd.target,
          success,
          childPid,
        }),
      )
    } else if (cmd.type === "guess" || cmd.type === "heartbleed") {
      await executeCommand(ns, dnet, cmd, replyPort)
    } else if (cmd.type === "realloc") {
      const result = await runReallocUntil(ns, dnet, hostname, cmd.priority)
      ns.writePort(
        replyPort,
        JSON.stringify({
          type: "reallocResult",
          workerHost: hostname,
          priority: cmd.priority,
          freeRam: result.freeRam,
          blockedRam: result.blockedRam,
        }),
      )
    }
  }
}

export function autocomplete(_data: unknown, _args: unknown): string[] {
  return []
}
