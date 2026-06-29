import { NS } from "@ns"
import {
  DEFAULT_CRAWL_INTERVAL_MS,
  DARKNET_REGISTRY_FILE,
  loadDarknetRegistry,
  mergeRegistryWithCrawl,
  pruneInvalidRegistryHosts,
  runDarknetCrawl,
  saveDarknetRegistry,
  safeGetServerDetails,
  type CrawlCacheOpen,
  type CrawlHostReport,
  type CrawlProgressState,
  type CrawlTargetSnapshot,
  type CrawlQueueSummary,
  type DarknetCrawlApi,
  type DarknetRegistry,
  type SolverTiming,
  type WorkerSnapshot,
} from "./darknetCrawl.js"
import { DARKSCAPE_NAVIGATOR, purchaseDarkscapeNavigator, purchaseTorRouter } from "./libraries/purchasePrograms.js"
import { DARKNET_LORE_PORT } from "./libraries/ports.js"
import {
  col,
  createTabbedTailLog,
  openTailLog,
  renderTabbedTailLog,
  W,
  type TabbedScriptLogBuilder,
} from "./libraries/scriptLogUiLayout.js"

// --- config ---

function formatTimingMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

const SOLVER_TIMING_COLUMNS = [
  col("Solver", "left", 18),
  col("Count", "right", 6),
  col("Total", "right", 9),
  col("Avg", "right", 9),
]

function appendSolverTimingTable(
  log: TabbedScriptLogBuilder,
  timings: readonly SolverTiming[],
): void {
  if (timings.length === 0) return

  const rows = timings.map((t) => [
    t.solverId,
    String(t.count),
    formatTimingMs(t.totalMs),
    formatTimingMs(Math.round(t.totalMs / t.count)),
  ])

  log.tab("darknet").table({
    title: "Solver execution times",
    columns: SOLVER_TIMING_COLUMNS,
    rows,
  })
}

const SERVER_TABLE_COLUMNS = [
  col("Host", "left", 20),
  col("Dpth", "right", 4),
  col("Wrk", "center", 3),
  col("State", "left", 10),
  col("Last Cmd", "left", 20),
  col("Cmd At", "right", 7),
  col("Last Reply", "left", 18),
  col("Reply At", "right", 7),
  col("Auth", "center", 4),
  col("Ngbrs", "right", 5),
  col("Blk", "right", 4),
]

/** Depth for table sort/display; offline hosts sort last. */
function serverDepthSortKey(dnet: DarknetCrawlApi, hostname: string): { sortKey: number; label: string } {
  const details = safeGetServerDetails(dnet, hostname)
  if (!details?.isOnline || details.depth < 0) {
    return { sortKey: Number.MAX_SAFE_INTEGER, label: "-" }
  }
  return { sortKey: details.depth, label: String(details.depth) }
}

// Track maximum observed content width per column (index-aligned with SERVER_TABLE_COLUMNS)
// so the table only grows, never shrinks between renders.
const _serverTableColumnMaxes: number[] = SERVER_TABLE_COLUMNS.map((c) => c.minWidth ?? 0)

const CACHE_TABLE_COLUMNS = [
  col("Host", "left", W.host),
  col("File", "left", W.file),
  col("Karma", "right", W.job),
  col("Reward", "left", W.reward),
]

// --- ui ---

