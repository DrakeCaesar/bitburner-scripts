import { NS } from "@ns"
import {
  CONTROL_PORT,
  type ControlMessage,
} from "./constants.js"
import {
  createLocalFileScanState,
  scanLocalServerFiles,
} from "../files/serverFiles.js"
import type { WorkerDnetApi } from "./dnetApi.js"
import type { WorkerCommand } from "./protocol.js"
import {
  runAuthCommand,
  ensureSelfAuth,
  runProbe,
  runHeartbleedCommand,
  runMigrateCommand,
  runReallocCommand,
  runRestoreSessionCommand,
  runSpawnCommand,
  runLabreportCommand,
  runLabradarCommand,
} from "./execute.js"
import { runStasisCommand } from "./stasisExec.js"

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

async function waitForControlConfig(ns: NS, sessionId: number): Promise<{ lorePort: number }> {
  while (true) {
    const raw = ns.peek(CONTROL_PORT)
    if (raw === "NULL PORT DATA") {
      await ns.sleep(200)
      continue
    }
    try {
      const msg = JSON.parse(String(raw)) as ControlMessage
      if (typeof msg.sessionId !== "number" || msg.sessionId !== sessionId) {
        ns.exit()
      }
      if (typeof msg.lorePort === "number" && msg.lorePort > 0) {
        return { lorePort: msg.lorePort }
      }
    } catch {
      /* ignore */
    }
    await ns.sleep(200)
  }
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
  const selfPassword = typeof ns.args[2] === "string" ? ns.args[2] : undefined

  const { lorePort } = await waitForControlConfig(ns, sessionId)
  await ensureSelfAuth(dnet, hostname, selfPassword)

  ns.writePort(replyPort, JSON.stringify({ type: "ready", workerHost: hostname, pid: ns.pid }))

  const fileScanState = createLocalFileScanState()
  let activeSessionId = sessionId

  while (true) {
    activeSessionId = refreshSessionId(ns, activeSessionId)
    await ensureSelfAuth(dnet, hostname, selfPassword)
    await scanLocalServerFiles(ns, dnet, replyPort, lorePort, fileScanState)

    const raw = await readCommandPayload(ns, commandPort)
    if (!raw) continue

    let cmd: WorkerCommand
    try {
      cmd = JSON.parse(raw) as WorkerCommand
    } catch {
      continue
    }

    if (cmd.type === "exit") break

    if (cmd.type === "probe") {
      await ensureSelfAuth(dnet, hostname, selfPassword)
      await runProbe(ns, dnet, replyPort)
    } else if (cmd.type === "auth") {
      await runAuthCommand(ns, dnet, cmd, replyPort)
    } else if (cmd.type === "spawn") {
      await ensureSelfAuth(dnet, hostname, selfPassword)
      await runSpawnCommand(ns, dnet, cmd, replyPort, activeSessionId)
    } else if (cmd.type === "heartbleed") {
      await runHeartbleedCommand(ns, dnet, cmd, replyPort)
    } else if (cmd.type === "realloc") {
      await runReallocCommand(ns, dnet, cmd, replyPort)
    } else if (cmd.type === "migrate") {
      await ensureSelfAuth(dnet, hostname, selfPassword)
      await runMigrateCommand(ns, dnet, cmd, replyPort)
    } else if (cmd.type === "stasis") {
      await ensureSelfAuth(dnet, hostname, selfPassword)
      await runStasisCommand(ns, dnet, replyPort)
    } else if (cmd.type === "labreport") {
      await runLabreportCommand(ns, dnet, cmd, replyPort)
    } else if (cmd.type === "labradar") {
      await runLabradarCommand(ns, dnet, cmd, replyPort)
    } else if (cmd.type === "restoreSession") {
      await ensureSelfAuth(dnet, hostname, selfPassword)
      await runRestoreSessionCommand(ns, dnet, cmd, replyPort)
    }
  }
}

export function autocomplete(_data: unknown, _args: unknown): string[] {
  return []
}
