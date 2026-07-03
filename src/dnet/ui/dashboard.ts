import { NS } from "@ns"
import {
  col,
  createTabbedTailLog,
  renderTabbedTailLog,
  type TabbedScriptLogBuilder,
} from "@/libraries/scriptLogUiLayout.js"
import { MUTATION_PORT } from "../constants.js"
import { renderLabyrinthOverview } from "./labyrinthMap.js"
import { shouldLogMasterAction } from "../history/attemptLogFilters.js"
import type {
  AttemptRecord,
  AuthTarget,
  CrawlSnapshot,
  DeadlineTimelineEvent,
  FailedAuthSession,
  FailedCommandDeadline,
  CommandDeadlineSlipStats,
  MasterActionRecord,
  MutationPortSnapshot,
  SessionEvent,
  StasisSnapshot,
  WorkerSnapshot,
} from "../types.js"

const TIMELINE_DISPLAY_LIMIT = 80
const TIMELINE_INDEX_LIMIT = 300
const FAILED_EVENT_DISPLAY_LIMIT = 120
const TIMEOUT_EVENT_DISPLAY_LIMIT = 120

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "targets", label: "Targets" },
  { id: "attempts", label: "Attempts" },
  { id: "workers", label: "Workers" },
  { id: "failed", label: "Failed" },
  { id: "timeouts", label: "Timeouts" },
] as const

const TARGET_COLUMNS = [
  col("Host", "left"),
  col("Model", "left"),
  col("Status", "left"),
  col("Session", "right"),
  col("Guesses", "right"),
  col("Solver", "left"),
  col("Worker", "left"),
  col("Password", "left"),
]

const ATTEMPT_COLUMNS = [
  col("Id", "right"),
  col("Start", "right"),
  col("End", "right"),
  col("Dur", "right"),
  col("Host", "left"),
  col("Target", "left"),
  col("Sess", "right"),
  col("Kind", "left"),
  col("Guess", "left"),
  col("OK", "center"),
  col("Detail", "left"),
  col("Feedback", "left"),
]

const WORKER_COLUMNS = [
  col("Host", "left"),
  col("Depth", "right"),
  col("Port", "right"),
  col("Idle", "center"),
  col("Cmd", "left"),
  col("Reply", "left"),
  col("Ngbrs", "right"),
  col("RAM", "right"),
]

const FAILED_LIST_COLUMNS = [
  col("Host", "left"),
  col("Sess", "right"),
  col("Solver", "left"),
  col("Guesses", "right"),
  col("Reason", "left"),
  col("Ended", "right"),
]

const FAILED_EVENT_COLUMNS = [
  col("Time", "right"),
  col("Kind", "left"),
  col("Guess", "left"),
  col("OK", "center"),
  col("Feedback", "left"),
  col("Detail", "left"),
]

const TIMEOUT_LIST_COLUMNS = [
  col("Worker", "left"),
  col("Cmd", "left"),
  col("Target", "left"),
  col("Actual", "right"),
  col("Est", "right"),
  col("Slip", "right"),
  col("Ended", "right"),
]

const TIMEOUT_EVENT_COLUMNS = [
  col("Time", "right"),
  col("Kind", "left"),
  col("Deadline", "right"),
  col("Est", "right"),
  col("Real", "right"),
  col("Note", "left"),
]

const TIMEOUT_ACTION_COLUMNS = [
  col("Time", "right"),
  col("Action", "left"),
  col("Detail", "left"),
]

const TIMEOUT_STATS_COLUMNS = [
  col("Cmd", "left"),
  col("N", "right"),
  col("Min", "right"),
  col("Avg", "right"),
  col("Max", "right"),
]

function tableKey(tab: string, name: string): string {
  return `dnet:${tab}:${name}`
}

function dashCell(s: string | undefined | null): string {
  return s && s.length > 0 ? s : "-"
}


