import { NS } from "@ns"
import {
  DEFAULT_CRAWL_INTERVAL_MS,
  DARKNET_REGISTRY_FILE,
  formatCrawlOpShort,
  loadDarknetRegistry,
  mergeRegistryWithCrawl,
  pruneInvalidRegistryHosts,
  runDarknetCrawl,
  safeGetServerDetails,
  saveDarknetRegistry,
  type CrawlCacheOpen,
  type CrawlHostReport,
  type CrawlProgressState,
  type CrawlStatusReport,
  type DarknetCrawlApi,
  type DarknetRegistry,
  type DarknetServerDetailsForFormulas,
} from "./darknetCrawl.js"
import { DARKSCAPE_NAVIGATOR, purchaseDarkscapeNavigator, purchaseTorRouter } from "./libraries/purchasePrograms.js"
import { CRAWL_REPORT_PORT, DARKNET_LORE_PORT } from "./libraries/ports.js"
import {
  col,
  createTabbedTailLog,
  measureTreeTableHostChars,
  openTailLog,
  renderTabbedTailLog,
  W,
  type TabDefinition,
  type TabbedScriptLogBuilder,
  type TreeTableRow,
} from "./libraries/scriptLogUiLayout.js"

// --- config ---

const DARKWEB_TABS: TabDefinition[] = [
  { id: "crawl", label: "Crawl" },
  { id: "caches", label: "Caches" },
]

const ACT_COLUMN_HEADER = "Act"
const ACT_COLUMN_MIN_CHARS = 10
const HOST_COLUMN_MIN_CHARS = 16
let actColumnMaxChars = ACT_COLUMN_MIN_CHARS
let hostColumnMaxChars = HOST_COLUMN_MIN_CHARS

const TREE_DATA_COLUMNS = [
  col("Ses", "center", W.ses),
  col("Gss", "right", W.gss),
  col(ACT_COLUMN_HEADER, "left", ACT_COLUMN_MIN_CHARS),
  col("D", "right", W.dCol),
  col("Diff", "right", W.diff),
  col("Model", "left", W.model),
  col("Cha", "right", W.cha),
  col("Len", "right", W.len),
  col("RAM", "right", W.num),
]

const CACHE_TABLE_COLUMNS = [
  col("Host", "left", W.host),
  col("File", "left", W.file),
  col("Karma", "right", W.job),
  col("Reward", "left", W.reward),
]

// --- types ---

interface DarknetApi extends DarknetCrawlApi {
  getServerDetails(host?: string): DarknetServerDetailsForFormulas
}

// --- ui ---

function getDarknetApi(ns: NS): DarknetApi | null {
  return (ns as NS & { dnet?: DarknetApi }).dnet ?? null
}

function formatAuthGuesses(
  report: CrawlHostReport | undefined,
  op: CrawlStatusReport | undefined
): string {
  if (op?.authGuesses != null) {
    return String(op.authGuesses)
  }
  if (report?.authGuesses != null) {
    return String(report.authGuesses)
  }
  return ""
}

function activeOpsByTarget(activeOps: readonly CrawlStatusReport[]): Map<string, CrawlStatusReport> {
  const byTarget = new Map<string, CrawlStatusReport>()
  for (const op of activeOps) {
    byTarget.set(op.targetHost, op)
  }
  return byTarget
}

function countOnlineHosts(dnet: DarknetApi, reports: ReadonlyMap<string, CrawlHostReport>): number {
  let n = 0
  for (const hostname of reports.keys()) {
    const details = safeGetServerDetails(dnet, hostname)
    if (details?.isOnline) n++
  }
  return n
}

