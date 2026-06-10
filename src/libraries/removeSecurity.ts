import { NS } from "@ns"
import { crawl, isHackableNetworkServer } from "./crawl.js"
import { ScriptLogBuilder, type ReactTableConfig } from "./scriptLogUi.js"
import { TAIL_LAYOUT } from "./scriptLogUiLayout.js"

export const WEAKEN_SCRIPT = "/hacking/weaken.js"

/** Keep this much RAM free on home for other scripts (batch, hacknet, etc.). */
export const HOME_RAM_RESERVE_GB = 100

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

const TABLE_COLUMNS = [
  { header: "Server", align: "left" as const },
  { header: "Hack", align: "right" as const },
  { header: "Min", align: "right" as const },
  { header: "Now", align: "right" as const },
  { header: "+Sec", align: "right" as const },
  { header: "Status", align: "left" as const },
  { header: "Ends In", align: "right" as const },
  { header: "Detail", align: "left" as const },
]

export interface RunningWeaken {
  host: string
  threads: number
  /** Milliseconds until the current weaken.js run finishes (from process runtime). */
  remainingMs: number
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
  execAllocatableRam: number
  homeRamReserveGb: number
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

function estimateWeakenRemainingMs(ns: NS, proc: { pid: number; args: unknown[] }, target: string): number {
  const weakenMs = ns.getWeakenTime(target)
  const delayArg = proc.args[1]
  const delayMs = delayArg != null && delayArg !== "" ? Number(delayArg) : 0
  const totalMs = weakenMs + (Number.isFinite(delayMs) ? delayMs : 0)

  const running = ns.getRunningScript(proc.pid)
  if (running) {
    const elapsedMs = running.onlineRunningTime * 1000
    return Math.max(0, totalMs - elapsedMs)
  }

  return totalMs
}

export function findRunningWeaken(ns: NS, hosts: Iterable<string>, target: string): RunningWeaken | null {
  for (const host of hosts) {
    if (!ns.hasRootAccess(host)) continue
    for (const proc of ns.ps(host)) {
      if (!proc.filename.endsWith("weaken.js")) continue
      if (String(proc.args[0]) !== target) continue
      return {
        host,
        threads: proc.threads,
        remainingMs: estimateWeakenRemainingMs(ns, proc, target),
      }
    }
  }
  return null
}

export function getExecAllocatableRam(ns: NS, execHost: string): number {
  const freeRam = ns.getServerMaxRam(execHost) - ns.getServerUsedRam(execHost)
  if (execHost !== "home") {
    return freeRam
  }
  return Math.max(0, freeRam - HOME_RAM_RESERVE_GB)
}

export function calcWeakenThreads(ns: NS, execHost: string, securityGap: number): number {
  if (securityGap <= SECURITY_EPSILON) return 0
  const weakenRam = ns.getScriptRam(WEAKEN_SCRIPT)
  const freeRam = getExecAllocatableRam(ns, execHost)
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
    execAllocatableRam: getExecAllocatableRam(ns, execHost),
    homeRamReserveGb: execHost === "home" ? HOME_RAM_RESERVE_GB : 0,
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

function rowEndsIn(ns: NS, row: ServerSecurityRow, status: RowStatus): string {
  if (status !== "running" || !row.running) return ""
  const ms = row.running.remainingMs
  if (!Number.isFinite(ms) || ms <= 0) return "done"
  return ns.format.time(ms)
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
      rowEndsIn(ns, row, status),
      rowDetail(ns, state, row, status),
    ]
  })
}

export function buildRemoveSecurityLog(ns: NS, state: RemoveSecurityState): ScriptLogBuilder {
  const log = new ScriptLogBuilder(TAIL_LAYOUT)

  log.text(
    `Exec: ${state.execHost}  |  free RAM: ${ns.format.ram(state.execFreeRam)}` +
      (state.homeRamReserveGb > 0
        ? `  |  allocatable: ${ns.format.ram(state.execAllocatableRam)} (${state.homeRamReserveGb}GB reserved)`
        : "") +
      `  |  ${WEAKEN_SCRIPT}: ${ns.format.ram(state.weakenRamPerThread)}/thread  |  ` +
      `min ${state.atMinimum.length}  running ${state.runningWeaken.length}  pending ${state.pending.length}` +
      (state.skippedCount > 0 ? `  |  skipped ${state.skippedCount}` : "")
  )

  const rows = buildAllServerRows(ns, state)
  if (rows.length > 0) {
    log.table({
      layout: TAIL_LAYOUT,
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
