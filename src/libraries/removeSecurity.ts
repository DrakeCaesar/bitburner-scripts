import { NS } from "@ns"
import { crawl, isHackableNetworkServer } from "./crawl.js"
import { ScriptLogBuilder, type ReactTableConfig, type TableLayout } from "./scriptLogUi.js"

export const WEAKEN_SCRIPT = "/hacking/weaken.js"

const SECURITY_EPSILON = 0.001

/** Servers we never try to weaken (special / non-target hosts). */
const EXCLUDED_HOSTS = new Set([
  ".",
  "avmnite-02h",
  "CSEC",
  "darkweb",
  "home",
  "I.I.I.I",
  "run4theh111z",
  "w0r1d_d43m0n",
  "The-Cave",
])

export const REMOVE_SECURITY_LAYOUT: Partial<TableLayout> = {
  tableWidthPx: 720,
  fontSizePx: 12,
}

const TABLE_COLUMNS = [
  { header: "Server", align: "left" as const },
  { header: "Hack", align: "right" as const },
  { header: "Min", align: "right" as const },
  { header: "Now", align: "right" as const },
  { header: "+Sec", align: "right" as const },
  { header: "Status", align: "left" as const },
  { header: "Detail", align: "left" as const },
]

const COL_WIDTHS = [132, 40, 48, 48, 48, 72, 108]

export interface RunningWeaken {
  host: string
  threads: number
}

export interface ServerSecurityRow {
  hostname: string
  hackLevel: number
  minSecurity: number
  currentSecurity: number
  securityGap: number
  running: RunningWeaken | null
}

export interface RemoveSecurityState {
  execHost: string
  execFreeRam: number
  weakenRamPerThread: number
  atMinimum: ServerSecurityRow[]
  runningWeaken: ServerSecurityRow[]
  pending: ServerSecurityRow[]
  skippedCount: number
}

export function isRemoveSecurityTarget(hostname: string, playerHackLevel: number, ns: NS): boolean {
  if (!isHackableNetworkServer(hostname)) return false
  if (EXCLUDED_HOSTS.has(hostname)) return false
  if (hostname.includes("node")) return false
  return ns.getServerRequiredHackingLevel(hostname) <= playerHackLevel
}

export function isAtMinSecurity(current: number, min: number): boolean {
  return current <= min + SECURITY_EPSILON
}

export function findRunningWeaken(ns: NS, hosts: Iterable<string>, target: string): RunningWeaken | null {
  for (const host of hosts) {
    if (!ns.hasRootAccess(host)) continue
    for (const proc of ns.ps(host)) {
      if (!proc.filename.endsWith("weaken.js")) continue
      if (String(proc.args[0]) !== target) continue
      return { host, threads: proc.threads }
    }
  }
  return null
}

export function calcWeakenThreads(ns: NS, execHost: string, securityGap: number): number {
  if (securityGap <= SECURITY_EPSILON) return 0
  const weakenRam = ns.getScriptRam(WEAKEN_SCRIPT)
  const freeRam = ns.getServerMaxRam(execHost) - ns.getServerUsedRam(execHost)
  const threadsForGap = Math.ceil(securityGap / 0.05)
  const threadsForRam = Math.floor(freeRam / weakenRam)
  return Math.min(threadsForGap, threadsForRam)
}

export function canLaunchWeaken(securityGap: number): boolean {
  return securityGap > SECURITY_EPSILON
}

export function collectRemoveSecurityState(ns: NS, execHost: string, knownHosts: Set<string>): RemoveSecurityState {
  const playerHackLevel = ns.getPlayer().skills.hacking
  const weakenRamPerThread = ns.getScriptRam(WEAKEN_SCRIPT)
  const scanHosts = new Set(knownHosts)
  scanHosts.add(execHost)

  const atMinimum: ServerSecurityRow[] = []
  const runningWeaken: ServerSecurityRow[] = []
  const pending: ServerSecurityRow[] = []
  let skippedCount = 0

  for (const hostname of knownHosts) {
    if (!isRemoveSecurityTarget(hostname, playerHackLevel, ns)) {
      skippedCount++
      continue
    }

    const minSecurity = ns.getServerMinSecurityLevel(hostname)
    const currentSecurity = ns.getServerSecurityLevel(hostname)
    const securityGap = currentSecurity - minSecurity
    const row: ServerSecurityRow = {
      hostname,
      hackLevel: ns.getServerRequiredHackingLevel(hostname),
      minSecurity,
      currentSecurity,
      securityGap,
      running: findRunningWeaken(ns, scanHosts, hostname),
    }

    if (isAtMinSecurity(currentSecurity, minSecurity)) {
      atMinimum.push(row)
    } else if (row.running) {
      runningWeaken.push(row)
    } else {
      pending.push(row)
    }
  }

  const byHackLevel = (a: ServerSecurityRow, b: ServerSecurityRow) => a.hackLevel - b.hackLevel
  atMinimum.sort(byHackLevel)
  runningWeaken.sort(byHackLevel)
  pending.sort(byHackLevel)

  return {
    execHost,
    execFreeRam: ns.getServerMaxRam(execHost) - ns.getServerUsedRam(execHost),
    weakenRamPerThread,
    atMinimum,
    runningWeaken,
    pending,
    skippedCount,
  }
}

