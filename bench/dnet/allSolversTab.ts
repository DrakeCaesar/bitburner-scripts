/**
 * "All solvers" tab of bench/koth/kingOfTheHillViz.html.
 *
 *  - A table of every darknet solver: one row per password model (and KingOfTheHill), one column
 *    per difficulty, each cell `mean / worst` guesses. The cells run in module workers.
 *  - The labyrinth bench: ticks until some worker reaches the end, per labyrinth and worker count.
 *  - A labyrinth replay, drawn by the same view the game's dnet dashboard uses
 *    (src/dnet/ui/labyrinthMap.ts), through the DOM stand-in for React in domReact.ts.
 *
 * The markup lives in the page; this module finds its controls by id.
 */
import { MODEL_IDS } from "./dnetSolverBenchCore"
import { DEFAULT_RUN, LABS, LabRun, labSeedAt, type RunOptions } from "./labyrinthBenchCore"
import { installDomReact } from "./domReact"
import type { SolverBenchCell, SolverBenchJob } from "./allSolversWorker"
import { buildLabyrinthMapReact } from "../../src/dnet/ui/labyrinthMap"
import type { WorkerSnapshot } from "../../src/dnet/types"

declare const ToolUi: {
  numberOf(inputOrId: string | Element): number
  textOf(inputOrId: string | Element): string
  setStatus(nodeOrId: string | Element, text: string, kind?: string): void
  format: { grouped(value: number, digits?: number): string }
}

/** Models that take seconds per solve at high difficulty; they get their own, smaller test count. */
const SLOW_MODELS = new Set(["DeepGreen", "RateMyPix.Auth"])
const KOTH_ROW = "KingOfTheHill"
const MAX_WORKERS = 16

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

function numberList(id: string): number[] {
  return ToolUi.textOf(id)
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
}

function clampInt(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, Math.floor(value) || low))
}

function labOptions(): Partial<RunOptions> {
  return {
    disconnect: Math.max(0, ToolUi.numberOf("labDisconnect") || 0),
    loss: Math.max(0, Math.min(0.9, ToolUi.numberOf("labLoss") || 0)),
    stagger: Math.max(0, Math.floor(ToolUi.numberOf("labStagger") || 0)),
    knownHost: !byId<HTMLInputElement>("labUnknownHost").checked,
  }
}

// ---------------------------------------------------------------------------------------------
// Tables

interface CellSlot {
  job: SolverBenchJob
  td: HTMLTableCellElement
}

let runToken = 0
let workers: Worker[] = []
/** Builds one allSolversWorker.ts worker; the page supplies it, since only a page script can name the URL. */
let createWorker: () => Worker = () => {
  throw new Error("initAllSolversTab was not given a worker factory")
}

function stopWorkers(): void {
  runToken++
  for (const worker of workers) worker.terminate()
  workers = []
}

function paintCell(td: HTMLTableCellElement, cell: SolverBenchCell, digits: number): void {
  const failed = cell.count - cell.solved
  td.textContent = cell.solved > 0 ? `${cell.mean.toFixed(digits)} / ${cell.worst}` : "-"
  td.className = ""
  td.title = `${cell.solved} of ${cell.count} solved in ${cell.seconds.toFixed(1)} s`
  if (failed > 0) {
    const mark = document.createElement("span")
    mark.className = "neg"
    mark.textContent = ` !${failed}`
    td.appendChild(mark)
    td.title += `\n${failed} unsolved: ${cell.note ?? ""}`
  }
}

function headerRow(table: HTMLTableElement, labels: string[]): void {
  const row = table.createTHead().insertRow()
  for (const label of labels) {
    const th = document.createElement("th")
    th.textContent = label
    row.appendChild(th)
  }
}

function pendingCell(row: HTMLTableRowElement): HTMLTableCellElement {
  const td = row.insertCell()
  td.textContent = "..."
  td.className = "dim"
  return td
}

