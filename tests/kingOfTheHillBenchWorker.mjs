import { parentPort, workerData } from "node:worker_threads"

import { generateAssignments, runSolver } from "./kingOfTheHillCore.mjs"

const { seed, count, difficulty } = workerData
const rows = generateAssignments(seed, count, difficulty)
const t0 = performance.now()
const guesses = []
let unsolved = 0

for (const { assignment } of rows) {
  const res = runSolver(assignment)
  if (res.solved) guesses.push(res.guesses)
  else unsolved++
}

guesses.sort((a, b) => a - b)

parentPort.postMessage({
  difficulty,
  guesses,
  unsolved,
  seconds: (performance.now() - t0) / 1000,
})
