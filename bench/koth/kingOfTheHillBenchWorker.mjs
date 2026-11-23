import { parentPort, workerData } from "node:worker_threads"

import { generateAssignmentAt, runSolver } from "./kingOfTheHillCore.mjs"

// One slice of one difficulty: assignments startIndex..endIndex (1-based, inclusive).
const { seed, difficulty, startIndex, endIndex } = workerData
const t0 = performance.now()
const guesses = []
let unsolved = 0

for (let index = startIndex; index <= endIndex; index++) {
  const res = runSolver(generateAssignmentAt(seed, index, difficulty).assignment)
  if (res.solved) guesses.push(res.guesses)
  else unsolved++
}

parentPort.postMessage({
  difficulty,
  guesses,
  unsolved,
  seconds: (performance.now() - t0) / 1000,
})