type RowStatus = "min" | "running" | "pending"

function pendingDetail(ns: NS, state: RemoveSecurityState, row: ServerSecurityRow): string {
  if (!ns.hasRootAccess(row.hostname)) return "no root"
  const threads = calcWeakenThreads(ns, state.execHost, row.securityGap)
  if (threads <= 0) return "no RAM on exec"
  return `need ${threads}t`
}

function rowStatus(row: ServerSecurityRow): RowStatus {
  if (row.running) return "running"
  if (row.securityGap <= SECURITY_EPSILON) return "min"
  return "pending"
}

function rowDetail(ns: NS, state: RemoveSecurityState, row: ServerSecurityRow, status: RowStatus): string {
  if (status === "min") return ""
  if (status === "running") return `${row.running!.host} x${row.running!.threads}`
  return pendingDetail(ns, state, row)
}

function buildAllServerRows(ns: NS, state: RemoveSecurityState): string[][] {
  const all = [...state.pending, ...state.runningWeaken, ...state.atMinimum]
  all.sort((a, b) => a.hackLevel - b.hackLevel || a.hostname.localeCompare(b.hostname))

  return all.map((row) => {
    const status = rowStatus(row)
    return [
      row.hostname,
      String(row.hackLevel),
      row.minSecurity.toFixed(2),
      row.currentSecurity.toFixed(2),
      row.securityGap.toFixed(2),
      status,
      rowDetail(ns, state, row, status),
    ]
  })
}

export function buildRemoveSecurityLog(ns: NS, state: RemoveSecurityState): ScriptLogBuilder {
  const log = new ScriptLogBuilder(REMOVE_SECURITY_LAYOUT)

  log.text(
    `Exec: ${state.execHost}  |  free RAM: ${ns.format.ram(state.execFreeRam)}  |  ` +
      `${WEAKEN_SCRIPT}: ${ns.format.ram(state.weakenRamPerThread)}/thread  |  ` +
      `min ${state.atMinimum.length}  running ${state.runningWeaken.length}  pending ${state.pending.length}` +
      (state.skippedCount > 0 ? `  |  skipped ${state.skippedCount}` : "")
  )

  const rows = buildAllServerRows(ns, state)
  if (rows.length > 0) {
    log.table({
      layout: REMOVE_SECURITY_LAYOUT,
      tableWidth: REMOVE_SECURITY_LAYOUT.tableWidthPx,
      columnWidths: COL_WIDTHS,
      columns: TABLE_COLUMNS,
      rows,
    })
  } else {
    log.text("(no targets)")
  }

  return log
}

export function launchPendingWeakenJobs(ns: NS, execHost: string, state: RemoveSecurityState): number {
  const scanHosts = new Set<string>()
  for (const row of [...state.atMinimum, ...state.runningWeaken, ...state.pending]) {
    scanHosts.add(row.hostname)
  }
  scanHosts.add(execHost)

  let started = 0
  for (const row of state.pending) {
    if (!ns.hasRootAccess(row.hostname)) continue
    if (!canLaunchWeaken(row.securityGap)) continue
    if (findRunningWeaken(ns, scanHosts, row.hostname)) continue

    const threads = calcWeakenThreads(ns, execHost, row.securityGap)
    if (threads <= 0) continue

    if (ns.exec(WEAKEN_SCRIPT, execHost, threads, row.hostname)) {
      started++
    }
  }
  return started
}

export function refreshKnownHosts(ns: NS, knownHosts: Set<string>): void {
  crawl(ns, knownHosts)
}