export class DnetDashboard {
  readonly log: TabbedScriptLogBuilder
  selectedFailedSessionId: string | null = null
  private pendingFailedRow = -1
  private lastFailedCount = 0
  selectedTimeoutId: string | null = null
  private pendingTimeoutRow = -1
  private lastTimeoutCount = 0

  constructor() {
    this.log = createTabbedTailLog([...TABS], undefined, { lazyInactivePanels: true })
  }

  onFailedRowClick(rowIndex: number): void {
    this.pendingFailedRow = rowIndex
  }

  onTimeoutRowClick(rowIndex: number): void {
    this.pendingTimeoutRow = rowIndex
  }

  applyFailedSelection(failed: readonly FailedAuthSession[]): void {
    if (this.pendingFailedRow >= 0 && this.pendingFailedRow < failed.length) {
      this.selectedFailedSessionId = failed[this.pendingFailedRow]!.id
      this.pendingFailedRow = -1
    }

    const ids = new Set(failed.map((s) => s.id))
    if (this.selectedFailedSessionId != null && !ids.has(this.selectedFailedSessionId)) {
      this.selectedFailedSessionId = null
    }

    if (failed.length > this.lastFailedCount && failed.length > 0) {
      this.selectedFailedSessionId = failed[0]!.id
    }
    this.lastFailedCount = failed.length
  }

  applyTimeoutSelection(timeouts: readonly FailedCommandDeadline[]): void {
    if (this.pendingTimeoutRow >= 0 && this.pendingTimeoutRow < timeouts.length) {
      this.selectedTimeoutId = timeouts[this.pendingTimeoutRow]!.id
      this.pendingTimeoutRow = -1
    }

    const ids = new Set(timeouts.map((s) => s.id))
    if (this.selectedTimeoutId != null && !ids.has(this.selectedTimeoutId)) {
      this.selectedTimeoutId = null
    }

    if (timeouts.length > this.lastTimeoutCount && timeouts.length > 0) {
      this.selectedTimeoutId = timeouts[0]!.id
    }
    this.lastTimeoutCount = timeouts.length
  }
}

export function createDashboard(): DnetDashboard {
  return new DnetDashboard()
}

function formatMutationLine(m: MutationPortSnapshot): string {
  const portTime = m.portTs != null ? clock(m.portTs) : "-"
  return (
    `mutation port ${MUTATION_PORT}  peek=${m.portRaw}  ts=${m.portTs ?? "-"} (${portTime})  ` +
    `acked=${m.acked}  stale=${m.stale ? "Y" : "N"}  loop ${clock(m.loopAt)}`
  )
}

function renderStasisOverview(
  tab: ReturnType<TabbedScriptLogBuilder["tab"]>,
  stasis: StasisSnapshot | null,
): void {
  if (stasis == null) {
    tab.text("stasis tokens  unavailable (ns.dnet stasis API missing)")
    return
  }

  tab.keyValueTable({
    title: "Stasis tokens",
    rows: [
      { label: "Limit", value: String(stasis.limit) },
      { label: "Used", value: String(stasis.used) },
      { label: "Available", value: String(stasis.available) },
      {
        label: "Linked hosts",
        value: stasis.linkedHosts.length > 0 ? stasis.linkedHosts.join(", ") : "(none)",
      },
    ],
  })
}

