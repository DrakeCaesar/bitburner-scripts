import type { NS } from "@ns"
import { getServerDetails, stasisLinkedHosts, tryConnect } from "../api/server.js"
import { DARKWEB, WORKER_SCRIPT } from "../constants.js"
import { clearWorkerPortPair } from "./ports.js"
import { canSpawnWorker, readHostRam } from "./memoryPlan.js"
import { markTargetAuthed } from "./targetState.js"
import type { DarknetRegistry } from "../registry.js"
import type { AuthTarget, DnetApi } from "../types.js"
import type { PortPool, WorkerPool } from "../pool/workers.js"
import type { MasterActionLog } from "../history/masterActionLog.js"
import { copyWorkerFiles } from "../worker/deploy.js"

function lookupPassword(
  host: string,
  passwords: Map<string, string>,
  registry: DarknetRegistry,
): string | null {
  const fromMap = passwords.get(host)
  if (fromMap != null) return fromMap
  const fromRegistry = registry.servers[host]?.password
  return fromRegistry ?? null
}

async function ensureCoordinatorSession(
  dnet: DnetApi,
  host: string,
  password: string,
): Promise<boolean> {
  if (getServerDetails(dnet, host)?.hasSession) return true
  if (tryConnect(dnet, host, password) && getServerDetails(dnet, host)?.hasSession) {
    return true
  }
  const details = getServerDetails(dnet, host)
  if (details?.isConnectedToCurrentServer) {
    try {
      const result = await dnet.authenticate(host, password)
      if (result.success) return true
    } catch {
      /* ignore */
    }
  }
  return getServerDetails(dnet, host)?.hasSession === true
}

/**
 * On coordinator start: connectToSession (or authenticate when adjacent), scp worker
 * bundle, and exec dnet/worker on every stasis-linked host before other dispatch.
 */
export async function bootstrapStasisLinkedWorkers(
  ns: NS,
  dnet: DnetApi,
  sessionId: number,
  registry: DarknetRegistry,
  passwords: Map<string, string>,
  targets: Map<string, AuthTarget>,
  workerPool: WorkerPool,
  portPool: PortPool,
  masterLog: MasterActionLog,
): Promise<void> {
  if (!dnet.getStasisLinkedServers) return

  const linked = [...stasisLinkedHosts(dnet)].sort((a, b) => a.localeCompare(b))
  if (linked.length === 0) return

  masterLog.append("startup", `stasis bootstrap ${linked.length} linked host(s)`)
  const source = ns.getHostname()

  for (const host of linked) {
    if (workerPool.workers.has(host)) continue

    const details = getServerDetails(dnet, host)
    if (details?.isOnline === false) {
      masterLog.append("startup", `stasis skip ${host} (offline)`)
      continue
    }

    const password = lookupPassword(host, passwords, registry)
    if (password != null) {
      passwords.set(host, password)
      if (!(await ensureCoordinatorSession(dnet, host, password))) {
        masterLog.append("startup", `stasis connect failed ${host}`)
        continue
      }
      const target = targets.get(host)
      if (target) {
        markTargetAuthed(target, dnet, { password, passwords })
      }
    } else if (!details?.hasSession) {
      masterLog.append("startup", `stasis skip ${host} (no password)`)
      continue
    }

    const scpError = await copyWorkerFiles(ns, host, source)
    if (scpError != null) {
      masterLog.append("startup", `stasis scp failed ${host}: ${scpError}`)
      continue
    }

    const ram = readHostRam(ns, dnet, host)
    if (!canSpawnWorker(ns, dnet, host, ram)) {
      masterLog.append("startup", `stasis skip ${host} (insufficient RAM)`)
      continue
    }

    const port = portPool.allocate()
    if (port <= 0) {
      masterLog.append("startup", "stasis bootstrap stopped (no ports)")
      break
    }
    clearWorkerPortPair(ns, port)

    const pid = ns.exec(
      WORKER_SCRIPT,
      host,
      1,
      sessionId,
      port,
      password ?? "",
    )
    if (pid <= 0) {
      portPool.release(port)
      clearWorkerPortPair(ns, port)
      masterLog.append("startup", `stasis exec failed ${host}`)
      continue
    }

    workerPool.register(host, pid, port)
    masterLog.append("startup", `stasis worker ${host} pid ${pid} port ${port}`)
  }
}
