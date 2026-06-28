import { NS } from "@ns"
import {
  DARKNET_CRAWL_SCRIPT,
  DARKNET_LORE_FILE,
  DARKWEB,
  CONTROL_PORT,
  tryConnectToSession,
  type CrawlHostReport,
  type CrawlStatusReport,
  type CrawlCacheOpen,
  type ControlMessage,
  type DarknetCrawlApi,
  type DarknetRegistry,
  type CrawlProgressHandler,
  type CrawlErrorHandler,
  type DarknetCrawlResult,
} from "./config"
import { solveDarknetPassword, solverInputFromDetails } from "./auth"
import {
  saveDarknetRegistry,
  pruneInvalidRegistryHosts,
  applyPasswordIntel,
} from "./registry"
import {
  copyCrawlScript,
  crawlWorkerArgs,
  finalizeArchiveContent,
  loadDarknetTextSet,
  syncDarknetTextFile,
} from "./worker"

// ---- lock management (in-memory, synced via CONTROL_PORT) ----

/** Active auth locks: target hostname → { workerHost, pid } */
type ActiveLocks = Map<string, { workerHost: string; pid: number }>

/**
 * Write current session config + lock snapshot to CONTROL_PORT.
 * Workers peek this port to see which targets are claimed.
 */
function syncControlPort(
  ns: NS,
  sessionId: number,
  reportPort: number,
  lorePort: number,
  activeLocks: ActiveLocks,
): void {
  ns.clearPort(CONTROL_PORT)
  ns.writePort(CONTROL_PORT, JSON.stringify({
    sessionId,
    reportPort,
    lorePort,
    locks: activeLocks.size > 0
      ? Object.fromEntries([...activeLocks].map(([k, v]) => [k, v.pid]))
      : undefined,
  } satisfies ControlMessage))
}

/** Remove dead-pid locks from the map. Called before processing claims. */
function purgeDeadLocks(ns: NS, activeLocks: ActiveLocks): void {
  for (const [target, entry] of activeLocks) {
    if (!ns.isRunning(entry.pid)) {
      activeLocks.delete(target)
    }
  }
}

// ---- port message parsers ----

function parseCrawlStatus(raw: Record<string, unknown>): CrawlStatusReport | null {
  if (raw.type !== "status") {
    return null
  }
  if (typeof raw.workerHost !== "string" || typeof raw.targetHost !== "string") {
    return null
  }
  if (
    raw.phase !== "auth" &&
    raw.phase !== "heartbleed" &&
    raw.phase !== "probe" &&
    raw.phase !== "spawn" &&
    raw.phase !== "wait"
  ) {
    return null
  }
  if (typeof raw.etaMs !== "number" || !Number.isFinite(raw.etaMs)) {
    return null
  }
  return {
    type: "status",
    workerHost: raw.workerHost,
    targetHost: raw.targetHost,
    phase: raw.phase,
    etaMs: raw.etaMs,
    detail: typeof raw.detail === "string" ? raw.detail : null,
    authGuesses: typeof raw.authGuesses === "number" ? raw.authGuesses : undefined,
  }
}

function parseCrawlReport(raw: unknown): CrawlHostReport | null {
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
    if (typeof parsed !== "object" || parsed === null) return null
    const row = parsed as Record<string, unknown>
    if (row.type === "status") {
      return null
    }
    if (row.type === "archive") {
      return null
    }
    if (row.type === "cacheOpen") {
      return null
    }
    if (typeof row.hostname !== "string") return null
    if (row.authenticated !== true && row.authenticated !== false && row.authenticated !== null) {
      return null
    }
    const authGuesses =
      typeof row.authGuesses === "number"
        ? row.authGuesses
        : row.authGuesses === null
          ? null
          : undefined
    return {
      type: "host",
      hostname: row.hostname,
      authenticated: row.authenticated,
      password: typeof row.password === "string" || row.password === null ? row.password : null,
      authGuesses,
    }
  } catch {
    return null
  }
}

function parseCacheOpen(row: Record<string, unknown>): CrawlCacheOpen | null {
  if (row.type !== "cacheOpen") {
    return null
  }
  if (typeof row.host !== "string" || typeof row.file !== "string" || typeof row.message !== "string") {
    return null
  }
  if (typeof row.karmaLoss !== "number" || !Number.isFinite(row.karmaLoss)) {
    return null
  }
  return {
    host: row.host,
    file: row.file,
    message: row.message,
    karmaLoss: row.karmaLoss,
    openedAt: typeof row.openedAt === "number" && Number.isFinite(row.openedAt) ? row.openedAt : Date.now(),
  }
}

