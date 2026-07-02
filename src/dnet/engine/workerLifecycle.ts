import { NS } from "@ns"
import { tryConnect } from "../api/server.js"
import { DARKWEB, WORKER_SCRIPT } from "../constants.js"
import type { DarknetRegistry } from "../registry.js"
import type { DnetApi } from "../types.js"

/** Hosts that may run a dnet worker. */
export function workerHosts(ns: NS, registry: DarknetRegistry): string[] {
  const hosts = new Set<string>([ns.getHostname(), DARKWEB])
  for (const hostname of Object.keys(registry.servers)) {
    hosts.add(hostname)
  }
  return [...hosts]
}

function killWorkersOnHost(
  ns: NS,
  dnet: DnetApi,
  registry: DarknetRegistry,
  host: string,
  masterHost: string,
): void {
  if (host !== masterHost) {
    const password = registry.servers[host]?.password
    if (password) tryConnect(dnet, host, password)
  }
  try {
    ns.scriptKill(WORKER_SCRIPT, host)
  } catch {
    /* host offline or no access */
  }
}

/** scriptKill dnet/worker/main.js on every candidate host (no delay). */
export function killAllWorkersSync(ns: NS, dnet: DnetApi, registry: DarknetRegistry): void {
  const masterHost = ns.getHostname()
  for (const host of workerHosts(ns, registry)) {
    killWorkersOnHost(ns, dnet, registry, host, masterHost)
  }
}

/** scriptKill dnet/worker/main.js on every candidate host, then wait for exit. */
export async function killAllWorkers(
  ns: NS,
  dnet: DnetApi,
  registry: DarknetRegistry,
): Promise<void> {
  killAllWorkersSync(ns, dnet, registry)
  await ns.sleep(500)
}
