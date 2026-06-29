import { NS } from "@ns"
import {
  DARKNET_CRAWL_SCRIPT,
  safeGetServerDetails,
  HEARTBLEED_AUTH_LOG_MAX_RETRIES,
  type DarknetCrawlApi,
  type DarknetServerDetailsForFormulas,
  type WorkerCommandMeta,
  type WorkerCommandPayload,
} from "./config.js"

/** Master deadline = expectedMs * this multiplier. */
export const WORKER_DEADLINE_MULTIPLIER = 1.2

const MIN_COMMAND_MS = 100
/** Probe is instant in dnet; allow time for neighbor reports and local archive. */
const PROBE_OVERHEAD_MS = 5_000
/** SCP retries (3 files x 3 attempts x 1s sleep worst case). */
const SPAWN_SCP_OVERHEAD_MS = 5_000
const SPAWN_MAX_REALLOC_ATTEMPTS = 10
/** Fallback when Formulas.exe is unavailable. */
const FALLBACK_AUTH_MS = 5_000

interface FormulasDnet {
  getAuthenticateTime(
    serverDetails: DarknetServerDetailsForFormulas,
    threads?: number,
    player?: unknown,
    correctCharactersInPassword?: number,
  ): number
  getHeartbleedTime(
    serverDetails: DarknetServerDetailsForFormulas,
    threads?: number,
    player?: unknown,
  ): number
}

function formulasDnet(ns: NS): FormulasDnet | null {
  const api = (ns as NS & { formulas?: { dnet?: FormulasDnet } }).formulas?.dnet
  return api ?? null
}

/** Game hardcodes this for dnet.memoryReallocation (charisma-scaled, not server-specific). */
export function getReallocTimeMs(charisma: number): number {
  return Math.max(8000 * (500 / (500 + charisma)), 200)
}

function authTimeMs(
  ns: NS,
  dnet: DarknetCrawlApi,
  host: string,
  correctChars = 0,
): number {
  const details = safeGetServerDetails(dnet, host)
  if (!details) return FALLBACK_AUTH_MS
  const formulas = formulasDnet(ns)
  if (!formulas) return FALLBACK_AUTH_MS
  try {
    return formulas.getAuthenticateTime(details, 1, undefined, correctChars)
  } catch {
    return FALLBACK_AUTH_MS
  }
}

function heartbleedTimeMs(ns: NS, dnet: DarknetCrawlApi, host: string): number {
  const details = safeGetServerDetails(dnet, host)
  if (!details) return FALLBACK_AUTH_MS
  const formulas = formulasDnet(ns)
  if (!formulas) return FALLBACK_AUTH_MS
  try {
    return formulas.getHeartbleedTime(details, 1)
  } catch {
    return FALLBACK_AUTH_MS * 1.5
  }
}

/** Predicted wall-clock duration for a worker command (before deadline multiplier). */
export function estimateCommandMs(
  ns: NS,
  dnet: DarknetCrawlApi,
  command: WorkerCommandPayload,
): number {
  switch (command.type) {
    case "probe":
      return PROBE_OVERHEAD_MS
    case "guess": {
      const hbMs = heartbleedTimeMs(ns, dnet, command.target)
      // 401 path: up to N peek + consume pairs hunting for the auth attempt log.
      const hbWorst = hbMs * HEARTBLEED_AUTH_LOG_MAX_RETRIES * 2
      return authTimeMs(ns, dnet, command.target) + hbWorst
    }
    case "heartbleed":
      return heartbleedTimeMs(ns, dnet, command.target)
    case "labreport":
      // labreport() delays using labyrinth server auth time; worker runs on the maze host.
      return authTimeMs(ns, dnet, command.target)
    case "realloc":
      return getReallocTimeMs(ns.getPlayer().skills.charisma)
    case "spawn": {
      const charisma = ns.getPlayer().skills.charisma
      const reallocMs = getReallocTimeMs(charisma)
      let reallocCalls = 0
      try {
        const childRam = ns.getScriptRam(DARKNET_CRAWL_SCRIPT, command.target)
        const free = ns.getServerMaxRam(command.target) - ns.getServerUsedRam(command.target)
        const blocked = dnet.getBlockedRam?.(command.target) ?? 0
        if (blocked > 0 && free < childRam) {
          reallocCalls = SPAWN_MAX_REALLOC_ATTEMPTS
        }
      } catch { /* host may be unreachable from master */ }
      return reallocCalls * reallocMs + SPAWN_SCP_OVERHEAD_MS
    }
    case "exit":
      return MIN_COMMAND_MS
  }
}

export function withCommandDeadline<T extends WorkerCommandPayload>(
  command: T,
  expectedMs: number,
  now = Date.now(),
): T & WorkerCommandMeta {
  const ms = Math.max(expectedMs, MIN_COMMAND_MS)
  return {
    ...command,
    expectedMs: ms,
    deadlineAt: now + Math.ceil(ms * WORKER_DEADLINE_MULTIPLIER),
  }
}
