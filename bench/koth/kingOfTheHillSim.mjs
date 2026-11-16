/**
 * KingOfTheHill (globalMaxima) solver simulation — matches bitburner-src game logic.
 *
 * Run: pnpm run test:koth
 *      pnpm run test:koth -- --seed 42 --count 10 --difficulty 60
 *      pnpm run test:koth -- --all-difficulties --count 1000
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
} from "./kingOfTheHillCore.mjs"

function parseArgs(argv) {
  let seed = DEFAULT_SEED
  let count = DEFAULT_COUNT
  let difficulty = DEFAULT_DIFFICULTY
  let allDifficulties = false
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--seed" && argv[i + 1]) seed = Number(argv[++i])
    else if (argv[i] === "--count" && argv[i + 1]) count = Number(argv[++i])
    else if (argv[i] === "--difficulty" && argv[i + 1]) difficulty = Number(argv[++i])
    else if (argv[i] === "--all-difficulties") allDifficulties = true
  }
  return { seed, count, difficulty, allDifficulties }
}

function summarize(rows) {
  const guesses = rows.filter((r) => r.solved).map((r) => r.guesses)
  const unsolved = rows.length - guesses.length
  const gs = guesses.sort((a, b) => a - b)
  const avg = gs.length ? gs.reduce((a, b) => a + b, 0) / gs.length : null
  const median = gs.length ? gs[Math.floor(gs.length / 2)] : null
  const p95 = gs.length ? gs[Math.min(gs.length - 1, Math.floor(0.95 * gs.length))] : null
  return { solved: gs.length, unsolved, avg, median, min: gs[0] ?? null, max: gs[gs.length - 1] ?? null, p95 }
}

function runDifficulty(seed, count, difficulty) {
  const rows = generateAssignments(seed, count, difficulty).map(({ index, assignment }) => ({
    index,
    assignment,
    ...runSolver(assignment),
  }))
  return { difficulty, rows, stats: summarize(rows) }
}

const { seed, count, difficulty, allDifficulties } = parseArgs(process.argv)

if (allDifficulties) {
  console.log(`=== KingOfTheHill all difficulties  N=${count} per diff  seed=${seed} ===\n`)
  console.log("diff  solved  unsolved      avg  median    min    max    p95")
  console.log("-".repeat(60))
  let failed = false
  for (let d = 1; d <= 60; d++) {
    const { stats } = runDifficulty(seed, count, d)
    if (stats.unsolved > 0) failed = true
    console.log(
      `${String(d).padStart(4)}  ${String(stats.solved).padStart(6)}  ${String(stats.unsolved).padStart(8)}  ` +
        `${stats.avg?.toFixed(2).padStart(6) ?? "   n/a"}  ${String(stats.median ?? "n/a").padStart(6)}  ` +
        `${String(stats.min ?? "n/a").padStart(5)}  ${String(stats.max ?? "n/a").padStart(5)}  ` +
        `${String(stats.p95 ?? "n/a").padStart(5)}`,
    )
  }
  console.log("-".repeat(60))
  process.exit(failed ? 1 : 0)
}

const passwordLength = Math.min(1 + difficulty / ASSIGNMENT_PASSWORD_LENGTH_DIVISOR, ASSIGNMENT_PASSWORD_LENGTH_CAP)
const hillCount = kingOfTheHillHillCount(difficulty)

console.log("=== KingOfTheHill solver simulation ===")
console.log(`model=KingOfTheHill format=numeric difficulty=${difficulty}`)
console.log(`passwordLength=${passwordLength} hills=${hillCount} assignments=${count} seed=${seed}`)
console.log("auth + altitude: bitburner-src authentication.ts / ServerGenerator.ts\n")

const { rows, stats } = runDifficulty(seed, count, difficulty)

const header = "#  password      len  guesses  solved  bestVal     bestAlt"
console.log(header)
console.log("-".repeat(header.length))

for (const row of rows) {
  const { assignment, guesses, solved, bestVal, bestAlt } = row
  console.log(
    `${String(row.index).padStart(2)}  ${assignment.password.padEnd(12)}  ${String(assignment.passwordLength).padStart(3)}  ` +
      `${String(guesses).padStart(7)}  ${solved ? "yes" : "NO "}  ${String(bestVal).padStart(9)}  ` +
      `${bestAlt != null ? bestAlt.toFixed(2).padStart(10) : "       n/a"}`,
  )
}

console.log("\n--- summary ---")
console.log(`solved: ${stats.solved}/${rows.length}`)
if (stats.unsolved > 0) {
  console.error(`FAIL: ${stats.unsolved} unsolved`)
  process.exit(1)
}
console.log(
  `avg=${stats.avg?.toFixed(3)} median=${stats.median} min=${stats.min} max=${stats.max} p95=${stats.p95}`,
)