function clock(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

interface OpTiming {
  startAt: number
  endAt: number | null
  ongoing: boolean
}

type TimelineEntry =
  | { source: "attempt"; at: number; record: AttemptRecord }
  | { source: "action"; at: number; record: MasterActionRecord }

function buildTimeline(
  attempts: readonly AttemptRecord[],
  actions: readonly MasterActionRecord[],
): TimelineEntry[] {
  const rows: TimelineEntry[] = [
    ...attempts.map((record) => ({ source: "attempt" as const, at: record.at, record })),
    ...actions
      .filter((record) => shouldLogMasterAction(record.action))
      .map((record) => ({ source: "action" as const, at: record.at, record })),
  ]
  rows.sort((a, b) => a.at - b.at || timelineSortKey(a) - timelineSortKey(b))
  return rows
}

function timelineSortKey(entry: TimelineEntry): number {
  return entry.source === "attempt" ? entry.record.id : entry.record.id + 1_000_000
}

function indexAttemptTimings(attempts: readonly AttemptRecord[]): Map<number, OpTiming> {
  const timings = new Map<number, OpTiming>()
  const sessionOpen = new Map<string, { startId: number; startAt: number }>()
  const guessOpen = new Map<string, { dispatchId: number; startAt: number }>()

  for (const a of attempts) {
    const sk = `${a.host}#${a.session}`

    if (a.kind === "session_start") {
      sessionOpen.set(sk, { startId: a.id, startAt: a.at })
      timings.set(a.id, { startAt: a.at, endAt: null, ongoing: true })
      continue
    }

    if (a.kind === "session_end") {
      const open = sessionOpen.get(sk)
      if (open) {
        timings.set(open.startId, { startAt: open.startAt, endAt: a.at, ongoing: false })
        sessionOpen.delete(sk)
      }
      timings.set(a.id, { startAt: open?.startAt ?? a.at, endAt: a.at, ongoing: false })
      continue
    }

    if (a.kind === "guess_dispatch" && a.guess != null) {
      const gk = `${sk}#${a.guess}`
      guessOpen.set(gk, { dispatchId: a.id, startAt: a.at })
      timings.set(a.id, { startAt: a.at, endAt: null, ongoing: true })
      continue
    }

    if (a.kind === "guess_result" && a.guess != null) {
      const gk = `${sk}#${a.guess}`
      const open = guessOpen.get(gk)
      if (open) {
        timings.set(open.dispatchId, { startAt: open.startAt, endAt: a.at, ongoing: false })
        guessOpen.delete(gk)
      }
      timings.set(a.id, { startAt: open?.startAt ?? a.at, endAt: a.at, ongoing: false })
      continue
    }

    timings.set(a.id, { startAt: a.at, endAt: a.at, ongoing: false })
  }

  return timings
}

function formatDuration(ms: number): string {
  const sign = ms < 0 ? "-" : ""
  const abs = Math.abs(ms)
  if (abs < 1000) return `${sign}${abs}ms`
  const totalSec = Math.floor(abs / 1000)
  if (totalSec < 60) return `${sign}${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min < 60) return sec > 0 ? `${sign}${min}m${sec}s` : `${sign}${min}m`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return remMin > 0 ? `${sign}${hr}h${remMin}m` : `${sign}${hr}h`
}

function formatTiming(t: OpTiming, now: number): { start: string; end: string; dur: string } {
  const start = clock(t.startAt)
  if (t.ongoing || t.endAt == null) {
    return { start, end: "...", dur: `${formatDuration(now - t.startAt)}+` }
  }
  const end = clock(t.endAt)
  const dur = formatDuration(Math.max(0, t.endAt - t.startAt))
  return { start, end, dur: t.endAt === t.startAt ? "-" : dur }
}

function formatActivityTarget(actorHost: string, remoteHost: string | undefined): string {
  if (!remoteHost || remoteHost === actorHost || actorHost === "-") return "-"
  return remoteHost
}

function attemptTargetColumn(a: AttemptRecord): string {
  return formatActivityTarget(a.host, a.workerHost)
}

/** Parse master action detail (`worker -> target ...`) into actor and remote host. */
function parseCommandHosts(action: string, detail: string | undefined): { actor: string; remote: string } {
  if (!detail) return { actor: "-", remote: "-" }
  const sep = " -> "
  const arrow = detail.indexOf(sep)
  if (arrow < 0) return { actor: detail, remote: "-" }

  const actor = detail.slice(0, arrow)
  const rest = detail.slice(arrow + sep.length)

  switch (action) {
    case "spawn": {
      const portIdx = rest.indexOf(" port ")
      return { actor, remote: portIdx >= 0 ? rest.slice(0, portIdx) : rest }
    }
    case "realloc": {
      const priIdx = rest.lastIndexOf(" p")
      return { actor, remote: priIdx >= 0 ? rest.slice(0, priIdx) : rest.split(" ")[0] ?? rest }
    }
    case "auth": {
      const guessIdx = rest.indexOf(" ")
      return { actor, remote: guessIdx >= 0 ? rest.slice(0, guessIdx) : rest }
    }
    case "heartbleed":
      return { actor, remote: rest }
    case "labreport":
      return { actor, remote: rest }
    case "labradar":
      return { actor, remote: rest }
    default:
      return { actor, remote: rest }
  }
}

export async function renderDashboard(
  ns: NS,
  dashboard: DnetDashboard,
  snap: CrawlSnapshot,
): Promise<void> {
  const log = dashboard.log
  const activeTab = log.getActiveTabId()

  log.clearPanels()

  switch (activeTab) {
    case "overview":
      populateOverviewTab(log, snap)
      break
    case "targets":
      populateTargetsTab(log, snap)
      break
    case "attempts":
      populateAttemptsTab(log, snap)
      break
    case "workers":
      populateWorkersTab(log, snap)
      break
    case "failed":
      populateFailedTab(log, dashboard, snap)
      break
    case "timeouts":
      populateTimeoutsTab(log, dashboard, snap)
      break
    default:
      populateOverviewTab(log, snap)
      break
  }

  await renderTabbedTailLog(ns, log)
}

function populateOverviewTab(log: TabbedScriptLogBuilder, snap: CrawlSnapshot): void {
  const s = snap.summary
  const failed = snap.failedSessions
  const timeouts = snap.failedDeadlines
  log
    .tab("overview")
    .text(
      `dnet  session ${snap.sessionId}  ` +
        `targets ${snap.targets.length}  active ${s.active}  solved ${s.solved}  ` +
        `exhausted ${s.exhausted}  retry ${s.retryWait}  no_solver ${s.noSolver}  ` +
        `unsupported ${s.unsupported}  attempts ${snap.attempts.length}  workers ${snap.workers.length}  ` +
        `failed ${failed.length}  timeouts ${timeouts.length}`,
    )

  renderStasisOverview(log.tab("overview"), snap.stasis)
  renderLabyrinthOverview(log.tab("overview"), snap.labyrinths, {
    stasisLinked: snap.stasis?.linkedHosts ?? [],
    workers: snap.workers,
  })
}

function populateTargetsTab(log: TabbedScriptLogBuilder, snap: CrawlSnapshot): void {
  const sortedTargets = [...snap.targets].sort((a, b) => a.host.localeCompare(b.host))
  log.tab("targets").table({
    title: "Auth targets",
    widthKey: tableKey("targets", "auth-targets"),
    columns: TARGET_COLUMNS,
    rows: sortedTargets.map(targetRow),
  })
}

function populateAttemptsTab(log: TabbedScriptLogBuilder, snap: CrawlSnapshot): void {
  const recentAttempts = snap.attempts.slice(-TIMELINE_INDEX_LIMIT)
  const timeline = buildTimeline(recentAttempts, snap.actions)
  const attemptTimings = indexAttemptTimings(recentAttempts)
  const recentTimeline = timeline.slice(-TIMELINE_DISPLAY_LIMIT).reverse()
  log
    .tab("attempts")
    .text(formatMutationLine(snap.mutation))
    .table({
      title: `Activity log (newest first, ${recentTimeline.length} of ${timeline.length})`,
      widthKey: tableKey("attempts", "timeline"),
      columns: ATTEMPT_COLUMNS,
      rows: recentTimeline.map((entry) => timelineRow(entry, attemptTimings)),
    })
}

function populateWorkersTab(log: TabbedScriptLogBuilder, snap: CrawlSnapshot): void {
  log.tab("workers").table({
    title: "Workers",
    widthKey: tableKey("workers", "list"),
    columns: WORKER_COLUMNS,
    rows: snap.workers.map(workerRow),
  })
}

function populateFailedTab(
  log: TabbedScriptLogBuilder,
  dashboard: DnetDashboard,
  snap: CrawlSnapshot,
): void {
  const failed = snap.failedSessions
  dashboard.applyFailedSelection(failed)
  const selected =
    failed.find((f) => f.id === dashboard.selectedFailedSessionId) ?? null
  const selectedRowIndex =
    selected != null ? failed.findIndex((f) => f.id === selected.id) : undefined
  renderFailedTab(log, dashboard, failed, selected, selectedRowIndex)
}

function renderFailedTab(
  log: TabbedScriptLogBuilder,
  dashboard: DnetDashboard,
  failed: readonly FailedAuthSession[],
  selected: FailedAuthSession | null,
  selectedRowIndex: number | undefined,
): void {
  const tab = log.tab("failed")
  tab.text(
    failed.length === 0
      ? "No failed auth sessions archived yet."
      : `Failed auth sessions (${failed.length}). Click a row to inspect one session.`,
  )

  if (failed.length === 0) return

  tab.table({
    title: "Archived sessions (newest first)",
    widthKey: tableKey("failed", "sessions"),
    columns: FAILED_LIST_COLUMNS,
    rows: failed.map(failedSessionRow),
    selectedRowIndex: selectedRowIndex != null && selectedRowIndex >= 0 ? selectedRowIndex : undefined,
    onRowClick: (rowIndex) => dashboard.onFailedRowClick(rowIndex),
  })

  if (!selected) {
    tab.text("No session selected.")
    return
  }

  tab.text(
    `Session ${selected.host} #${selected.session}  solver ${selected.solverId}  ` +
      `reason ${selected.reason}  started ${clock(selected.startedAt)}  ended ${clock(selected.archivedAt)}`,
  )

  const a = selected.assignment
  tab.keyValueTable({
    title: "Assignment",
    widthKey: tableKey("failed", "assignment"),
    rows: [
      { label: "Host", value: a.host },
      { label: "Model", value: a.modelId },
      { label: "Format", value: a.format },
      { label: "Length", value: String(a.passwordLength) },
      { label: "Hint", value: dashCell(a.passwordHint) },
      { label: "Data", value: dashCell(a.data) },
      { label: "Depth", value: String(a.depth) },
      { label: "Difficulty", value: String(a.difficulty) },
      { label: "Charisma", value: String(a.requiredCharismaSkill) },
    ],
  })

  const events =
    selected.events.length > FAILED_EVENT_DISPLAY_LIMIT
      ? selected.events.slice(-FAILED_EVENT_DISPLAY_LIMIT)
      : selected.events
  tab.table({
    title: `Session log (${events.length} of ${selected.events.length} events, newest)`,
    widthKey: tableKey("failed", "events"),
    columns: FAILED_EVENT_COLUMNS,
    rows: events.map(failedEventRow),
  })

  for (const event of events) {
    if (event.kind !== "heartbleed" || !event.heartbleedLogs?.length) continue
    tab.section(`Heartbleed ${clock(event.at)}`)
    for (const line of event.heartbleedLogs) {
      tab.text(line)
    }
  }
}

