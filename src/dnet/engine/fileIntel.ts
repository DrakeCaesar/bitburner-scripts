import { NS } from "@ns"
import { finalizeArchiveContent, loadDarknetTextSet, syncDarknetTextFile } from "../files/archive.js"
import type { CacheOpenRecord } from "../files/types.js"
import {
  applyPasswordIntel,
  type DarknetRegistry,
  saveDarknetRegistry,
} from "../registry.js"

function parseCacheOpen(row: Record<string, unknown>): CacheOpenRecord | null {
  if (row.type !== "cacheOpen") return null
  if (typeof row.host !== "string" || typeof row.file !== "string" || typeof row.message !== "string") {
    return null
  }
  if (typeof row.karmaLoss !== "number" || !Number.isFinite(row.karmaLoss)) return null
  return {
    host: row.host,
    file: row.file,
    message: row.message,
    karmaLoss: row.karmaLoss,
    openedAt: typeof row.openedAt === "number" && Number.isFinite(row.openedAt) ? row.openedAt : Date.now(),
  }
}

export interface WorkerFileIntelCtx {
  registry: DarknetRegistry
  cacheOpens: CacheOpenRecord[]
  loreSet: Set<string>
  loreFile: string
}

/** Handle archive / cacheOpen / passwordIntel messages on worker reply ports. */
export function applyWorkerFileMessage(ns: NS, raw: unknown, ctx: WorkerFileIntelCtx): boolean {
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
    if (typeof parsed !== "object" || parsed === null) return false
    const row = parsed as Record<string, unknown>

    const cacheOpen = parseCacheOpen(row)
    if (cacheOpen) {
      ctx.cacheOpens.push(cacheOpen)
      return true
    }

    if (row.type === "archive" && typeof row.file === "string" && typeof row.content === "string") {
      finalizeArchiveContent(ns, row.file, row.content)
      return true
    }

    if (row.type === "passwordIntel") {
      applyPasswordIntel(ctx.registry, parsed)
      saveDarknetRegistry(ns, ctx.registry)
      return true
    }
  } catch {
    return false
  }
  return false
}

export function pollLorePort(ns: NS, lorePort: number, loreSet: Set<string>, loreFile: string): void {
  while (true) {
    const raw = ns.peek(lorePort)
    if (raw === "NULL PORT DATA") break
    ns.readPort(lorePort)
    if (typeof raw !== "string") continue
    if (loreSet.has(raw)) continue
    loreSet.add(raw)
    syncDarknetTextFile(ns, loreSet, loreFile)
  }
}

export function drainLorePort(ns: NS, lorePort: number, loreSet: Set<string>, loreFile: string): void {
  while (true) {
    const raw = ns.readPort(lorePort)
    if (raw === "NULL PORT DATA") break
    if (typeof raw !== "string") continue
    if (loreSet.has(raw)) continue
    loreSet.add(raw)
    syncDarknetTextFile(ns, loreSet, loreFile)
  }
}

export function createLoreSet(ns: NS, loreFile: string): Set<string> {
  return loadDarknetTextSet(ns, loreFile)
}
