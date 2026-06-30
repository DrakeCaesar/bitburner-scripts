import { NS } from "@ns"
import {
  col,
  createTabbedTailLog,
  renderTabbedTailLog,
  W,
  type TabbedScriptLogBuilder,
} from "@/libraries/scriptLogUiLayout.js"
import { MUTATION_PORT } from "../constants.js"
import type {
  AttemptRecord,
  AuthTarget,
  CrawlSnapshot,
  FailedAuthSession,
  MasterActionRecord,
  MutationPortSnapshot,
  SessionEvent,
  WorkerSnapshot,
} from "../types.js"

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "targets", label: "Targets" },
  { id: "attempts", label: "Attempts" },
  { id: "workers", label: "Workers" },
  { id: "failed", label: "Failed" },
] as const

const TARGET_COLUMNS = [
  col("Host", "left", W.host),
  col("Model", "left", 16),
  col("Status", "left", 14),
  col("Session", "right", 7),
  col("Guesses", "right", 7),
  col("Solver", "left", 14),
  col("Worker", "left", W.host),
  col("Password", "left", 12),
]

const ATTEMPT_COLUMNS = [
  col("Id", "right", 5),
  col("Start", "right", 8),
  col("End", "right", 8),
  col("Dur", "right", 7),
  col("Host", "left", W.host),
  col("Sess", "right", 4),
  col("Kind", "left", 14),
  col("Guess", "left", 10),
  col("OK", "center", 3),
  col("Detail", "left", 12),
  col("Feedback", "left", 14),
]

const WORKER_COLUMNS = [
  col("Host", "left", W.host),
  col("Port", "right", 6),
  col("Idle", "center", 4),
  col("Cmd", "left", 16),
  col("Reply", "left", 14),
  col("Ngbrs", "right", 5),
  col("RAM", "right", 6),
]

const FAILED_LIST_COLUMNS = [
  col("Host", "left", W.host),
  col("Sess", "right", 4),
  col("Solver", "left", 14),
  col("Guesses", "right", 7),
  col("Reason", "left", 18),
  col("Ended", "right", 8),
]

const FAILED_EVENT_COLUMNS = [
  col("Time", "right", 8),
  col("Kind", "left", 14),
  col("Guess", "left", 14),
  col("OK", "center", 3),
  col("Feedback", "left", 16),
  col("Detail", "left", 20),
]

export class DnetDashboard {
  readonly log: TabbedScriptLogBuilder
  selectedFailedSessionId: string | null = null
  private pendingFailedRow = -1
  private lastFailedCount = 0

  constructor() {
    this.log = createTabbedTailLog([...TABS])
  }

