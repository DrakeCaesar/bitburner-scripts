import { NS } from "@ns"
import {
  col,
  createTabbedTailLog,
  renderTabbedTailLog,
  W,
  type TabbedScriptLogBuilder,
} from "@/libraries/scriptLogUiLayout.js"
import type { AttemptRecord, AuthTarget, CrawlSnapshot, WorkerSnapshot } from "../types.js"

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "targets", label: "Targets" },
  { id: "attempts", label: "Attempts" },
  { id: "workers", label: "Workers" },
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

const WORKER_COLUMNS = [
  col("Host", "left", W.host),
  col("Port", "right", 6),
  col("Idle", "center", 4),
  col("Cmd", "left", 16),
  col("Reply", "left", 14),
  col("Ngbrs", "right", 5),
  col("RAM", "right", 6),
]

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

export function createDashboard(): TabbedScriptLogBuilder {
  return createTabbedTailLog([...TABS])
}

export async function renderDashboard(
  ns: NS,
  log: TabbedScriptLogBuilder,
  snap: CrawlSnapshot,
): Promise<void> {
  const s = snap.summary
  log.clearPanels()

  log
    .tab("overview")
    .text(
      `dnet v2  session ${snap.sessionId}  ` +
        `targets ${snap.targets.length}  active ${s.active}  solved ${s.solved}  ` +
        `exhausted ${s.exhausted}  retry ${s.retryWait}  no_solver ${s.noSolver}  ` +
        `unsupported ${s.unsupported}  attempts ${snap.attempts.length}  workers ${snap.workers.length}`,
    )

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

  await renderTabbedTailLog(ns, log)
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