function buildDarknetTreeRows(
  ns: NS,
  dnet: DarknetApi,
  reports: ReadonlyMap<string, CrawlHostReport>,
  activeOps: readonly CrawlStatusReport[]
): TreeTableRow[] {
  const activeByTarget = activeOpsByTarget(activeOps)

  return [...reports.keys()].flatMap((hostname) => {
    const details = safeGetServerDetails(dnet, hostname)
    if (!details?.isOnline) {
      return []
    }
    const server = ns.getServer(hostname)
    const report = reports.get(hostname)
    const op = activeByTarget.get(hostname)
    const ses =
      report?.authenticated === true || details.hasSession
        ? "Y"
        : report?.authenticated === false
          ? "F"
          : ""

    return [
      {
        id: hostname,
        parentId: report?.parentHost ?? null,
        label: hostname,
        cells: [
          ses,
          formatAuthGuesses(report, op),
          op ? formatCrawlOpShort(op) : "",
          String(details.depth),
          String(details.difficulty),
          details.modelId || "-",
          String(details.requiredCharismaSkill),
          String(details.passwordLength),
          ns.format.ram(server.maxRam, 0),
        ],
      },
    ]
  })
}

function bumpActColumnMax(rows: TreeTableRow[]): void {
  for (const row of rows) {
    const act = row.cells[2] ?? ""
    if (act.length > actColumnMaxChars) {
      actColumnMaxChars = act.length
    }
  }
}

function bumpHostColumnMax(rows: TreeTableRow[], rootIds?: string[]): void {
  const measured = measureTreeTableHostChars(rows, rootIds)
  if (measured > hostColumnMaxChars) {
    hostColumnMaxChars = measured
  }
}

function treeDataColumns() {
  return TREE_DATA_COLUMNS.map((col) =>
    col.header === ACT_COLUMN_HEADER ? { ...col, minWidth: actColumnMaxChars } : col
  )
}