function failedSessionRow(s: FailedAuthSession): string[] {
  const guesses = s.events.filter((e) => e.kind === "guess_result").length
  return [
    s.host,
    String(s.session),
    s.solverId,
    String(guesses),
    s.reason,
    clock(s.archivedAt),
  ]
}

function failedEventRow(e: SessionEvent): string[] {
  return [
    clock(e.at),
    e.kind,
    dashCell(e.guess),
    e.success === true ? "Y" : e.success === false ? "N" : "-",
    dashCell(e.feedback ?? e.message),
    dashCell(e.detail ?? e.note),
  ]
}

function populateTimeoutsTab(
  log: TabbedScriptLogBuilder,
  dashboard: DnetDashboard,
  snap: CrawlSnapshot,
): void {
  const timeouts = snap.failedDeadlines
  const slipStats = snap.deadlineSlipStats
  const completedCount = snap.completedCommandCount
  dashboard.applyTimeoutSelection(timeouts)
  const selected = timeouts.find((t) => t.id === dashboard.selectedTimeoutId) ?? null
  const selectedRowIndex =
    selected != null ? timeouts.findIndex((t) => t.id === selected.id) : undefined
  renderTimeoutsTab(log, dashboard, timeouts, slipStats, completedCount, selected, selectedRowIndex)
}