function formatTimestamp(ts: number): string {
  if (ts <= 0) return "-"
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

function formatGB(gb: number): string {
  if (gb <= 0) return "0"
  if (gb >= 1024) return `${Math.round(gb / 1024)}T`
  return `${Math.round(gb)}G`
}

function reportOnlyState(
  hostname: string,
  report: CrawlHostReport,
  targetByHost: ReadonlyMap<string, CrawlTargetSnapshot>,
): string {
  if (report.authenticated === true) return "auth"
  const target = targetByHost.get(hostname)
  if (target) {
    switch (target.queueState) {
      case "queued": return "queued"
      case "pending": return "pending"
      case "unreachable": return "unreachable"
      case "exhausted": return "exhausted"
      case "done": return "done"
      default: return "unauth"
    }
  }
  return report.authenticated === false ? "unauth" : "offline"
}

function appendServerTable(
  log: TabbedScriptLogBuilder,
  dnet: DarknetCrawlApi,
  workers: readonly WorkerSnapshot[],
  reports: ReadonlyMap<string, CrawlHostReport>,
  targets: readonly CrawlTargetSnapshot[] = [],
): void {
  if (workers.length === 0) {
    log.tab("darknet").text("No workers connected — waiting for probe results.")
    return
  }

  // Build a set of worker hosts
  const workerHosts = new Set(workers.map((w) => w.host))

  // Also include servers from reports that don't have workers
  const allHosts = new Set<string>(workerHosts)
  for (const hostname of reports.keys()) {
    if (!workerHosts.has(hostname)) allHosts.add(hostname)
  }

  // Build rows: workers first, then report-only servers
  const entries: { sortKey: number; cells: string[] }[] = []
  const workerMap = new Map(workers.map((w) => [w.host, w]))
  const targetByHost = new Map(targets.map((t) => [t.host, t]))

  for (const hostname of allHosts) {
    const wi = workerMap.get(hostname)
    const report = reports.get(hostname)
    const { sortKey, label: depthLabel } = serverDepthSortKey(dnet, hostname)

    if (wi) {
      // Worker entry
      let state = "idle"
      if (!wi.probed) state = "init"
      else if (!wi.idle) state = "busy"

      let lastCmd = "-"
      let cmdAt = "-"
      if (wi.lastCommand) {
        if (wi.lastCommandDetail && wi.lastCommand !== "probe") {
          lastCmd = `${wi.lastCommand}:${wi.lastCommandDetail}`
        } else {
          lastCmd = wi.lastCommand
        }
        cmdAt = formatTimestamp(wi.lastCommandAt)
      }

      let lastReply = "-"
      let replyAt = "-"
      if (wi.lastReply) {
        lastReply = wi.lastReply
        replyAt = formatTimestamp(wi.lastReplyAt)
      }

      const auth = report?.authenticated === true ? "Y" : report?.authenticated === false ? "F" : "-"
      const queued = targetByHost.get(hostname)
      const wrkCol = queued && queued.queueState !== "done" ? "Q" : "Y"

      entries.push({
        sortKey,
        cells: [
          hostname,
          depthLabel,
          wrkCol,
          state,
          lastCmd,
          cmdAt,
          lastReply,
          replyAt,
          auth,
          String(wi.neighbors.length),
          formatGB(wi.blockedRam),
        ],
      })
    } else if (report) {
      // Report-only entry (no worker on this host)
      const auth = report.authenticated === true ? "Y" : report.authenticated === false ? "F" : "-"
      entries.push({
        sortKey,
        cells: [
          hostname,
          depthLabel,
          "N",
          reportOnlyState(hostname, report, targetByHost),
          "-", "-",
          "-", "-",
          auth,
          "-",
          "-",
        ],
      })
    }
  }

  entries.sort((a, b) => a.sortKey - b.sortKey || a.cells[0]!.localeCompare(b.cells[0]!))
  const rows = entries.map((e) => e.cells)
  const separatorAfter: number[] = []
  for (let i = 0; i < entries.length - 1; i++) {
    if (entries[i]!.sortKey !== entries[i + 1]!.sortKey) {
      separatorAfter.push(i)
    }
  }

  // Stabilize column widths: update tracked maximums from current data,
  // then use those maximums as minWidth so the table only grows, never shrinks.
  const currentMaxes = SERVER_TABLE_COLUMNS.map((_, colIdx) =>
    rows.reduce((max, row) => {
      const cell = row[colIdx]
      return cell ? Math.max(max, cell.length) : max
    }, 0)
  )
  for (let i = 0; i < currentMaxes.length; i++) {
    _serverTableColumnMaxes[i] = Math.max(currentMaxes[i], _serverTableColumnMaxes[i])
  }
  const stableColumns = SERVER_TABLE_COLUMNS.map((c, i) => ({
    ...c,
    minWidth: _serverTableColumnMaxes[i],
  }))

  log.tab("darknet").text(`${allHosts.size} server(s) | ${workers.length} worker(s)`)
  log.tab("darknet").table({
    title: "Servers",
    columns: stableColumns,
    rows,
    separatorAfter,
  })
}

function sumCacheKarma(cacheOpens: readonly CrawlCacheOpen[]): number {
  let total = 0
  for (const entry of cacheOpens) {
    total += entry.karmaLoss
  }
  return total
}

function appendCacheOpenTable(log: TabbedScriptLogBuilder, cacheOpens: readonly CrawlCacheOpen[]): void {
  if (cacheOpens.length === 0) return

  const sorted = [...cacheOpens].sort((a, b) => b.openedAt - a.openedAt)
  log.tab("darknet").text(`${sorted.length} cache(s) opened | total karma ${sumCacheKarma(sorted)}`)
  log.tab("darknet").table({
    title: "Opened caches",
    columns: CACHE_TABLE_COLUMNS,
    rows: sorted.map((entry) => [entry.host, entry.file, String(entry.karmaLoss), entry.message]),
  })
}

function countAuthStats(reports: ReadonlyMap<string, CrawlHostReport>): {
  ok: number
  failed: number
  skipped: number
} {
  let ok = 0
  let failed = 0
  let skipped = 0
  for (const report of reports.values()) {
    if (report.authenticated === true) ok++
    else if (report.authenticated === false) failed++
    else skipped++
  }
  return { ok, failed, skipped }
}

function countRegistryPasswords(registry: DarknetRegistry): number {
  let n = 0
  for (const entry of Object.values(registry.servers)) {
    if (entry.password != null) n++
  }
  return n
}

async function renderDashboard(
  ns: NS,
  tabbedLog: TabbedScriptLogBuilder,
  dnet: DarknetCrawlApi,
  displayReports: ReadonlyMap<string, CrawlHostReport>,
  cacheOpens: readonly CrawlCacheOpen[],
  summaryLine: string,
  workers: readonly WorkerSnapshot[],
  solverTimings: readonly SolverTiming[],
  targets: readonly CrawlTargetSnapshot[] = [],
): Promise<void> {
  tabbedLog.clearPanels()
  tabbedLog.tab("darknet").text(summaryLine)
  appendSolverTimingTable(tabbedLog, solverTimings)
  appendServerTable(tabbedLog, dnet, workers, displayReports, targets)
  appendCacheOpenTable(tabbedLog, cacheOpens)
  await renderTabbedTailLog(ns, tabbedLog)
}

async function renderCrawlProgress(
  ns: NS,
  tabbedLog: TabbedScriptLogBuilder,
  dnet: DarknetCrawlApi,
  registry: DarknetRegistry,
  state: CrawlProgressState,
  crawlNum: number,
  sessionCacheOpens: readonly CrawlCacheOpen[]
): Promise<void> {
  const displayReports = mergeRegistryWithCrawl(registry, state.reports)
  const auth = countAuthStats(displayReports)
  const status = state.workerRunning ? "running" : "done"
  const knownPw = countRegistryPasswords(registry)
  const cacheOpens = [...sessionCacheOpens, ...state.cacheOpens]
  const workerCount = state.workers.length
  const qs = state.queueSummary

  await renderDashboard(
    ns,
    tabbedLog,
    dnet,
    displayReports,
    cacheOpens,
    `Crawl #${crawlNum} ${status} | registry ${Object.keys(registry.servers).length} host(s), ${knownPw} password(s) | ` +
      `auth ok ${auth.ok}, failed ${auth.failed}, skipped ${auth.skipped} | ` +
      `workers ${workerCount} | targets q${qs.queued} p${qs.pending} u${qs.unreachable} stale${qs.staleReports} | caches ${cacheOpens.length}`,
    state.workers,
    state.solverTimings,
    state.targets,
  )
}

async function renderRegistrySummary(
  ns: NS,
  tabbedLog: TabbedScriptLogBuilder,
  dnet: DarknetCrawlApi,
  registry: DarknetRegistry,
  crawlReports: ReadonlyMap<string, CrawlHostReport>,
  crawlNum: number,
  sessionCacheOpens: readonly CrawlCacheOpen[]
): Promise<void> {
  const displayReports = mergeRegistryWithCrawl(registry, crawlReports)
  const auth = countAuthStats(displayReports)
  const knownPw = countRegistryPasswords(registry)

  await renderDashboard(
    ns,
    tabbedLog,
    dnet,
    displayReports,
    sessionCacheOpens,
    `Crawl #${crawlNum} done | registry ${Object.keys(registry.servers).length} host(s), ${knownPw} password(s) saved to ${DARKNET_REGISTRY_FILE} | ` +
      `auth ok ${auth.ok}, failed ${auth.failed}, skipped ${auth.skipped} | caches ${sessionCacheOpens.length}`,
    [],
    [],
    [],
  )
}

function parseCrawlIntervalMs(ns: NS): number {
  const arg = Number(ns.args[0])
  if (Number.isFinite(arg) && arg > 0) return arg
  return DEFAULT_CRAWL_INTERVAL_MS
}

// --- entry ---

export async function main(ns: NS): Promise<void> {
  openTailLog(ns, "Darknet")

  const tabbedLog = createTabbedTailLog([{ id: "darknet", label: "Darknet" }])

  const logCrawl = (message: string) => {
    tabbedLog.tab("darknet").text(message)
  }

  if (!ns.hasTorRouter()) purchaseTorRouter(ns, logCrawl)
  if (!ns.fileExists(DARKSCAPE_NAVIGATOR, "home")) purchaseDarkscapeNavigator(ns, logCrawl)

  if (!ns.hasTorRouter()) {
    tabbedLog.tab("darknet").text("ERROR: Need a TOR router")
    await renderTabbedTailLog(ns, tabbedLog)
    return
  }
  if (!ns.fileExists(DARKSCAPE_NAVIGATOR, "home")) {
    tabbedLog.tab("darknet").text(`ERROR: Need ${DARKSCAPE_NAVIGATOR} on home`)
    await renderTabbedTailLog(ns, tabbedLog)
    return
  }

  const dnet = (ns as NS & { dnet?: DarknetCrawlApi }).dnet ?? null
  if (!dnet) {
    tabbedLog.tab("darknet").text("ERROR: ns.dnet API not available")
    await renderTabbedTailLog(ns, tabbedLog)
    return
  }

  const killOnly = ns.args[0] === "kill"
  const crawlIntervalMs = killOnly ? 0 : parseCrawlIntervalMs(ns)
  let registry = loadDarknetRegistry(ns)
  const pruned = pruneInvalidRegistryHosts(dnet, registry)
  if (pruned.length > 0) saveDarknetRegistry(ns, registry)
  let crawlNum = 0
  const sessionCacheOpens: CrawlCacheOpen[] = []

  try {
    await runDarknetCrawl(
      ns,
      dnet,
      DARKNET_LORE_PORT,
      async (state) => {
        await renderCrawlProgress(ns, tabbedLog, dnet, registry, state, crawlNum, sessionCacheOpens)
      },
      registry,
      crawlIntervalMs,
      logCrawl,
      killOnly
    )
  } catch (err) {
    tabbedLog.clearPanels()
    tabbedLog.tab("darknet").text(`ERROR: ${String(err)}`)
    await renderTabbedTailLog(ns, tabbedLog)
  }
}