// ---- port processing ----

function applyCrawlPortMessage(
  ns: NS,
  raw: unknown,
  reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>,
  cacheOpens: CrawlCacheOpen[],
  sessionId: number,
  activeLocks: ActiveLocks,
  registry?: DarknetRegistry
): void {
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
    if (typeof parsed !== "object" || parsed === null) {
      return
    }
    const row = parsed as Record<string, unknown>

    // Lock messages: workers request/renew/release auth locks
    if (row.type === "lock" && typeof row.action === "string" && typeof row.target === "string") {
      const target = row.target
      const claimPid = typeof row.pid === "number" ? row.pid : 0
      if (row.action === "claim") {
        // Grant if target is not locked (or locked by a dead worker)
        const existing = activeLocks.get(target)
        if (!existing || !ns.isRunning(existing.pid)) {
          activeLocks.set(target, {
            workerHost: typeof row.workerHost === "string" ? row.workerHost : "unknown",
            pid: claimPid,
          })
        }
      } else if (row.action === "renew") {
        // Nothing needed — lock stays until explicitly released or worker dies
      } else if (row.action === "release") {
        activeLocks.delete(target)
      }
      return
    }

    const cacheOpen = parseCacheOpen(row)
    if (cacheOpen) {
      cacheOpens.push(cacheOpen)
      return
    }
    if (row.type === "archive" && typeof row.file === "string" && typeof row.content === "string") {
      finalizeArchiveContent(ns, row.file, row.content)
      return
    }
    if (row.type === "passwordIntel" && registry) {
      applyPasswordIntel(registry, parsed)
      return
    }
    const status = parseCrawlStatus(row)
    if (status) {
      activeOps.set(status.workerHost, status)
      return
    }
    const report = parseCrawlReport(parsed)
    if (!report) {
      return
    }
    const existing = reports.get(report.hostname)
    reports.set(report.hostname, {
      hostname: report.hostname,
      authenticated: report.authenticated,
      password: report.password,
      authGuesses: report.authGuesses ?? existing?.authGuesses ?? null,
    })
    for (const [workerHost, op] of activeOps) {
      if (op.targetHost === report.hostname && (op.phase === "auth" || op.phase === "heartbleed")) {
        activeOps.delete(workerHost)
      }
    }
  } catch {
    // ignore malformed port data
  }
}

function drainCrawlPort(
  ns: NS,
  port: number,
  reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>,
  cacheOpens: CrawlCacheOpen[],
  sessionId: number,
  activeLocks: ActiveLocks,
  registry?: DarknetRegistry
): void {
  while (true) {
    const raw = ns.readPort(port)
    if (raw === "NULL PORT DATA") break
    applyCrawlPortMessage(ns, raw, reports, activeOps, cacheOpens, sessionId, activeLocks, registry)
  }
}

function pollCrawlPort(
  ns: NS,
  port: number,
  reports: Map<string, CrawlHostReport>,
  activeOps: Map<string, CrawlStatusReport>,
  cacheOpens: CrawlCacheOpen[],
  sessionId: number,
  activeLocks: ActiveLocks,
  registry?: DarknetRegistry
): void {
  while (true) {
    const raw = ns.peek(port)
    if (raw === "NULL PORT DATA") break
    ns.readPort(port)
    applyCrawlPortMessage(ns, raw, reports, activeOps, cacheOpens, sessionId, activeLocks, registry)
  }
}

function pollTextPort(ns: NS, port: number, textSet: Set<string>, file: string): void {
  while (true) {
    const raw = ns.peek(port)
    if (raw === "NULL PORT DATA") break
    ns.readPort(port)
    if (typeof raw !== "string") continue
    if (textSet.has(raw)) continue
    textSet.add(raw)
    syncDarknetTextFile(ns, file, textSet)
  }
}

function drainTextPort(ns: NS, port: number, textSet: Set<string>, file: string): void {
  while (true) {
    const raw = ns.readPort(port)
    if (raw === "NULL PORT DATA") break
    if (typeof raw !== "string") continue
    if (textSet.has(raw)) continue
    textSet.add(raw)
    syncDarknetTextFile(ns, file, textSet)
  }
}

