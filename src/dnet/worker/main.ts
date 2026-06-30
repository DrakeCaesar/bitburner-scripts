import { NS } from "@ns"
import {
  CONTROL_PORT,
  WORKER_SCRIPT,
  WORKER_SCP_FILES,
  type ControlMessage,
} from "./constants.js"
import type { WorkerDnetApi } from "./dnetApi.js"
import type { WorkerCommand } from "./protocol.js"
import { executeCommand, ensureSelfAuth, runProbe } from "./execute.js"

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
    const controlRaw = ns.peek(CONTROL_PORT)
    if (controlRaw !== "NULL PORT DATA") {
      try {
        const msg = JSON.parse(String(controlRaw)) as ControlMessage
        if (msg.sessionId > 0) activeSessionId = msg.sessionId
      } catch {
        /* ignore */
      }
    }

    const raw = ns.peek(commandPort)
    if (raw === "NULL PORT DATA") {
      await ns.sleep(50)
      continue
    }

    ns.readPort(commandPort)
    let cmd: WorkerCommand
    try {
      cmd = JSON.parse(String(raw)) as WorkerCommand
    } catch {
      await ns.sleep(50)
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
        for (const file of WORKER_SCP_FILES) {
          if (!ns.fileExists(file, "home")) continue
          await ns.scp(file, cmd.target, "home")
        }
        childPid = ns.exec(
          WORKER_SCRIPT,
          cmd.target,
          1,
          activeSessionId,
          cmd.port,
          cmd.password ?? "",
        )
        success = childPid > 0
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
    }

    await ns.sleep(10)
  }
}

export function autocomplete(_data: unknown, _args: unknown): string[] {
  return []
}
