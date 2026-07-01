import { NS } from "@ns"
import {
  copyLiteratureFromHost,
  finalizeArchiveContent,
  loadDarknetLoreStore,
  syncDarknetLoreFile,
  type DarknetLoreStore,
} from "../files/archive.js"
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
  loreStore: DarknetLoreStore
  loreFile: string
}

function parseLorePortEntry(raw: string): { kind: "journal" | "literature"; text: string } | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === "object" && parsed !== null) {
      const row = parsed as Record<string, unknown>
      if (row.kind === "literature" && typeof row.text === "string") {
        return { kind: "literature", text: row.text }
      }
    }
  } catch {
    /* plain journal text from .txt lore files */
  }
  return { kind: "journal", text: raw }
}

function absorbLorePortEntry(
  store: DarknetLoreStore,
  entry: { kind: "journal" | "literature"; text: string },
): boolean {
  const bucket = entry.kind === "literature" ? store.literature : store.journal
  if (bucket.has(entry.text)) return false
  bucket.add(entry.text)
  return true
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

    if (row.type === "litCopy" && typeof row.file === "string" && typeof row.sourceHost === "string") {
      copyLiteratureFromHost(ns, row.file, row.sourceHost)
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

export function pollLorePort(ns: NS, lorePort: number, store: DarknetLoreStore, loreFile: string): void {
  while (true) {
    const raw = ns.peek(lorePort)
    if (raw === "NULL PORT DATA") break
    ns.readPort(lorePort)
    if (typeof raw !== "string") continue
    const entry = parseLorePortEntry(raw)
    if (!entry || !absorbLorePortEntry(store, entry)) continue
    syncDarknetLoreFile(ns, store, loreFile)
  }
}

export function drainLorePort(ns: NS, lorePort: number, store: DarknetLoreStore, loreFile: string): void {
  while (true) {
    const raw = ns.readPort(lorePort)
    if (raw === "NULL PORT DATA") break
    if (typeof raw !== "string") continue
    const entry = parseLorePortEntry(raw)
    if (!entry || !absorbLorePortEntry(store, entry)) continue
    syncDarknetLoreFile(ns, store, loreFile)
  }
}

export function createLoreStore(ns: NS, loreFile: string): DarknetLoreStore {
  return loadDarknetLoreStore(ns, loreFile)
}