// ---- worker management ----

async function authenticateDarkwebEntry(
  ns: NS,
  dnet: DarknetCrawlApi,
  cachedPassword: string | null | undefined
): Promise<void> {
  if (cachedPassword != null) {
    const cached = await dnet.authenticate(DARKWEB, cachedPassword)
    if (cached.success) {
      return
    }
  }

  const details = dnet.getServerDetails(DARKWEB)
  const { password } = solveDarknetPassword(solverInputFromDetails(details))

  if (password !== null) {
    await dnet.authenticate(DARKWEB, password)
  } else {
    tryConnectToSession(dnet, DARKWEB, "")
  }
}

async function launchDarkwebCrawlWorker(
  ns: NS,
  source: string,
  sessionId: number
): Promise<number> {
  try {
    ns.scriptKill(DARKNET_CRAWL_SCRIPT, DARKWEB)
  } catch {
    // darkweb may be offline — ignore
  }
  await copyCrawlScript(ns, DARKWEB, source)
  const workerRam = ns.getScriptRam(DARKNET_CRAWL_SCRIPT, DARKWEB)
  const freeRam = ns.getServerMaxRam(DARKWEB) - ns.getServerUsedRam(DARKWEB)
  if (workerRam > freeRam) {
    throw new Error(
      `Not enough RAM on ${DARKWEB} for ${DARKNET_CRAWL_SCRIPT} (need ${ns.format.ram(workerRam)}, free ${ns.format.ram(freeRam)})`
    )
  }
  const pid = ns.exec(
    DARKNET_CRAWL_SCRIPT,
    DARKWEB,
    1,
    ...crawlWorkerArgs(sessionId)
  )
  if (pid === 0) {
    throw new Error(`Could not exec ${DARKNET_CRAWL_SCRIPT} on ${DARKWEB}`)
  }
  return pid
}

function crawlWorkerHosts(ns: NS, registry?: DarknetRegistry): string[] {
  const hosts = new Set<string>([ns.getHostname(), DARKWEB])
  if (registry) {
    for (const hostname of Object.keys(registry.servers)) {
      hosts.add(hostname)
    }
  }
  return [...hosts]
}

async function killCrawlWorkersOnHost(
  ns: NS,
  dnet: DarknetCrawlApi,
  host: string,
  password: string | null | undefined
): Promise<void> {
  if (host !== ns.getHostname() && password != null) {
    tryConnectToSession(dnet, host, password)
  }
  try {
    ns.scriptKill(DARKNET_CRAWL_SCRIPT, host)
  } catch {
    // host removed from darknet or no access
  }
}

/** Kill every darknetCrawl.js instance on known crawl hosts (registry + home + darkweb). */
export async function killAllCrawlWorkers(
  ns: NS,
  dnet: DarknetCrawlApi,
  registry?: DarknetRegistry
): Promise<void> {
  for (const host of crawlWorkerHosts(ns, registry)) {
    await killCrawlWorkersOnHost(ns, dnet, host, registry?.servers[host]?.password ?? null)
  }
}

// ---- master entry ----

