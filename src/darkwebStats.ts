import { NS } from "@ns"
import {
  DEFAULT_CRAWL_INTERVAL_MS,
  DARKNET_REGISTRY_FILE,
  loadDarknetRegistry,
  mergeRegistryWithCrawl,
  pruneInvalidRegistryHosts,
  runDarknetCrawl,
  saveDarknetRegistry,
  type CrawlCacheOpen,
  type CrawlHostReport,
  type CrawlProgressState,
  type DarknetCrawlApi,
  type DarknetRegistry,
  type WorkerSnapshot,
} from "./darknetCrawl.js"
import { DARKSCAPE_NAVIGATOR, purchaseDarkscapeNavigator, purchaseTorRouter } from "./libraries/purchasePrograms.js"
import { CRAWL_REPORT_PORT, DARKNET_LORE_PORT } from "./libraries/ports.js"
import {
  col,
  createTabbedTailLog,
  openTailLog,
  renderTabbedTailLog,
  W,
  type TabbedScriptLogBuilder,
} from "./libraries/scriptLogUiLayout.js"

// --- config ---

const SERVER_TABLE_COLUMNS = [
  col("Host", "left", 20),
  col("Wrk", "center", 3),
  col("State", "left", 10),
  col("Last Command", "left", 18),
  col("Last Reply", "left", 18),
  col("Auth", "center", 4),
  col("Ngbrs", "right", 5),
]

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

function appendServerTable(
  log: TabbedScriptLogBuilder,
  workers: readonly WorkerSnapshot[],
  reports: ReadonlyMap<string, CrawlHostReport>,
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
  const rows: string[][] = []
  const workerMap = new Map(workers.map((w) => [w.host, w]))

  for (const hostname of allHosts) {
    const wi = workerMap.get(hostname)
    const report = reports.get(hostname)

    if (wi) {
      // Worker entry
      let state = "idle"
      if (!wi.probed) state = "init"
      else if (!wi.idle) state = "busy"

      let lastCmd = "-"
      if (wi.lastCommand) {
        lastCmd = `${wi.lastCommand} ${formatTimestamp(wi.lastCommandAt)}`
      }

      let lastReply = "-"
      if (wi.lastReply) {
        lastReply = `${wi.lastReply} ${formatTimestamp(wi.lastReplyAt)}`
      }

      const auth = report?.authenticated === true ? "Y" : report?.authenticated === false ? "F" : "-"

      rows.push([
        hostname,
        "Y",
        state,
        lastCmd,
        lastReply,
        auth,
        String(wi.neighbors.length),
      ])
    } else if (report) {
      // Report-only entry (no worker)
      const auth = report.authenticated === true ? "Y" : report.authenticated === false ? "F" : "-"
      rows.push([
        hostname,
        "N",
        auth === "Y" ? "auth" : "unknown",
        "-",
        "-",
        auth,
        "-",
      ])
    }
  }

  rows.sort((a, b) => a[0]!.localeCompare(b[0]!))

  log.tab("darknet").text(`${allHosts.size} server(s) | ${workers.length} worker(s)`)
  log.tab("darknet").table({
    title: "Servers",
    columns: SERVER_TABLE_COLUMNS,
    rows,
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
  displayReports: ReadonlyMap<string, CrawlHostReport>,
  cacheOpens: readonly CrawlCacheOpen[],
  summaryLine: string,
  workers: readonly WorkerSnapshot[],
): Promise<void> {
  tabbedLog.clearPanels()
  tabbedLog.tab("darknet").text(summaryLine)
  appendServerTable(tabbedLog, workers, displayReports)
  appendCacheOpenTable(tabbedLog, cacheOpens)
  await renderTabbedTailLog(ns, tabbedLog)
}

async function renderCrawlProgress(
  ns: NS,
  tabbedLog: TabbedScriptLogBuilder,
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

  await renderDashboard(
    ns,
    tabbedLog,
    displayReports,
    cacheOpens,
    `Crawl #${crawlNum} ${status} | registry ${Object.keys(registry.servers).length} host(s), ${knownPw} password(s) | ` +
      `auth ok ${auth.ok}, failed ${auth.failed}, skipped ${auth.skipped} | ` +
      `workers ${workerCount} | caches ${cacheOpens.length}`,
    state.workers,
  )
}

async function renderRegistrySummary(
  ns: NS,
  tabbedLog: TabbedScriptLogBuilder,
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
    displayReports,
    sessionCacheOpens,
    `Crawl #${crawlNum} done | registry ${Object.keys(registry.servers).length} host(s), ${knownPw} password(s) saved to ${DARKNET_REGISTRY_FILE} | ` +
      `auth ok ${auth.ok}, failed ${auth.failed}, skipped ${auth.skipped} | caches ${sessionCacheOpens.length}`,
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
      CRAWL_REPORT_PORT,
      DARKNET_LORE_PORT,
      async (state) => {
        await renderCrawlProgress(ns, tabbedLog, registry, state, crawlNum, sessionCacheOpens)
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
