import { NS } from "@ns"
import {
  MAX_PROBE_DEPTH,
  formatCrawlOpShort,
  runDarknetCrawl,
  type CrawlHostReport,
  type CrawlProgressState,
  type CrawlStatusReport,
  type DarknetCrawlApi,
  type DarknetServerDetailsForFormulas,
} from "./darknetCrawl.js"
import {
  ScriptLogBuilder,
  initScriptLogTail,
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
let actColumnMaxChars = ACT_COLUMN_MIN_CHARS

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
  bumpActColumnMax(rows)
  log.treeTable({
    layout: DARKWEB_STATS_LAYOUT,
    title,
    rootIds: reports.has("darkweb") ? ["darkweb"] : undefined,
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

async function renderCrawlProgress(ns: NS, dnet: DarknetApi, state: CrawlProgressState): Promise<void> {
  const auth = countAuthStats(state.reports)
  const status = state.workerRunning ? "running" : "done"
  const activeCount = state.activeOps.length

  await renderLog(ns, (log) => {
    log.text(
      `Crawl ${status} | ${state.reports.size} host(s) | auth ok ${auth.ok}, failed ${auth.failed}, skipped ${auth.skipped}` +
        (activeCount > 0 ? ` | active ${activeCount}` : "")
    )
    appendDarknetTreeTable(log, ns, dnet, state.reports, state.activeOps, "Darknet crawl")
  })
}

async function renderLog(ns: NS, build: (log: ScriptLogBuilder) => void): Promise<void> {
  const log = new ScriptLogBuilder(DARKWEB_STATS_LAYOUT)
  build(log)
  await log.render(ns)
}

// --- entry ---

export async function main(ns: NS): Promise<void> {
  actColumnMaxChars = ACT_COLUMN_MIN_CHARS
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

  let reports: Map<string, CrawlHostReport>
  try {
    reports = await runDarknetCrawl(ns, dnet, MAX_PROBE_DEPTH, async (state) => {
      await renderCrawlProgress(ns, dnet, state)
    })
  } catch (err) {
    await renderLog(ns, (log) => log.text(`ERROR: ${String(err)}`))
    return
  }

  const auth = countAuthStats(reports)

  await renderLog(ns, (log) => {
    log.text(
      `Discovered ${reports.size} host(s) (recursive crawl depth ${MAX_PROBE_DEPTH}) | ` +
        `auth ok ${auth.ok}, failed ${auth.failed}, skipped ${auth.skipped}`
    )
    appendDarknetTreeTable(log, ns, dnet, reports, [], "Darknet crawl")
  })
}
