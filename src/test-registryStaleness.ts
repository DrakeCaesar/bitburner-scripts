import { NS } from "@ns"
import type { DarknetRegistry } from "./darknetCrawl.js"

const REGISTRY_FILE = "darknet-registry.json"

function formatDelta(ms: number): string {
  const abs = Math.abs(ms)
  const mins = Math.floor(abs / 60000)
  const secs = Math.floor((abs % 60000) / 1000)
  const sign = ms >= 0 ? "+" : "-"
  return `${sign}${mins}m${secs}s`
}

export async function main(ns: NS): Promise<void> {
  const { lastAugReset } = ns.getResetInfo()
  const now = Date.now()

  ns.tprint(`\nAug install: ${new Date(lastAugReset).toISOString()} (${formatDelta(now - lastAugReset)} ago)`)
  ns.tprint(`Now:         ${new Date(now).toISOString()}\n`)

  if (!ns.fileExists(REGISTRY_FILE, "home")) {
    ns.tprint("ERROR: darknet-registry.json not found on home")
    return
  }

  const raw = JSON.parse(ns.read(REGISTRY_FILE))
  const registry = raw as DarknetRegistry

  const serverEntries = Object.values(registry.servers)
  let staleCount = 0
  let validCount = 0

  // ---- server passwords ----
  ns.tprint("=== SERVER PASSWORDS ===")
  for (const s of serverEntries) {
    if (s.timestamp == null) continue
    const delta = s.timestamp - lastAugReset
    if (delta < 0) {
      staleCount++
      ns.tprint(`  [STALE] ${s.hostname}  pw="${s.password}"  age=${formatDelta(delta)}`)
    } else {
      validCount++
    }
  }

  // ---- server hints (each record has its own timestamp) ----
  ns.tprint("")
  ns.tprint("=== SERVER HINTS ===")
  for (const s of serverEntries) {
    for (const h of s.passwordHints) {
      const delta = h.timestamp - lastAugReset
      if (delta < 0) {
        staleCount++
        ns.tprint(`  [STALE] ${s.hostname}  chars="${h.chars}"  age=${formatDelta(delta)}`)
      } else {
        validCount++
      }
    }
  }

  // ---- remembered passwords ----
  ns.tprint("")
  ns.tprint("=== REMEMBERED PASSWORDS ===")
  const rps = registry.rememberedPasswords ?? []
  for (const rp of rps) {
    const delta = rp.timestamp - lastAugReset
    if (delta < 0) {
      staleCount++
      ns.tprint(`  [STALE] source=${rp.sourceHost}  pw="${rp.password}"  neighbors=[${rp.neighborHosts.join(", ")}]  age=${formatDelta(delta)}`)
    } else {
      validCount++
    }
  }

  // ---- summary ----
  ns.tprint("")
  ns.tprint("=== SUMMARY ===")
  ns.tprint(`  Valid: ${validCount}`)
  ns.tprint(`  Stale: ${staleCount}`)
  if (staleCount > 0) {
    ns.tprint(`  All timestamps before ${new Date(lastAugReset).toISOString()} should be cleared`)
  }
}