function buildTables(): CellSlot[] {
  const seed = ToolUi.numberOf("asSeed") || 20260101
  const count = clampInt(ToolUi.numberOf("asCount"), 1, 100000)
  const slowCount = clampInt(ToolUi.numberOf("asSlowCount"), 1, 100000)
  const loss = Math.max(0, Math.min(0.9, ToolUi.numberOf("asLoss") || 0))
  const difficulties = numberList("asDifficulties").map((d) => clampInt(d, 1, 60))
  const slots: CellSlot[] = []

  const models = byId<HTMLTableElement>("asModels")
  models.replaceChildren()
  headerRow(models, ["model", ...difficulties.map((d) => `d${d}`)])
  const modelBody = models.createTBody()
  for (const modelId of [...MODEL_IDS, KOTH_ROW]) {
    const row = modelBody.insertRow()
    row.insertCell().textContent = SLOW_MODELS.has(modelId) ? `${modelId} (${slowCount} tests)` : modelId
    for (const difficulty of difficulties) {
      const td = pendingCell(row)
      const job: SolverBenchJob =
        modelId === KOTH_ROW
          ? { kind: "koth", difficulty, count, seed }
          : { kind: "model", modelId, difficulty, count: SLOW_MODELS.has(modelId) ? slowCount : count, seed, loss }
      slots.push({ job, td })
    }
  }

  const labCount = clampInt(ToolUi.numberOf("labCount"), 1, 100000)
  const workerCounts = numberList("labWorkers").map((w) => clampInt(w, 1, 26))
  const run = labOptions()
  const labs = byId<HTMLTableElement>("asLabs")
  labs.replaceChildren()
  headerRow(labs, [
    "labyrinth",
    "size",
    "shortest route",
    ...workerCounts.map((w) => `${w} worker${w === 1 ? "" : "s"}`),
  ])
  const labBody = labs.createTBody()
  LABS.forEach((spec, lab) => {
    const row = labBody.insertRow()
    row.insertCell().textContent = spec.name
    row.insertCell().textContent = `${spec.width}x${spec.height}`
    row.insertCell().textContent = "..."
    for (const workerCount of workerCounts) {
      slots.push({
        job: { kind: "labyrinth", lab, count: labCount, seed, run: { ...run, workers: workerCount } },
        td: pendingCell(row),
      })
    }
  })
  return slots
}

/** Cheapest cells first, so the table fills in quickly and the slow corner comes last. */
function jobWeight(job: SolverBenchJob): number {
  if (job.kind === "labyrinth") return 2 + LABS[job.lab]!.width / 100
  if (job.kind === "koth") return 3
  return SLOW_MODELS.has(job.modelId) ? 10 + job.difficulty : job.difficulty / 100
}

function runTables(): void {
  stopWorkers()
  const token = runToken
  const slots = buildTables()
  const order = slots.map((_, i) => i).sort((a, b) => jobWeight(slots[a]!.job) - jobWeight(slots[b]!.job))
  const status = byId("asStatus")
  const runButton = byId<HTMLButtonElement>("asRun")
  const size = Math.min(order.length, clampInt((navigator.hardwareConcurrency || 4) - 1, 1, MAX_WORKERS))
  const started = performance.now()
  let next = 0
  let done = 0
  let unsolved = 0
  runButton.textContent = "Running..."
  ToolUi.setStatus(status, `0 / ${slots.length} cells (${size} workers)`)

  const finish = (): void => {
    runButton.textContent = "Run"
    const seconds = ((performance.now() - started) / 1000).toFixed(1)
    ToolUi.setStatus(
      status,
      unsolved > 0
        ? `${slots.length} cells in ${seconds} s, ${unsolved} with unsolved runs (hover a red mark)`
        : `${slots.length} cells in ${seconds} s, everything solved`,
      unsolved > 0 ? "error" : undefined
    )
    stopWorkers()
  }

  for (let i = 0; i < size; i++) {
    const worker = createWorker()
    workers.push(worker)
    const feed = (): void => {
      if (token !== runToken || next >= order.length) return
      const index = order[next++]!
      worker.postMessage({ index, job: slots[index]!.job })
    }
    worker.onmessage = (event: MessageEvent) => {
      if (token !== runToken) return
      const { index, result, error } = event.data as { index: number; result?: SolverBenchCell; error?: string }
      const slot = slots[index]!
      if (error || !result) {
        slot.td.textContent = "error"
        slot.td.className = "neg"
        slot.td.title = error ?? "no result"
        unsolved++
      } else {
        paintCell(slot.td, result, slot.job.kind === "labyrinth" ? 1 : 2)
        if (result.solved < result.count) unsolved++
        if (slot.job.kind === "labyrinth" && result.shortest !== undefined) {
          const shortest = slot.td.parentElement!.children[2] as HTMLElement
          shortest.textContent = result.shortest.toFixed(1)
        }
      }
      done++
      if (done === slots.length) finish()
      else {
        ToolUi.setStatus(status, `${done} / ${slots.length} cells (${size} workers)`)
        feed()
      }
    }
    worker.onerror = (event: ErrorEvent) => {
      if (token !== runToken) return
      ToolUi.setStatus(status, `worker failed: ${event.message}`, "error")
      runButton.textContent = "Run"
    }
    feed()
  }
}

