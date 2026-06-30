import { NS } from "@ns"
import { STASIS_SCRIPT, WORKER_SCRIPT } from "../constants.js"
import type { DnetApi } from "../types.js"

/** 1 = worker RAM, 2 = worker + stasis RAM, 3 = clear all blocked RAM. */
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
