import { NS } from "@ns"
import { getServerDetails } from "./api/server.js"
import { markTargetAuthed } from "./engine/targetState.js"
import type { AuthTarget, DnetApi } from "./types.js"

export interface PasswordHintRecord {
  chars: string
  timestamp: number
}

export interface DarknetRegistryEntry {
  hostname: string
  password: string | null
  timestamp: number | null
  passwordHints: PasswordHintRecord[]
}

export interface DarknetRememberedPassword {
  password: string
  sourceHost: string
  neighborHosts: string[]
  timestamp: number
}

export interface DarknetRegistry {
  servers: Record<string, DarknetRegistryEntry>
  rememberedPasswords: DarknetRememberedPassword[]
}

export const DARKNET_REGISTRY_FILE = "darknet-registry.json"

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
        timestamp: typeof entry.timestamp === "number" ? entry.timestamp : null,
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

export function clearRegistryPassword(registry: DarknetRegistry, host: string): void {
  const entry = registry.servers[host]
  if (!entry) return
  entry.password = null
  entry.timestamp = null
  entry.passwordHints = []
}

export function pruneInvalidRegistryHosts(dnet: DnetApi, registry: DarknetRegistry): string[] {
  const removed: string[] = []
  for (const hostname of Object.keys(registry.servers)) {
    if (getServerDetails(dnet, hostname) == null) {
      delete registry.servers[hostname]
      removed.push(hostname)
    }
  }
  return removed
}

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
      if (password == null) continue

      if (kind === "explicit") {
        const host = typeof e.host === "string" ? e.host.trim() : null
        if (!host) continue
        const server = registry.servers[host]
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
        const dedupKey = `${password}|${sourceHost}`
        const exists = registry.rememberedPasswords.some(
          (rp) => `${rp.password}|${rp.sourceHost}` === dedupKey,
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
      const duplicate = server?.passwordHints.some(
        (h) => h.chars === chars && h.timestamp >= msgTimestamp,
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

export function syncRegistryPasswords(
  dnet: DnetApi,
  registry: DarknetRegistry,
  passwords: Map<string, string>,
  targets: Map<string, AuthTarget>,
  tryConnect: (dnet: DnetApi, host: string, password: string) => boolean,
): void {
  for (const entry of Object.values(registry.servers)) {
    if (entry.password == null) continue
    passwords.set(entry.hostname, entry.password)
    tryConnect(dnet, entry.hostname, entry.password)
    const target = targets.get(entry.hostname)
    if (!target || target.status === "unsupported" || target.status === "offline") continue
    markTargetAuthed(target, dnet, { password: entry.password, passwords })
  }
}