export async function runDarknetCrawl(
  ns: NS,
  dnet: DarknetCrawlApi,
  reportPort: number,
  lorePort: number,
  onProgress?: CrawlProgressHandler,
  registry?: DarknetRegistry,
  intervalMs = 0,
  onWorkerError?: CrawlErrorHandler,
  killOnly = false
): Promise<DarknetCrawlResult> {
  const source = ns.getHostname()

  // ---- kill-only mode ----
  if (killOnly) {
    syncControlPort(ns, 0, 0, 0, new Map())

    const reports = new Map<string, CrawlHostReport>()
    const activeOps = new Map<string, CrawlStatusReport>()
    const cacheOpens: CrawlCacheOpen[] = []
    const loreSet = loadDarknetTextSet(ns, DARKNET_LORE_FILE)

    const emitProgress = async (workerRunning: boolean): Promise<void> => {
      if (!onProgress) return
      await onProgress({
        reports,
        activeOps: [...activeOps.values()],
        workerRunning,
        cacheOpens,
      })
    }

    await killAllCrawlWorkers(ns, dnet, registry)
    await emitProgress(true)

    // Poll until no workers remain running
    while (true) {
      await ns.sleep(1000)
      // Keep killing in case new ones spawned before the stop signal propagated
      await killAllCrawlWorkers(ns, dnet, registry)
      pollCrawlPort(ns, reportPort, reports, activeOps, cacheOpens, 0, new Map(), registry)
      pollTextPort(ns, lorePort, loreSet, DARKNET_LORE_FILE)
      await emitProgress(activeOps.size > 0)
      // Check if any workers still exist
      const hosts = crawlWorkerHosts(ns, registry)
      let anyRunning = false
      for (const host of hosts) {
        try {
          if (ns.isRunning(DARKNET_CRAWL_SCRIPT, host)) {
            anyRunning = true
            break
          }
        } catch {
          // host may be offline
        }
      }
      if (!anyRunning) break
    }

    return { reports, cacheOpens }
  }

  // ---- normal operation ----
  const continuous = intervalMs > 0
  let sessionId = Date.now()

  if (registry) {
    pruneInvalidRegistryHosts(dnet, registry)
    saveDarknetRegistry(ns, registry)
  }

  await authenticateDarkwebEntry(ns, dnet, registry?.servers[DARKWEB]?.password)
  await killAllCrawlWorkers(ns, dnet, registry)
  await ns.sleep(5000)

  ns.clearPort(reportPort)
  ns.clearPort(lorePort)

  // Initialize empty lock state and broadcast to workers
  const activeLocks: ActiveLocks = new Map()
  syncControlPort(ns, sessionId, reportPort, lorePort, activeLocks)

  const loreSet = loadDarknetTextSet(ns, DARKNET_LORE_FILE)

  let pid = await launchDarkwebCrawlWorker(ns, source, sessionId)

  const reports = new Map<string, CrawlHostReport>()
  const activeOps = new Map<string, CrawlStatusReport>()
  const cacheOpens: CrawlCacheOpen[] = []

  const emitProgress = async (workerRunning: boolean): Promise<void> => {
    if (!onProgress) {
      return
    }
    await onProgress({
      reports,
      activeOps: [...activeOps.values()],
      workerRunning,
      cacheOpens,
    })
  }

  await emitProgress(true)

  if (continuous) {
    while (true) {
      purgeDeadLocks(ns, activeLocks)
      pollCrawlPort(ns, reportPort, reports, activeOps, cacheOpens, sessionId, activeLocks, registry)
      pollTextPort(ns, lorePort, loreSet, DARKNET_LORE_FILE)
      syncControlPort(ns, sessionId, reportPort, lorePort, activeLocks)
      await emitProgress(true)
      if (!ns.isRunning(pid)) {
        onWorkerError?.(`${DARKNET_CRAWL_SCRIPT} daemon on ${DARKWEB} stopped — restarting`)
        try {
          sessionId = Date.now()
          activeLocks.clear()
          await killAllCrawlWorkers(ns, dnet, registry)
          await authenticateDarkwebEntry(ns, dnet, registry?.servers[DARKWEB]?.password)
          reports.clear()
          activeOps.clear()
          ns.clearPort(reportPort)
          ns.clearPort(lorePort)
          syncControlPort(ns, sessionId, reportPort, lorePort, activeLocks)
          await ns.sleep(5000)
          pid = await launchDarkwebCrawlWorker(ns, source, sessionId)
        } catch (restartErr) {
          onWorkerError?.(`Failed to restart daemon: ${String(restartErr)} — retrying in 30s`)
          await ns.sleep(30000)
          continue
        }
      }
      await ns.sleep(100)
    }
  }

  while (ns.isRunning(pid)) {
    purgeDeadLocks(ns, activeLocks)
    pollCrawlPort(ns, reportPort, reports, activeOps, cacheOpens, sessionId, activeLocks, registry)
    pollTextPort(ns, lorePort, loreSet, DARKNET_LORE_FILE)
    syncControlPort(ns, sessionId, reportPort, lorePort, activeLocks)
    await emitProgress(true)
    await ns.sleep(100)
  }

  // Signal all workers to stop — write a fresh sessionId to invalidate theirs
  syncControlPort(ns, 0, 0, 0, new Map())
  drainCrawlPort(ns, reportPort, reports, activeOps, cacheOpens, sessionId, activeLocks, registry)
  drainTextPort(ns, lorePort, loreSet, DARKNET_LORE_FILE)
  await emitProgress(false)

  return { reports, cacheOpens }
}
