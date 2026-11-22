/**
 * One slice of the KingOfTheHill profile sweep, off the page's thread.
 *
 * Imports the same core the page does: Vite serves it from source in dev, so a solver edit
 * reloads the page and this worker together. The Node benchmark keeps its own bundled copy
 * (build/bundleKingOfTheHillCore.cjs) because Node cannot resolve the core's ".js" import
 * specifiers to the ".ts" sources.
 */
import { generateAssignmentAt, runSolver } from "./kingOfTheHillCore"

/** The worker scope, without pulling lib.webworker into a page-shaped tsconfig. */
const scope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent) => void) | null
}

interface RunRequest {
  type: "run"
  seed: number
  difficulty: number
  startIndex: number
  endIndex: number
}

scope.postMessage({ type: "ready" })

scope.onmessage = ({ data }: MessageEvent) => {
  const request = data as RunRequest
  if (request.type !== "run") return
  const { seed, difficulty, startIndex, endIndex } = request
  const n = endIndex - startIndex + 1
  const indices = new Uint32Array(n)
  const guesses = new Uint16Array(n)
  const solved = new Uint8Array(n)
  const bestVal = new Uint16Array(n)
  const bestAlt = new Float32Array(n)
  let i = 0
  for (let index = startIndex; index <= endIndex; index++) {
    const { assignment } = generateAssignmentAt(seed, index, difficulty)
    const result = runSolver(assignment)
    indices[i] = index
    guesses[i] = result.guesses
    solved[i] = result.solved ? 1 : 0
    bestVal[i] = result.bestVal
    bestAlt[i] = result.bestAlt ?? -1
    i++
  }
  scope.postMessage({ type: "done", indices, guesses, solved, bestVal, bestAlt }, [
    indices.buffer,
    guesses.buffer,
    solved.buffer,
    bestVal.buffer,
    bestAlt.buffer,
  ])
}