function renderTimeoutsTab(
  log: TabbedScriptLogBuilder,
  dashboard: DnetDashboard,
  timeouts: readonly FailedCommandDeadline[],
  slipStats: readonly CommandDeadlineSlipStats[],
  completedCount: number,
  selected: FailedCommandDeadline | null,
  selectedRowIndex: number | undefined,
): void {
  const tab = log.tab("timeouts")
  tab.text(
    timeouts.length === 0
      ? completedCount === 0
        ? "No command deadline data yet."
        : `No coordinator timeouts yet (${completedCount} completed commands tracked).`
      : `Command deadline timeouts (${timeouts.length}). Click a row to inspect estimated vs actual timing.`,
  )

  if (slipStats.length > 0) {
    tab.table({
      title: "Deadline slip by command (end - deadline, avg desc; negative = early)",
      widthKey: tableKey("timeouts", "slip-stats"),
      columns: TIMEOUT_STATS_COLUMNS,
      rows: slipStats.map(deadlineSlipStatsRow),
    })
  }

  if (timeouts.length === 0) return

  tab.table({
    title: "Archived timeouts (newest first)",
    widthKey: tableKey("timeouts", "list"),
    columns: TIMEOUT_LIST_COLUMNS,
    rows: timeouts.map(timeoutListRow),
    selectedRowIndex: selectedRowIndex != null && selectedRowIndex >= 0 ? selectedRowIndex : undefined,
    onRowClick: (rowIndex) => dashboard.onTimeoutRowClick(rowIndex),
  })

  if (!selected) {
    tab.text("No timeout selected.")
    return
  }

  tab.text(
    `${selected.workerHost}  ${selected.command}  ` +
      `dispatched ${clock(selected.dispatchedAt)}  failed ${clock(selected.failedAt)}  ` +
      `reason ${selected.reason}`,
  )

  tab.keyValueTable({
    title: "Timing summary",
    widthKey: tableKey("timeouts", "summary"),
    rows: [
      { label: "Worker", value: selected.workerHost },
      { label: "Command", value: selected.command },
      { label: "Target", value: selected.targetHost ?? "-" },
      { label: "Dispatched", value: clock(selected.dispatchedAt) },
      { label: "Failed", value: clock(selected.failedAt) },
      { label: "Initial deadline", value: clock(selected.initialDeadlineAt) },
      {
        label: "Worker deadline",
        value: selected.workerDeadlineAt != null ? clock(selected.workerDeadlineAt) : "(none)",
      },
      { label: "Final deadline", value: clock(selected.finalDeadlineAt) },
      { label: "Estimated", value: formatDuration(selected.estimatedMs) },
      { label: "Actual", value: formatDuration(selected.actualMs) },
      { label: "Slip", value: formatDuration(selected.slipMs) },
      { label: "Overdue (+grace)", value: formatDuration(selected.overdueMs) },
      { label: "Extended", value: selected.extended ? "Y" : "N" },
      { label: "Reason", value: selected.reason },
    ],
  })

  const events =
    selected.events.length > TIMEOUT_EVENT_DISPLAY_LIMIT
      ? selected.events.slice(-TIMEOUT_EVENT_DISPLAY_LIMIT)
      : selected.events
  tab.table({
    title: `Deadline timeline (${events.length} of ${selected.events.length} events)`,
    widthKey: tableKey("timeouts", "timeline"),
    columns: TIMEOUT_EVENT_COLUMNS,
    rows: events.map((event) => timeoutEventRow(event, selected.dispatchedAt)),
  })

  if (selected.masterActions.length > 0) {
    tab.table({
      title: `Master actions during command (${selected.masterActions.length})`,
      widthKey: tableKey("timeouts", "actions"),
      columns: TIMEOUT_ACTION_COLUMNS,
      rows: selected.masterActions.map(timeoutActionRow),
    })
  }
}