  onFailedRowClick(rowIndex: number): void {
    this.pendingFailedRow = rowIndex
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
}

export function createDashboard(): DnetDashboard {
  return new DnetDashboard()
}

function formatMutationLine(m: MutationPortSnapshot): string {
  const portTime = m.portTs != null ? clock(m.portTs) : "-"
  const pending = m.pending != null ? String(m.pending) : "-"
  return (
    `mutation port ${MUTATION_PORT}  peek=${m.portRaw}  ts=${m.portTs ?? "-"} (${portTime})  ` +
    `acked=${m.acked}  pending=${pending}  stale=${m.stale ? "Y" : "N"}  ` +
    `portAhead=${m.pendingBehindPort ? "Y" : "N"}  loop ${clock(m.loopAt)}`
  )
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
    ...actions.map((record) => ({ source: "action" as const, at: record.at, record })),
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
  if (ms < 1000) return `${ms}ms`
  const totalSec = Math.floor(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min < 60) return sec > 0 ? `${min}m${sec}s` : `${min}m`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return remMin > 0 ? `${hr}h${remMin}m` : `${hr}h`
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

function truncate(s: string | undefined, max: number): string {
  if (!s) return "-"
  return s.length <= max ? s : s.slice(0, max - 1) + "."
}

export async function renderDashboard(
  ns: NS,
  dashboard: DnetDashboard,
  snap: CrawlSnapshot,
): Promise<void> {
  const log = dashboard.log
  const s = snap.summary
  const failed = snap.failedSessions
  dashboard.applyFailedSelection(failed)
  const selected =
    failed.find((f) => f.id === dashboard.selectedFailedSessionId) ?? null
  const selectedRowIndex =
    selected != null ? failed.findIndex((f) => f.id === selected.id) : undefined

  log.clearPanels()

  log
    .tab("overview")
    .text(
      `dnet v2  session ${snap.sessionId}  ` +
        `targets ${snap.targets.length}  active ${s.active}  solved ${s.solved}  ` +
        `exhausted ${s.exhausted}  retry ${s.retryWait}  no_solver ${s.noSolver}  ` +
        `unsupported ${s.unsupported}  attempts ${snap.attempts.length}  workers ${snap.workers.length}  ` +
        `failed ${failed.length}`,
    )
    .text(formatMutationLine(snap.mutation))

  const sortedTargets = [...snap.targets].sort((a, b) => a.host.localeCompare(b.host))
  log.tab("targets").table({
    title: "Auth targets",
    columns: TARGET_COLUMNS,
    rows: sortedTargets.map(targetRow),
  })

  const timeline = buildTimeline(snap.attempts, snap.actions)
  const attemptTimings = indexAttemptTimings(snap.attempts)
  const recentTimeline = timeline.slice(-100).reverse()
  log.tab("attempts").table({
    title: `Activity log (newest first, ${recentTimeline.length} of ${timeline.length})`,
    columns: ATTEMPT_COLUMNS,
    rows: recentTimeline.map((entry) => timelineRow(entry, attemptTimings)),
  })

  log.tab("workers").table({
    title: "Workers",
    columns: WORKER_COLUMNS,
    rows: snap.workers.map(workerRow),
  })

  renderFailedTab(log, dashboard, failed, selected, selectedRowIndex)

  await renderTabbedTailLog(ns, log)
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
    rows: [
      { label: "Host", value: a.host },
      { label: "Model", value: a.modelId },
      { label: "Format", value: a.format },
      { label: "Length", value: String(a.passwordLength) },
      { label: "Hint", value: a.passwordHint || "-" },
      { label: "Data", value: truncate(a.data, 80) },
      { label: "Depth", value: String(a.depth) },
      { label: "Difficulty", value: String(a.difficulty) },
      { label: "Charisma", value: String(a.requiredCharismaSkill) },
    ],
  })

  tab.table({
    title: `Session log (${selected.events.length} events)`,
    columns: FAILED_EVENT_COLUMNS,
    rows: selected.events.map(failedEventRow),
  })

  for (const event of selected.events) {
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
    truncate(s.reason, 18),
    clock(s.archivedAt),
  ]
}

function failedEventRow(e: SessionEvent): string[] {
  return [
    clock(e.at),
    e.kind,
    truncate(e.guess, 14),
    e.success === true ? "Y" : e.success === false ? "N" : "-",
    truncate(e.feedback ?? e.message, 16),
    truncate(e.detail ?? e.note, 20),
  ]
}

function actionRow(a: MasterActionRecord, now: number): string[] {
  const timing = formatTiming({ startAt: a.at, endAt: a.at, ongoing: false }, now)
  return [
    String(a.id),
    timing.start,
    timing.end,
    timing.dur,
    "-",
    "-",
    a.action,
    "-",
    "-",
    truncate(a.detail, 12),
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
    String(a.session),
    a.kind,
    truncate(a.guess, 10),
    a.success === true ? "Y" : a.success === false ? "N" : "-",
    truncate(a.detail ?? a.note, 12),
    truncate(a.feedback ?? a.message, 14),
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
    String(w.commandPort),
    w.idle ? "Y" : "N",
    w.lastCommand ?? "-",
    w.lastReply ?? "-",
    String(w.neighbors.length),
    String(Math.round(w.freeRam)),
  ]
}
