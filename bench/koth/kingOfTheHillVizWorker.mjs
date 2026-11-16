import { generateAssignmentAt, runSolver } from "./kingOfTheHillCore.mjs"

self.postMessage({ type: "ready" })

self.onmessage = ({ data }) => {
  if (data.type !== "run") return
  const { seed, difficulty, startIndex, endIndex } = data
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
  self.postMessage(
    { type: "done", indices, guesses, solved, bestVal, bestAlt },
    [indices.buffer, guesses.buffer, solved.buffer, bestVal.buffer, bestAlt.buffer],
  )
}