function timeoutListRow(t: FailedCommandDeadline): string[] {
  return [
    t.workerHost,
    t.commandType,
    dashCell(t.targetHost),
    formatDuration(t.actualMs),
    formatDuration(t.estimatedMs),
    formatDuration(t.slipMs),
    clock(t.failedAt),
  ]
}

function deadlineSlipStatsRow(s: CommandDeadlineSlipStats): string[] {
  return [
    s.commandType,
    String(s.count),
    formatDuration(s.minMs),
    formatDuration(s.avgMs),
    formatDuration(s.maxMs),
  ]
}

function timeoutEventRow(event: DeadlineTimelineEvent, dispatchedAt: number): string[] {
  const elapsed = event.elapsedMs ?? event.at - dispatchedAt
  return [
    clock(event.at),
    event.kind,
    event.deadlineAt != null ? clock(event.deadlineAt) : "-",
    event.estimatedMs != null ? formatDuration(event.estimatedMs) : "-",
    formatDuration(Math.max(0, elapsed)),
    dashCell(event.note),
  ]
}

function timeoutActionRow(action: MasterActionRecord): string[] {
  return [clock(action.at), action.action, dashCell(action.detail)]
}

function actionRow(a: MasterActionRecord, now: number): string[] {
  const timing = formatTiming({ startAt: a.at, endAt: a.at, ongoing: false }, now)
  const { actor, remote } = parseCommandHosts(a.action, a.detail)
  return [
    String(a.id),
    timing.start,
    timing.end,
    timing.dur,
    actor,
    formatActivityTarget(actor, remote),
    "-",
    a.action,
    "-",
    "-",
    dashCell(a.detail),
    "-",
  ]
}

