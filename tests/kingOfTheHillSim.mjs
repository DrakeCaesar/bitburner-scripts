/**
 * KingOfTheHill (globalMaxima) solver simulation — matches bitburner-src game logic.
 *
 * Run: node tests/kingOfTheHillSim.mjs
 *      node tests/kingOfTheHillSim.mjs --seed 42 --count 10 --difficulty 60
 */

import {
  DEFAULT_COUNT,
  DEFAULT_DIFFICULTY,
  DEFAULT_SEED,
  generateAssignments,
  runSolver,
} from "./kingOfTheHillCore.mjs"

function parseArgs(argv) {
  let seed = DEFAULT_SEED
  let count = DEFAULT_COUNT
  let difficulty = DEFAULT_DIFFICULTY
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--seed" && argv[i + 1]) seed = Number(argv[++i])
    else if (argv[i] === "--count" && argv[i + 1]) count = Number(argv[++i])
    else if (argv[i] === "--difficulty" && argv[i + 1]) difficulty = Number(argv[++i])
  }
  return { seed, count, difficulty }
}

const { seed, count, difficulty } = parseArgs(process.argv)
const passwordLength = Math.min(1 + difficulty / 6, 10)
const hillCount = Math.min(Math.floor(difficulty / 8), 4) * 2 + 1

console.log("=== KingOfTheHill solver simulation ===")
console.log(`model=KingOfTheHill format=numeric difficulty=${difficulty}`)
console.log(`passwordLength=${passwordLength} hills=${hillCount} assignments=${count} seed=${seed}`)
console.log("auth + altitude: bitburner-src authentication.ts / ServerGenerator.ts\n")

const rows = generateAssignments(seed, count, difficulty).map(({ index, assignment }) => ({
  index,
  assignment,
  ...runSolver(assignment),
}))

const header = "#  password      len  guesses  solved  bestVal     bestAlt"
console.log(header)
console.log("-".repeat(header.length))
for (const row of rows) {
  const pw = row.assignment.password.padEnd(12, " ")
  const len = String(row.assignment.passwordLength).padStart(3, " ")
  const guesses = String(row.guesses).padStart(7, " ")
  const solved = row.solved ? "yes" : "NO "
  const bestVal = String(row.bestVal).padStart(11, " ")
  const bestAlt = row.bestAlt != null ? row.bestAlt.toFixed(2).padStart(8, " ") : "     n/a"
  console.log(`${String(row.index).padStart(2, " ")}  ${pw}  ${len}  ${guesses}  ${solved}  ${bestVal}  ${bestAlt}`)
}

const solvedCount = rows.filter((r) => r.solved).length
const guessCounts = rows.map((r) => r.guesses)
const total = guessCounts.reduce((a, b) => a + b, 0)
const min = Math.min(...guessCounts)
const max = Math.max(...guessCounts)
const avg = total / guessCounts.length

console.log("")
console.log(`Solved: ${solvedCount}/${count}`)
console.log(`Guesses: min=${min} max=${max} avg=${avg.toFixed(1)} total=${total}`)

if (solvedCount < count) {
  console.error("\nFAIL: solver did not auth on every assignment")
  process.exit(1)
}
