import { NS } from "@ns"
import { MAX_PROBE_DEPTH, runDarknetCrawl, type DarknetCrawlApi } from "./darknetCrawl.js"
import { ScriptLogBuilder, initScriptLogTail, type TableLayout } from "./libraries/scriptLogUi.js"

// --- config ---

const DARKSCAPE_NAV = "DarkscapeNavigator.exe"

const DARKWEB_STATS_LAYOUT: Partial<TableLayout> = {
  fontSizePx: 12,
  tableWidthPx: 960,
}

// --- types ---

type DarknetPasswordFormat = "numeric" | "alphabetic" | "alphanumeric" | "ASCII" | "unicode"

interface DarknetServerDetails {
  blockedRam: number
  data: string
  depth: number
  difficulty: number
  hasSession: boolean
  isOnline: boolean
  isStationary: boolean
  logTrafficInterval: number
  modelId: string
  passwordFormat: DarknetPasswordFormat
  passwordHint: string
  passwordLength: number
  requiredCharismaSkill: number
}

interface DarknetApi extends DarknetCrawlApi {
  getServerDetails(host?: string): DarknetServerDetails
}

// --- ui ---

const TABLE_COLUMNS = [
  { header: "Host", align: "left" as const, minWidth: 22 },
  { header: "On", align: "center" as const, minWidth: 3 },
  { header: "Depth", align: "right" as const, minWidth: 5 },
  { header: "Diff", align: "right" as const, minWidth: 4 },
  { header: "Model", align: "left" as const, minWidth: 10 },
  { header: "Cha", align: "right" as const, minWidth: 4 },
  { header: "Fmt", align: "left" as const, minWidth: 8 },
  { header: "Len", align: "right" as const, minWidth: 3 },
  { header: "RAM", align: "right" as const, minWidth: 8 },
  { header: "Ses", align: "center" as const, minWidth: 3 },
  { header: "Hint", align: "left" as const, minWidth: 28 },
]

function truncate(text: string, maxLen: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim()
  if (trimmed.length <= maxLen) return trimmed
  return `${trimmed.slice(0, maxLen - 3)}...`
}

function getDarknetApi(ns: NS): DarknetApi | null {
  return (ns as NS & { dnet?: DarknetApi }).dnet ?? null
}

async function renderLog(ns: NS, build: (log: ScriptLogBuilder) => void): Promise<void> {
  const log = new ScriptLogBuilder(DARKWEB_STATS_LAYOUT)
  build(log)
  await log.render(ns)
}

// --- entry ---

export async function main(ns: NS): Promise<void> {
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

  let reports
  try {
    reports = await runDarknetCrawl(ns, dnet, MAX_PROBE_DEPTH)
  } catch (err) {
    await renderLog(ns, (log) => log.text(`ERROR: ${String(err)}`))
    return
  }

  const hosts = [...reports.keys()].sort((a, b) => {
    const depthA = dnet.getServerDetails(a).depth
    const depthB = dnet.getServerDetails(b).depth
    return depthA - depthB || a.localeCompare(b)
  })

  const authSucceeded = [...reports.values()].filter((r) => r.authenticated === true).length
  const authFailed = [...reports.values()].filter((r) => r.authenticated === false).length
  const authSkipped = [...reports.values()].filter((r) => r.authenticated === null).length

  await renderLog(ns, (log) => {
    log.text(
      `Discovered ${hosts.length} host(s) (recursive crawl depth ${MAX_PROBE_DEPTH}) | ` +
        `auth ok ${authSucceeded}, failed ${authFailed}, skipped ${authSkipped}`
    )
    log.table({
      layout: DARKWEB_STATS_LAYOUT,
      title: "Darknet crawl",
      columns: TABLE_COLUMNS,
      rows: hosts.map((hostname) => {
        const details = dnet.getServerDetails(hostname)
        const server = ns.getServer(hostname)
        return [
          hostname,
          details.isOnline ? "Y" : "N",
          String(details.depth),
          String(details.difficulty),
          details.modelId || "-",
          String(details.requiredCharismaSkill),
          details.passwordFormat || "-",
          String(details.passwordLength),
          ns.format.ram(server.maxRam, 0),
          details.hasSession ? "Y" : "",
          truncate(details.passwordHint || details.data || "-", 32),
        ]
      }),
    })
  })
}
