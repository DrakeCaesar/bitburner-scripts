/**
 * One stock benchmark job, off the page's thread.
 *
 * Imports the same core the page does, so there is one copy of the model: Vite serves it from
 * source in dev (editing bench/stock reloads the page and the worker) and bundles it for a build.
 * The message contract is the one ToolUi.poolFrom schedules against: {index, job} in,
 * {index, result} or {index, error} out.
 */
import { runHoldBaseline, runTraderScenario } from "./stockBenchCore"

/** The worker scope, without pulling lib.webworker into a page-shaped tsconfig. */
const scope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent) => void) | null
}

/** The slice of the page's job shape this side needs; the options are the core's own types. */
type BenchJob =
  | { kind: "hold"; options: never; filtered: never; lite?: boolean }
  | { kind: "run"; options: never; lite?: boolean }

function runBenchJob(job: BenchJob) {
  const result = job.kind === "hold" ? runHoldBaseline(job.options, job.filtered) : runTraderScenario(job.options)
  // A tuning run measures hundreds of runs and only needs the summary numbers. Posting the equity
  // curve of every one of them copies one number per update across the worker boundary for nothing,
  // so a "lite" job drops it here rather than after the transfer.
  if (job.lite && result) result.equityCurve = []
  return result
}

scope.onmessage = (event: MessageEvent) => {
  const data = (event.data ?? {}) as { index: number; job: BenchJob }
  try {
    scope.postMessage({ index: data.index, result: runBenchJob(data.job) })
  } catch (error) {
    scope.postMessage({ index: data.index, error: String((error as Error)?.stack ?? error) })
  }
}