// ---------------------------------------------------------------------------------------------
// Labyrinth replay

let replay: LabRun | null = null
let replayTimer: number | null = null

function replaySetup(): { lab: number; seed: number; workers: number } {
  const lab = clampInt(Number(byId<HTMLSelectElement>("labPick").value), 0, LABS.length - 1)
  const maze = clampInt(ToolUi.numberOf("labMaze"), 1, 1e9)
  return {
    lab,
    seed: labSeedAt(ToolUi.numberOf("asSeed") || 20260101, maze - 1),
    workers: clampInt(ToolUi.numberOf("labReplayWorkers"), 1, 26),
  }
}

function drawReplay(): void {
  const run = replay
  if (!run) return
  const labHost = run.spec.name
  const active = new Set(run.active)
  const workerSnapshots: WorkerSnapshot[] = run.hosts.map((host) => ({
    host,
    pid: 0,
    commandPort: 1,
    idle: !run.lastActions.has(host),
    depth: null,
    // Before the first tick nobody has been checked yet: show everyone as next to the labyrinth.
    neighbors: active.has(host) || run.result.ticks === 0 ? [labHost] : [],
    lastCommand: run.lastActions.get(host) ?? null,
    lastReply: null,
    freeRam: 0,
    blockedRam: 0,
  }))
  const { result } = run
  const view = buildLabyrinthMapReact(
    {
      hostname: labHost,
      status: result.solved ? "solved" : run.done ? "gave up" : "active",
      pendingWorker: null,
      pendingCommand: null,
      state: run.state,
    },
    { stasisLinked: [], workers: workerSnapshots }
  )
  byId("labView").replaceChildren(view as unknown as Node)
  ToolUi.setStatus(
    "labReplayStatus",
    `tick ${result.ticks}  |  actions ${result.actions} (${result.moves} moves, ${result.reports} labreport, ` +
      `${result.radars} labradar)  |  shortest route ${result.shortest}  |  ` +
      (result.solved ? "reached the end" : run.done ? "stopped at the tick limit" : "exploring") +
      (result.resets ? `  |  map reset ${result.resets}x` : ""),
    run.done && !result.solved ? "error" : undefined
  )
}

function pauseReplay(): void {
  if (replayTimer !== null) clearInterval(replayTimer)
  replayTimer = null
  byId("labPlay").textContent = "Play"
}

function resetReplay(): void {
  pauseReplay()
  const { lab, seed, workers } = replaySetup()
  replay = new LabRun(LABS[lab]!, seed, { ...DEFAULT_RUN, ...labOptions(), workers })
  drawReplay()
}

function stepReplay(): void {
  if (!replay || replay.done) {
    pauseReplay()
    return
  }
  replay.step()
  drawReplay()
  if (replay.done) pauseReplay()
}

function toggleReplay(): void {
  if (replayTimer !== null) {
    pauseReplay()
    return
  }
  if (!replay || replay.done) resetReplay()
  const perSecond = Math.max(1, Math.min(60, ToolUi.numberOf("labSpeed") || 10))
  replayTimer = window.setInterval(stepReplay, 1000 / perSecond)
  byId("labPlay").textContent = "Pause"
}

// ---------------------------------------------------------------------------------------------

let initialised = false

/** Wire the tab up. Called the first time it is shown; safe to call again. */
export function initAllSolversTab(workerFactory: () => Worker): void {
  if (initialised) return
  initialised = true
  createWorker = workerFactory
  installDomReact()

  // The page lists the labyrinths itself so that the stored choice can be restored; rebuild the
  // list only if the bench core knows a different set.
  const pick = byId<HTMLSelectElement>("labPick")
  if (pick.options.length !== LABS.length) {
    pick.replaceChildren(
      ...LABS.map((spec, i) => {
        const option = document.createElement("option")
        option.value = String(i)
        option.textContent = `${spec.name} ${spec.width}x${spec.height}`
        return option
      })
    )
    pick.value = String(LABS.length - 1)
  }

  byId("asRun").addEventListener("click", runTables)
  byId("asStop").addEventListener("click", () => {
    stopWorkers()
    byId("asRun").textContent = "Run"
    ToolUi.setStatus("asStatus", "stopped")
  })
  byId("labPlay").addEventListener("click", toggleReplay)
  byId("labStep").addEventListener("click", () => {
    pauseReplay()
    if (!replay) resetReplay()
    stepReplay()
  })
  byId("labReset").addEventListener("click", resetReplay)
  for (const id of ["labPick", "labMaze", "labReplayWorkers"]) byId(id).addEventListener("change", resetReplay)

  resetReplay()
}
