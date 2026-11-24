/**
 * One cell of the "All solvers" tab (bench/koth/kingOfTheHillViz.html), off the page's thread:
 * a password model at one difficulty, KingOfTheHill at one difficulty, or a labyrinth with one
 * worker count. Speaks the ToolUi pool protocol ({ index, job } in, { index, result | error } out).
 */
import { benchModel } from "./dnetSolverBenchCore"
import { DEFAULT_RUN, LABS, benchLab, type RunOptions } from "./labyrinthBenchCore"
import { generateAssignmentAt, runSolver } from "../koth/kingOfTheHillCore"

export type SolverBenchJob =
  | { kind: "model"; modelId: string; difficulty: number; count: number; seed: number; loss: number }
  | { kind: "koth"; difficulty: number; count: number; seed: number }
  | { kind: "labyrinth"; lab: number; count: number; seed: number; run: Partial<RunOptions> }

export interface SolverBenchCell {
  count: number
  solved: number
  mean: number
  worst: number
  /** Labyrinth only: mean shortest route, for scale. */
  shortest?: number
  /** Why runs failed, when any did. */
  note?: string
  seconds: number
}

/** The worker scope, without pulling lib.webworker into a page-shaped tsconfig. */
const scope = self as unknown as {
  postMessage(message: unknown): void
  onmessage: ((event: MessageEvent) => void) | null
}

function runJob(job: SolverBenchJob): Omit<SolverBenchCell, "seconds"> {
  if (job.kind === "model") {
    const s = benchModel(job.modelId, job.difficulty, job.count, job.seed, job.loss)
    const failed = s.count - s.solved
    return {
      count: s.count,
      solved: s.solved,
      mean: s.mean,
      worst: s.worst,
      note: failed ? `${JSON.stringify(s.failures)}, e.g. password ${JSON.stringify(s.firstFailure)}` : undefined,
    }
  }
  if (job.kind === "koth") {
    let solved = 0
    let total = 0
    let worst = 0
    let firstFailure = 0
    for (let index = 1; index <= job.count; index++) {
      const result = runSolver(generateAssignmentAt(job.seed, index, job.difficulty).assignment)
      if (!result.solved) {
        firstFailure ||= index
        continue
      }
      solved++
      total += result.guesses
      worst = Math.max(worst, result.guesses)
    }
    return {
      count: job.count,
      solved,
      mean: solved ? total / solved : NaN,
      worst,
      note: firstFailure ? `first unsolved: assignment #${firstFailure}` : undefined,
    }
  }
  const s = benchLab(LABS[job.lab]!, job.count, job.seed, { ...DEFAULT_RUN, ...job.run })
  return {
    count: s.count,
    solved: s.solved,
    mean: s.meanTicks,
    worst: s.worstTicks,
    shortest: s.meanShortest,
    note: s.firstFailure !== null ? `first unsolved: seed ${s.firstFailure}` : undefined,
  }
}

scope.onmessage = (event: MessageEvent) => {
  const data = event.data as { index: number; job: SolverBenchJob }
  const started = performance.now()
  try {
    const result: SolverBenchCell = { ...runJob(data.job), seconds: (performance.now() - started) / 1000 }
    scope.postMessage({ index: data.index, result })
  } catch (error) {
    scope.postMessage({ index: data.index, error: String((error as Error)?.stack ?? error) })
  }
}
