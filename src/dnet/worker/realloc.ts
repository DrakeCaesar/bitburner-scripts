import { NS } from "@ns"
import { STASIS_SCRIPT, WORKER_SCRIPT } from "./constants.js"
import type { WorkerDnetApi } from "./dnetApi.js"

/** 1 = worker RAM, 2 = worker + stasis RAM, 3 = clear all blocked RAM. */
export type ReallocPriority = 1 | 2 | 3

export interface HostRamSnapshot {
  freeRam: number
  blockedRam: number
}

function scriptRam(ns: NS, script: string, host: string): number {
  if (ns.fileExists(script, host)) return ns.getScriptRam(script, host)
  if (ns.fileExists(script, "home")) return ns.getScriptRam(script, "home")
  return 0
}

function ramTargetGb(ns: NS, host: string, priority: ReallocPriority): number {
  const workerRam = scriptRam(ns, WORKER_SCRIPT, host)
  if (priority === 1) return workerRam
  if (priority === 2) return workerRam + scriptRam(ns, STASIS_SCRIPT, host)
  return 0
}

export function measureHostRam(ns: NS, dnet: WorkerDnetApi, host: string): HostRamSnapshot {
  return {
    freeRam: ns.getServerMaxRam(host) - ns.getServerUsedRam(host),
    blockedRam: dnet.getBlockedRam?.(host) ?? 0,
  }
}

export function priorityMet(ns: NS, dnet: WorkerDnetApi, host: string, priority: ReallocPriority): boolean {
  const { freeRam, blockedRam } = measureHostRam(ns, dnet, host)
  if (priority === 3) return blockedRam <= 0
  if (blockedRam <= 0) return true
  return freeRam >= ramTargetGb(ns, host, priority)
}

/** Run memoryReallocation until the priority target is met or blocked RAM is cleared. */
export async function runReallocUntil(
  ns: NS,
  dnet: WorkerDnetApi,
  host: string,
  priority: ReallocPriority,
): Promise<HostRamSnapshot> {
  if (!dnet.memoryReallocation) return measureHostRam(ns, dnet, host)

  while (true) {
    if (priorityMet(ns, dnet, host, priority)) break
    const { blockedRam } = measureHostRam(ns, dnet, host)
    if (blockedRam <= 0) break
    try {
      await dnet.memoryReallocation(host)
    } catch {
      break
    }
  }

  return measureHostRam(ns, dnet, host)
}
