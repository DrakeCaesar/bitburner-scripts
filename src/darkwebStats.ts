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
  type CrawlHostReport,
  type CrawlProgressState,
  type CrawlStatusReport,
  type DarknetCrawlApi,
  type DarknetRegistry,
  type DarknetServerDetailsForFormulas,
} from "./darknetCrawl.js"
import {
  ScriptLogBuilder,
  initScriptLogTail,
  measureTreeTableHostChars,
  type TableLayout,
  type TreeTableRow,
} from "./libraries/scriptLogUi.js"

// --- config ---

const DARKSCAPE_NAV = "DarkscapeNavigator.exe"

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
  log: ScriptLogBuilder,
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
  log.treeTable({
    layout: DARKWEB_STATS_LAYOUT,
    title,
    rootIds,
    treeMinWidth: hostColumnMaxChars,
    columns: treeDataColumns(),
    rows,
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

async function renderCrawlProgress(
  ns: NS,
  dnet: DarknetApi,
  registry: DarknetRegistry,
  state: CrawlProgressState,
  crawlNum: number
): Promise<void> {
  const displayReports = mergeRegistryWithCrawl(registry, state.reports)
  const auth = countAuthStats(displayReports)
  const status = state.workerRunning ? "running" : "done"
  const activeCount = state.activeOps.length
  const knownPw = countRegistryPasswords(registry)

  await renderLog(ns, (log) => {
    log.text(
      `Crawl #${crawlNum} ${status} | registry ${Object.keys(registry.servers).length} host(s), ${knownPw} password(s) | ` +
        `shown ${displayReports.size} | auth ok ${auth.ok}, failed ${auth.failed}, skipped ${auth.skipped}` +
        (activeCount > 0 ? ` | active ${activeCount}` : "")
    )
    appendDarknetTreeTable(log, ns, dnet, displayReports, state.activeOps, "Darknet crawl")
  })
}

async function renderRegistrySummary(
  ns: NS,
  dnet: DarknetApi,
  registry: DarknetRegistry,
  crawlReports: ReadonlyMap<string, CrawlHostReport>,
  crawlNum: number
): Promise<void> {
  const displayReports = mergeRegistryWithCrawl(registry, crawlReports)
  const auth = countAuthStats(displayReports)
  const knownPw = countRegistryPasswords(registry)

  await renderLog(ns, (log) => {
    log.text(
      `Crawl #${crawlNum} done | registry ${Object.keys(registry.servers).length} host(s), ${knownPw} password(s) saved to ${DARKNET_REGISTRY_FILE} | ` +
        `auth ok ${auth.ok}, failed ${auth.failed}, skipped ${auth.skipped}`
    )
    appendDarknetTreeTable(log, ns, dnet, displayReports, [], "Darknet crawl")
  })
}

async function renderLog(ns: NS, build: (log: ScriptLogBuilder) => void): Promise<void> {
  const log = new ScriptLogBuilder(DARKWEB_STATS_LAYOUT)
  build(log)
  await log.render(ns)
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

  const dnet = getDarknetApi(ns)
  if (!dnet) {
    await renderLog(ns, (log) => log.text("ERROR: ns.dnet API not available"))
    return
  }
  if (!ns.hasTorRouter()) {
    await renderLog(ns, (log) => log.text("ERROR: Need a TOR router"))
    return
  }
  if (!ns.fileExists(DARKSCAPE_NAV, "home")) {
    await renderLog(ns, (log) => log.text(`ERROR: Need ${DARKSCAPE_NAV} on home`))
    return
  }

  const crawlIntervalMs = parseCrawlIntervalMs(ns)
  let registry = loadDarknetRegistry(ns)
  let crawlNum = 0

  while (true) {
    crawlNum++
    try {
      const reports = await runDarknetCrawl(
        ns,
        dnet,
        MAX_PROBE_DEPTH,
        async (state) => {
          await renderCrawlProgress(ns, dnet, registry, state, crawlNum)
        },
        registry
      )
      mergeCrawlReportsIntoRegistry(registry, reports)
      saveDarknetRegistry(ns, registry)
      await renderRegistrySummary(ns, dnet, registry, reports, crawlNum)
    } catch (err) {
      await renderLog(ns, (log) => log.text(`ERROR crawl #${crawlNum}: ${String(err)}`))
    }

    await ns.sleep(crawlIntervalMs)
  }
}