function timelineRow(entry: TimelineEntry, timings: Map<number, OpTiming>): string[] {
  const now = Date.now()
  if (entry.source === "action") {
    return actionRow(entry.record, now)
  }
  return attemptRow(entry.record, timings, now)
}

function attemptRow(
  a: AttemptRecord,
  timings: Map<number, OpTiming>,
  now: number,
): string[] {
  const timing = formatTiming(
    timings.get(a.id) ?? { startAt: a.at, endAt: a.at, ongoing: false },
    now,
  )
  return [
    String(a.id),
    timing.start,
    timing.end,
    timing.dur,
    a.host,
    attemptTargetColumn(a),
    String(a.session),
    a.kind,
    dashCell(a.guess),
    a.success === true ? "Y" : a.success === false ? "N" : "-",
    dashCell(a.detail ?? a.note),
    dashCell(a.feedback ?? a.message),
  ]
}

function targetRow(t: AuthTarget): string[] {
  return [
    t.host,
    t.modelId,
    t.status,
    String(t.session),
    String(t.guessCount),
    t.solverId ?? "-",
    t.workerHost ?? "-",
    t.password ?? "-",
  ]
}

function workerRow(w: WorkerSnapshot): string[] {
  return [
    w.host,
    w.depth != null ? String(w.depth) : "-",
    String(w.commandPort),
    w.idle ? "Y" : "N",
    w.lastCommand ?? "-",
    w.lastReply ?? "-",
    String(w.neighbors.length),
    String(Math.round(w.freeRam)),
  ]
}
