import { NS } from "@ns"
import { STASIS_SCRIPT, WORKER_SCRIPT } from "../constants.js"
import type { DnetApi } from "../types.js"

/** 1 = worker RAM, 2 = worker + stasis RAM, 3 = one opportunistic blocked-RAM clear step when idle. */
export type ReallocPriority = 1 | 2 | 3

export interface HostRamSnapshot {
  freeRam: number
  blockedRam: number
}

function scriptRam(ns: NS, script: string, host: string): number {
  try {
    if (ns.fileExists(script, host)) return ns.getScriptRam(script, host)
    if (ns.fileExists(script, "home")) return ns.getScriptRam(script, "home")
  } catch {
    /* host unreachable from master */
  }
  return 0
}

export function workerScriptRamGb(ns: NS, host: string): number {
  return scriptRam(ns, WORKER_SCRIPT, host)
}

export function stasisScriptRamGb(ns: NS, host: string): number {
  return scriptRam(ns, STASIS_SCRIPT, host)
}

/** Host max RAM can ever fit a running worker plus a one-shot stasis exec. */
export function hostFitsWorkerAndStasis(ns: NS, host: string): boolean {
  const workerRam = workerScriptRamGb(ns, host)
  const stasisRam = stasisScriptRamGb(ns, host)
  if (workerRam <= 0 || stasisRam <= 0) return false
  try {
    return ns.getServerMaxRam(host) >= workerRam + stasisRam
  } catch {
    return false
  }
}

/**
 * Worker is already running; enough free RAM remains to exec the stasis stub and
 * P2 realloc (worker + stasis budget) is satisfied when reallocation is available.
 */
export function canExecStasis(ns: NS, dnet: DnetApi, host: string, cached?: HostRamSnapshot): boolean {
  if (!hostFitsWorkerAndStasis(ns, host)) return false
  const stasisRam = stasisScriptRamGb(ns, host)
  const ram = cached ?? readHostRam(ns, dnet, host)
  if (ram.freeRam < stasisRam) return false
  if (dnet.memoryReallocation && dnet.getBlockedRam && needsRealloc(ns, dnet, host, 2, ram)) {
    return false
  }
  return true
}

export function ramTargetGb(ns: NS, host: string, priority: ReallocPriority): number {
  const workerRam = scriptRam(ns, WORKER_SCRIPT, host)
  if (priority === 1) return workerRam
  if (priority === 2) return workerRam + scriptRam(ns, STASIS_SCRIPT, host)
  return 0
}

export function readHostRam(ns: NS, dnet: DnetApi, host: string): HostRamSnapshot {
  try {
    const freeRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host)
    const blockedRam = dnet.getBlockedRam?.(host) ?? 0
    return { freeRam, blockedRam }
  } catch {
    return { freeRam: 0, blockedRam: 0 }
  }
}

export function needsRealloc(
  ns: NS,
  dnet: DnetApi,
  host: string,
  priority: ReallocPriority,
  cached?: HostRamSnapshot,
): boolean {
  if (!dnet.memoryReallocation || !dnet.getBlockedRam) return false
  const { freeRam, blockedRam } = cached ?? readHostRam(ns, dnet, host)
  if (blockedRam <= 0) return false
  if (priority === 3) return true
  return freeRam < ramTargetGb(ns, host, priority)
}

/** True when a worker script fits on host without further P1 realloc. */
export function canSpawnWorker(ns: NS, dnet: DnetApi, host: string, cached?: HostRamSnapshot): boolean {
  const ram = cached ?? readHostRam(ns, dnet, host)
  if (ram.freeRam < workerScriptRamGb(ns, host)) return false
  return !needsRealloc(ns, dnet, host, 1, ram)
}

/** Highest unmet realloc priority for a worker host (P1 not used on self). */
export function nextSelfReallocPriority(
  ns: NS,
  dnet: DnetApi,
  host: string,
  cached: HostRamSnapshot,
): ReallocPriority | null {
  if (needsRealloc(ns, dnet, host, 2, cached)) return 2
  if (needsRealloc(ns, dnet, host, 3, cached)) return 3
  return null
}
