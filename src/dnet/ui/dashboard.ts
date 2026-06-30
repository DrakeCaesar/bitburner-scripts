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
  col("When", "right", 8),
  col("Host", "left", W.host),
  col("Sess", "right", 4),
  col("Kind", "left", 14),
  col("Guess", "left", 12),
  col("OK", "center", 3),
  col("Detail", "left", 14),
  col("Feedback", "left", 18),
]

const ACTION_COLUMNS = [
  col("Time", "right", 8),
  col("Action", "left", 14),
  col("Detail", "left", 48),
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

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
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
    .table({
      title: "Master actions (newest first)",
      columns: ACTION_COLUMNS,
      rows: [...snap.actions].reverse().map(actionRow),
    })

  const sortedTargets = [...snap.targets].sort((a, b) => a.host.localeCompare(b.host))
  log.tab("targets").table({
    title: "Auth targets",
    columns: TARGET_COLUMNS,
    rows: sortedTargets.map(targetRow),
  })

  const recentAttempts = [...snap.attempts].slice(-100).reverse()
  log.tab("attempts").table({
    title: `Attempt log (newest first, showing ${recentAttempts.length} of ${snap.attempts.length})`,
    columns: ATTEMPT_COLUMNS,
    rows: recentAttempts.map(attemptRow),
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

function actionRow(a: MasterActionRecord): string[] {
  return [clock(a.at), a.action, truncate(a.detail, 48)]
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

function attemptRow(a: AttemptRecord): string[] {
  return [
    String(a.id),
    ago(a.at),
    a.host,
    String(a.session),
    a.kind,
    truncate(a.guess, 12),
    a.success === true ? "Y" : a.success === false ? "N" : "-",
    truncate(a.detail ?? a.note, 14),
    truncate(a.feedback ?? a.message, 18),
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
