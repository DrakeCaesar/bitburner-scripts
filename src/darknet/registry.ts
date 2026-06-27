import { NS } from "@ns"
import {
  DARKNET_REGISTRY_FILE,
  safeGetServerDetails,
  type DarknetCrawlApi,
  type DarknetRegistry,
  type DarknetRegistryEntry,
  type DarknetRememberedPassword,
  type CrawlHostReport,
  type PasswordHintRecord,
} from "./config"

// ---- registry persistence ----

export function loadDarknetRegistry(ns: NS): DarknetRegistry {
  if (!ns.fileExists(DARKNET_REGISTRY_FILE, "home")) {
    return { servers: {}, rememberedPasswords: [] }
  }
  try {
    const parsed: unknown = JSON.parse(ns.read(DARKNET_REGISTRY_FILE))
    if (typeof parsed !== "object" || parsed === null) {
      return { servers: {}, rememberedPasswords: [] }
    }
    const row = parsed as Record<string, unknown>
    const serversRaw = (row.servers ?? row) as Record<string, unknown>
    if (typeof serversRaw !== "object" || serversRaw === null || Array.isArray(serversRaw)) {
      return { servers: {}, rememberedPasswords: [] }
    }
    const servers: Record<string, DarknetRegistryEntry> = {}
    for (const [hostname, raw] of Object.entries(serversRaw)) {
      if (typeof raw !== "object" || raw === null) continue
      const entry = raw as Record<string, unknown>
      if (typeof entry.hostname !== "string") continue
      const hints: PasswordHintRecord[] = []
      if (Array.isArray(entry.passwordHints)) {
        for (const h of entry.passwordHints) {
          const r = h as Record<string, unknown>
          if (typeof r.chars === "string" && typeof r.timestamp === "number") {
            hints.push({ chars: r.chars, timestamp: r.timestamp })
          }
        }
      }
      servers[hostname] = {
        hostname: entry.hostname,
        password: typeof entry.password === "string" ? entry.password : null,
        timestamp:
          typeof entry.timestamp === "number" ? entry.timestamp : null,
        passwordHints: hints,
      }
    }
    const rememberedPasswords: DarknetRememberedPassword[] = []
    if (Array.isArray(row.rememberedPasswords)) {
      for (const rp of row.rememberedPasswords) {
        const r = rp as Record<string, unknown>
        if (typeof r.password !== "string") continue
        if (typeof r.sourceHost !== "string") continue
        if (!Array.isArray(r.neighborHosts)) continue
        if (typeof r.timestamp !== "number") continue
        rememberedPasswords.push({
          password: r.password,
          sourceHost: r.sourceHost,
          neighborHosts: r.neighborHosts.filter((h): h is string => typeof h === "string"),
          timestamp: r.timestamp,
        })
      }
    }
    return { servers, rememberedPasswords }
  } catch {
    return { servers: {}, rememberedPasswords: [] }
  }
}

export function saveDarknetRegistry(ns: NS, registry: DarknetRegistry): void {
  ns.write(DARKNET_REGISTRY_FILE, JSON.stringify(registry, null, 2), "w")
}

export function mergeCrawlReportsIntoRegistry(
  registry: DarknetRegistry,
  reports: ReadonlyMap<string, CrawlHostReport>
): void {
  const now = Date.now()
  for (const report of reports.values()) {
    const existing = registry.servers[report.hostname]
    const password =
      report.authenticated === true
        ? (report.password ?? existing?.password ?? null)
        : report.authenticated === false
          ? null
          : (existing?.password ?? null)
    const timestamp =
      report.authenticated === true && report.password != null
        ? now
        : existing?.timestamp ?? null
    registry.servers[report.hostname] = {
      hostname: report.hostname,
      password,
      timestamp,
      passwordHints: existing?.passwordHints ?? [],
    }
  }
}

export function mergeRegistryWithCrawl(
  registry: DarknetRegistry,
  crawlReports: ReadonlyMap<string, CrawlHostReport>
): Map<string, CrawlHostReport> {
  const merged = new Map<string, CrawlHostReport>()
  for (const entry of Object.values(registry.servers)) {
    merged.set(entry.hostname, {
      hostname: entry.hostname,
      authenticated: entry.password != null ? true : null,
      password: entry.password,
      authGuesses: null,
    })
  }
  for (const report of crawlReports.values()) {
    const prev = merged.get(report.hostname)
    merged.set(report.hostname, {
      hostname: report.hostname,
      authenticated: report.authenticated ?? prev?.authenticated ?? null,
      password: report.password ?? prev?.password ?? null,
      authGuesses: report.authGuesses ?? prev?.authGuesses ?? null,
    })
  }
  return merged
}

/** Drop registry entries for hosts removed from the darknet graph. */
export function pruneInvalidRegistryHosts(dnet: DarknetCrawlApi, registry: DarknetRegistry): string[] {
  const removed: string[] = []
  for (const hostname of Object.keys(registry.servers)) {
    if (safeGetServerDetails(dnet, hostname) == null) {
      delete registry.servers[hostname]
      removed.push(hostname)
    }
  }
  return removed
}

// ---- password intel application (from parsed file content) ----

export function applyPasswordIntel(registry: DarknetRegistry, raw: unknown): void {
  const parsed = raw as Record<string, unknown>
  if (!Array.isArray(parsed.entries)) return
  const msgTimestamp = typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now()
  const sourceHost = typeof parsed.sourceHost === "string" ? parsed.sourceHost : "unknown"
  const neighbors: string[] = Array.isArray(parsed.neighbors)
    ? parsed.neighbors.filter((n): n is string => typeof n === "string")
    : []

  for (const entry of parsed.entries) {
    const e = entry as Record<string, unknown>
    const kind = e.kind as string | undefined

    if (kind === "explicit" || kind === "remember") {
      const password = typeof e.password === "string" ? e.password : null
      if (!password) continue

      if (kind === "explicit") {
        const host = typeof e.host === "string" ? e.host.trim() : null
        if (!host) continue
        const server = registry.servers[host]
        // Only overwrite if we have newer data
        if (server) {
          if (server.timestamp != null && server.timestamp >= msgTimestamp) continue
          server.password = password
          server.timestamp = msgTimestamp
        } else {
          registry.servers[host] = {
            hostname: host,
            password,
            timestamp: msgTimestamp,
            passwordHints: [],
          }
        }
      } else {
        // "remember" — password for one of the neighbors
        const dedupKey = `${password}|${sourceHost}`
        const exists = registry.rememberedPasswords.some(
          (rp) => `${rp.password}|${rp.sourceHost}` === dedupKey
        )
        if (!exists) {
          registry.rememberedPasswords.push({
            password,
            sourceHost,
            neighborHosts: neighbors,
            timestamp: msgTimestamp,
          })
        }
      }
    } else if (kind === "hint") {
      const host = typeof e.host === "string" ? e.host.trim() : null
      const chars = typeof e.chars === "string" ? e.chars : null
      if (!host || !chars) continue
      const server = registry.servers[host]
      // Check if this exact hint was already recorded at the same or newer time
      const duplicate = server?.passwordHints.some(
        (h) => h.chars === chars && h.timestamp >= msgTimestamp
      )
      if (!duplicate) {
        const record: PasswordHintRecord = { chars, timestamp: msgTimestamp }
        if (server) {
          server.passwordHints.push(record)
        } else {
          registry.servers[host] = {
            hostname: host,
            password: null,
            timestamp: null,
            passwordHints: [record],
          }
        }
      }
    }
  }
}
