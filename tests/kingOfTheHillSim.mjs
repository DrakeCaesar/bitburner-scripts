/**
 * KingOfTheHill (globalMaxima) solver simulation — matches bitburner-src game logic.
 *
 * Run: pnpm run test:koth
 *      pnpm run test:koth -- --seed 42 --count 10 --difficulty 60
 *      pnpm run test:koth -- --verify-benchmark --objective max
 */

import {
  ASSIGNMENT_PASSWORD_LENGTH_CAP,
  ASSIGNMENT_PASSWORD_LENGTH_DIVISOR,
  DEFAULT_COUNT,
  DEFAULT_DIFFICULTY,
  DEFAULT_SEED,
  generateAssignments,
  kingOfTheHillHillCount,
  runSolver,
  verifyTunedConfigBenchmark,
} from "./kingOfTheHillCore.mjs"

function parseArgs(argv) {
  let seed = DEFAULT_SEED
  let count = DEFAULT_COUNT
  let difficulty = DEFAULT_DIFFICULTY
  let verifyBenchmark = false
  let objective = "max"
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--seed" && argv[i + 1]) seed = Number(argv[++i])
    else if (argv[i] === "--count" && argv[i + 1]) count = Number(argv[++i])
    else if (argv[i] === "--difficulty" && argv[i + 1]) difficulty = Number(argv[++i])
    else if (argv[i] === "--verify-benchmark") verifyBenchmark = true
    else if (argv[i] === "--objective" && argv[i + 1]) objective = argv[++i]
  }
  return { seed, count, difficulty, verifyBenchmark, objective }
}

const { seed, count, difficulty, verifyBenchmark, objective } = parseArgs(process.argv)

if (verifyBenchmark) {
  console.log("=== KingOfTheHill tuned JSON benchmark verify ===")
  console.log(`objective=${objective}\n`)
  const result = verifyTunedConfigBenchmark(objective)
  if (result.benchmark == null) {
    console.error("No benchmark section in JSON.")
    process.exit(1)
  }
  const b = result.benchmark
  console.log(
    `benchmark: seed=${b.seed} difficulty=${b.difficulty} count=${b.count} selection=${b.selection}`,
  )
  console.log(`JSON scores: avg=${result.jsonAvgGuesses} max=${result.jsonMaxGuesses} total=${result.jsonTotalGuesses}`)
  console.log(`JS replay:   avg=${result.jsAvgGuesses?.toFixed(4) ?? "n/a"} max=${result.jsMaxGuesses ?? "n/a"} total=${result.jsTotalGuesses ?? "n/a"}`)
  if (result.unsolved > 0) {
    console.error(`\nFAIL: ${result.unsolved}/${result.checked} unsolved on benchmark set`)
    process.exit(1)
  }
  if (!result.ok) {
    console.error("\nFAIL: JS aggregate scores differ from JSON (C++ vs JS divergence?)")
    process.exit(1)
  }
  console.log(`\nOK: ${result.checked} assignments match JSON scores`)
  process.exit(0)
}

const passwordLength = Math.min(1 + difficulty / ASSIGNMENT_PASSWORD_LENGTH_DIVISOR, ASSIGNMENT_PASSWORD_LENGTH_CAP)
const hillCount = kingOfTheHillHillCount(difficulty)

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
