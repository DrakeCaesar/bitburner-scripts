import { NS } from "@ns"
import {
  DEFAULT_CRAWL_INTERVAL_MS,
  DARKNET_REGISTRY_FILE,
  MAX_PROBE_DEPTH,
  formatCrawlOpShort,
  loadDarknetRegistry,
  mergeCrawlReportsIntoRegistry,
  mergeRegistryWithCrawl,
  runDarknetCrawl,
  saveDarknetRegistry,
  type CrawlCacheOpen,
  type CrawlHostReport,
  type CrawlProgressState,
  type CrawlStatusReport,
  type DarknetCrawlApi,
  type DarknetRegistry,
  type DarknetServerDetailsForFormulas,
} from "./darknetCrawl.js"
import {
  TabbedScriptLogBuilder,
  initScriptLogTail,
  measureTreeTableHostChars,
  type TabDefinition,
  type TableLayout,
  type TreeTableRow,
} from "./libraries/scriptLogUi.js"

// --- config ---

const DARKSCAPE_NAV = "DarkscapeNavigator.exe"

const DARKWEB_TABS: TabDefinition[] = [
  { id: "crawl", label: "Crawl" },
  { id: "caches", label: "Caches" },
]

const DARKWEB_STATS_LAYOUT: Partial<TableLayout> = {
  fontSizePx: 11,
  paddingXPx: 6,
  headerRowHeightPx: 22,
  bodyRowHeightPx: 18,
  tableWidthPx: 1050,
}

const ACT_COLUMN_HEADER = "Act"
const ACT_COLUMN_MIN_CHARS = 10
const HOST_COLUMN_MIN_CHARS = 16
let actColumnMaxChars = ACT_COLUMN_MIN_CHARS
let hostColumnMaxChars = HOST_COLUMN_MIN_CHARS

const TREE_DATA_COLUMNS = [
  { header: "Ses", align: "center" as const, minWidth: 3 },
  { header: "Gss", align: "right" as const, minWidth: 3 },
  { header: ACT_COLUMN_HEADER, align: "left" as const, minWidth: ACT_COLUMN_MIN_CHARS },
  { header: "On", align: "center" as const, minWidth: 2 },
  { header: "D", align: "right" as const, minWidth: 3 },
  { header: "Diff", align: "right" as const, minWidth: 4 },
  { header: "Model", align: "left" as const, minWidth: 11 },
  { header: "Cha", align: "right" as const, minWidth: 3 },
  { header: "Len", align: "right" as const, minWidth: 3 },
  { header: "RAM", align: "right" as const, minWidth: 7 },
]

const CACHE_TABLE_COLUMNS = [
  { header: "Host", align: "left" as const, minWidth: 16 },
  { header: "File", align: "left" as const, minWidth: 18 },
  { header: "Karma", align: "right" as const, minWidth: 5 },
  { header: "Reward", align: "left" as const, minWidth: 24 },
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

function buildDarknetTreeRows(
  ns: NS,
  dnet: DarknetApi,
  reports: ReadonlyMap<string, CrawlHostReport>,
  activeOps: readonly CrawlStatusReport[]
): TreeTableRow[] {
  const activeByTarget = activeOpsByTarget(activeOps)

  return [...reports.keys()].map((hostname) => {
    const details = dnet.getServerDetails(hostname)
    const server = ns.getServer(hostname)
    const report = reports.get(hostname)
    const op = activeByTarget.get(hostname)
    const ses =
      report?.authenticated === true || details.hasSession
        ? "Y"
        : report?.authenticated === false
          ? "F"
          : ""

    return {
      id: hostname,
      parentId: report?.parentHost ?? null,
      label: hostname,
      highlight: op != null,
      cells: [
        ses,
        formatAuthGuesses(report, op),
        op ? formatCrawlOpShort(op) : "",
        details.isOnline ? "Y" : "N",
        String(details.depth),
        String(details.difficulty),
        details.modelId || "-",
        String(details.requiredCharismaSkill),
        String(details.passwordLength),
        ns.format.ram(server.maxRam, 0),
      ],
    }
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
  if (reports.size === 0) {
    return
  }
  const rows = buildDarknetTreeRows(ns, dnet, reports, activeOps)
  const rootIds = reports.has("darkweb") ? ["darkweb"] : undefined
  bumpActColumnMax(rows)
  bumpHostColumnMax(rows, rootIds)
  log.tab("crawl").treeTable({
    layout: DARKWEB_STATS_LAYOUT,
    title,
    rootIds,
    treeMinWidth: hostColumnMaxChars,
    columns: treeDataColumns(),
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
  const builder = log.tab("caches")
  if (cacheOpens.length === 0) {
    builder.text("No caches opened yet this session.")
    return
  }

  const sorted = [...cacheOpens].sort((a, b) => b.openedAt - a.openedAt)
  builder.text(`${sorted.length} cache(s) opened | total karma ${sumCacheKarma(sorted)}`)
  builder.table({
    layout: DARKWEB_STATS_LAYOUT,
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
  await tabbedLog.render(ns)
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
      `shown ${displayReports.size} | auth ok ${auth.ok}, failed ${auth.failed}, skipped ${auth.skipped}` +
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
      `auth ok ${auth.ok}, failed ${auth.failed}, skipped ${auth.skipped} | caches ${sessionCacheOpens.length}`
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
  initScriptLogTail(ns, "Darknet", DARKWEB_STATS_LAYOUT)

  const tabbedLog = new TabbedScriptLogBuilder(DARKWEB_TABS, DARKWEB_STATS_LAYOUT)

  const dnet = getDarknetApi(ns)
  if (!dnet) {
    tabbedLog.tab("crawl").text("ERROR: ns.dnet API not available")
    await tabbedLog.render(ns)
    return
  }
  if (!ns.hasTorRouter()) {
    tabbedLog.tab("crawl").text("ERROR: Need a TOR router")
    await tabbedLog.render(ns)
    return
  }
  if (!ns.fileExists(DARKSCAPE_NAV, "home")) {
    tabbedLog.tab("crawl").text(`ERROR: Need ${DARKSCAPE_NAV} on home`)
    await tabbedLog.render(ns)
    return
  }

  const crawlIntervalMs = parseCrawlIntervalMs(ns)
  let registry = loadDarknetRegistry(ns)
  let crawlNum = 0
  const sessionCacheOpens: CrawlCacheOpen[] = []

  while (true) {
    crawlNum++
    try {
      const { reports, cacheOpens } = await runDarknetCrawl(
        ns,
        dnet,
        MAX_PROBE_DEPTH,
        async (state) => {
          await renderCrawlProgress(ns, dnet, tabbedLog, registry, state, crawlNum, sessionCacheOpens)
        },
        registry
      )
      sessionCacheOpens.push(...cacheOpens)
      mergeCrawlReportsIntoRegistry(registry, reports)
      saveDarknetRegistry(ns, registry)
      await renderRegistrySummary(ns, dnet, tabbedLog, registry, reports, crawlNum, sessionCacheOpens)
    } catch (err) {
      tabbedLog.clearPanels()
      tabbedLog.tab("crawl").text(`ERROR crawl #${crawlNum}: ${String(err)}`)
      await tabbedLog.render(ns)
    }

    await ns.sleep(crawlIntervalMs)
  }
}