function appendDarknetTreeTable(
  log: TabbedScriptLogBuilder,
  ns: NS,
  dnet: DarknetApi,
  reports: ReadonlyMap<string, CrawlHostReport>,
  activeOps: readonly CrawlStatusReport[],
  title: string
): void {
  const rows = buildDarknetTreeRows(ns, dnet, reports, activeOps)
  if (rows.length === 0) {
    return
  }
  const rootIds = reports.has("darkweb") ? ["darkweb"] : undefined
  bumpActColumnMax(rows)
  bumpHostColumnMax(rows, rootIds)
  log.tab("crawl").treeTable({
    title,
    rootIds,
    treeMinWidth: hostColumnMaxChars,
    columns: treeDataColumns(),
    rows,
    singleBodyRow: true,
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
  const builder = log.tab("caches")
  if (cacheOpens.length === 0) {
    builder.text("No caches opened yet this session.")
    return
  }

  const sorted = [...cacheOpens].sort((a, b) => b.openedAt - a.openedAt)
  builder.text(`${sorted.length} cache(s) opened | total karma ${sumCacheKarma(sorted)}`)
  builder.table({
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
  dnet: DarknetApi,
  tabbedLog: TabbedScriptLogBuilder,
  registry: DarknetRegistry,
  displayReports: ReadonlyMap<string, CrawlHostReport>,
  activeOps: readonly CrawlStatusReport[],
  cacheOpens: readonly CrawlCacheOpen[],
  summaryLine: string
): Promise<void> {
  tabbedLog.clearPanels()
  tabbedLog.tab("crawl").text(summaryLine)
  appendDarknetTreeTable(tabbedLog, ns, dnet, displayReports, activeOps, "Darknet crawl")
  appendCacheOpenTable(tabbedLog, cacheOpens)
  await renderTabbedTailLog(ns, tabbedLog)
}

async function renderCrawlProgress(
  ns: NS,
  dnet: DarknetApi,
  tabbedLog: TabbedScriptLogBuilder,
  registry: DarknetRegistry,
  state: CrawlProgressState,
  crawlNum: number,
  sessionCacheOpens: readonly CrawlCacheOpen[]
): Promise<void> {
  const displayReports = mergeRegistryWithCrawl(registry, state.reports)
  const auth = countAuthStats(displayReports)
  const onlineCount = countOnlineHosts(dnet, displayReports)
  const status = state.workerRunning ? "running" : "done"
  const activeCount = state.activeOps.length
  const knownPw = countRegistryPasswords(registry)
  const cacheOpens = [...sessionCacheOpens, ...state.cacheOpens]

  await renderDashboard(
    ns,
    dnet,
    tabbedLog,
    registry,
    displayReports,
    state.activeOps,
    cacheOpens,
    `Crawl #${crawlNum} ${status} | registry ${Object.keys(registry.servers).length} host(s), ${knownPw} password(s) | ` +
      `shown ${onlineCount} online | auth ok ${auth.ok}, failed ${auth.failed}, skipped ${auth.skipped}` +
      (activeCount > 0 ? ` | active ${activeCount}` : "") +
      ` | caches ${cacheOpens.length}`
  )
}

async function renderRegistrySummary(
  ns: NS,
  dnet: DarknetApi,
  tabbedLog: TabbedScriptLogBuilder,
  registry: DarknetRegistry,
  crawlReports: ReadonlyMap<string, CrawlHostReport>,
  crawlNum: number,
  sessionCacheOpens: readonly CrawlCacheOpen[]
): Promise<void> {
  const displayReports = mergeRegistryWithCrawl(registry, crawlReports)
  const auth = countAuthStats(displayReports)
  const onlineCount = countOnlineHosts(dnet, displayReports)
  const knownPw = countRegistryPasswords(registry)

  await renderDashboard(
    ns,
    dnet,
    tabbedLog,
    registry,
    displayReports,
    [],
    sessionCacheOpens,
    `Crawl #${crawlNum} done | registry ${Object.keys(registry.servers).length} host(s), ${knownPw} password(s) saved to ${DARKNET_REGISTRY_FILE} | ` +
      `shown ${onlineCount} online | auth ok ${auth.ok}, failed ${auth.failed}, skipped ${auth.skipped} | caches ${sessionCacheOpens.length}`
  )
}

function parseCrawlIntervalMs(ns: NS): number {
  const arg = Number(ns.args[0])
  if (Number.isFinite(arg) && arg > 0) {
    return arg
  }
  return DEFAULT_CRAWL_INTERVAL_MS
}

// --- entry ---

export async function main(ns: NS): Promise<void> {
  actColumnMaxChars = ACT_COLUMN_MIN_CHARS
  hostColumnMaxChars = HOST_COLUMN_MIN_CHARS
  openTailLog(ns, "Darknet")

  const tabbedLog = createTabbedTailLog(DARKWEB_TABS)

  const logCrawl = (message: string) => {
    tabbedLog.tab("crawl").text(message)
  }

  if (!ns.hasTorRouter()) {
    purchaseTorRouter(ns, logCrawl)
  }
  if (!ns.fileExists(DARKSCAPE_NAVIGATOR, "home")) {
    purchaseDarkscapeNavigator(ns, logCrawl)
  }

  if (!ns.hasTorRouter()) {
    tabbedLog.tab("crawl").text("ERROR: Need a TOR router")
    await renderTabbedTailLog(ns, tabbedLog)
    return
  }
  if (!ns.fileExists(DARKSCAPE_NAVIGATOR, "home")) {
    tabbedLog.tab("crawl").text(`ERROR: Need ${DARKSCAPE_NAVIGATOR} on home`)
    await renderTabbedTailLog(ns, tabbedLog)
    return
  }

  const dnet = getDarknetApi(ns)
  if (!dnet) {
    tabbedLog.tab("crawl").text("ERROR: ns.dnet API not available")
    await renderTabbedTailLog(ns, tabbedLog)
    return
  }

  const killOnly = ns.args[0] === "kill"
  const crawlIntervalMs = killOnly ? 0 : parseCrawlIntervalMs(ns)
  let registry = loadDarknetRegistry(ns)
  const pruned = pruneInvalidRegistryHosts(dnet, registry)
  if (pruned.length > 0) {
    saveDarknetRegistry(ns, registry)
  }
  let crawlNum = 0
  const sessionCacheOpens: CrawlCacheOpen[] = []

  try {
    await runDarknetCrawl(
      ns,
      dnet,
      CRAWL_REPORT_PORT,
      DARKNET_LORE_PORT,
      async (state) => {
        await renderCrawlProgress(ns, dnet, tabbedLog, registry, state, crawlNum, sessionCacheOpens)
      },
      registry,
      crawlIntervalMs,
      logCrawl,
      killOnly
    )
  } catch (err) {
    tabbedLog.clearPanels()
    tabbedLog.tab("crawl").text(`ERROR: ${String(err)}`)
    await renderTabbedTailLog(ns, tabbedLog)
  }
}
