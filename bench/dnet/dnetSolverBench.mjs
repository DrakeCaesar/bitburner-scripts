/**
 * Darknet solver benchmark: guesses per solve for every password model, by difficulty.
 *
 * Run: pnpm run test:dnet-solvers
 *      pnpm run test:dnet-solvers -- --count 2000 --difficulties 10,30,60 --models "PHP 5.4,NIL"
 *      pnpm run test:dnet-solvers -- --loss 0.2     (20% of guesses time out: every solver must still solve)
 */
import { MODEL_IDS, benchModel } from "./dnetSolverBenchCore.mjs"

function parseArgs(argv) {
  const options = { count: 500, seed: 20260101, difficulties: [4, 10, 20, 30, 45, 60], models: MODEL_IDS, loss: 0 }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--count" && argv[i + 1]) options.count = Number(argv[++i])
    else if (argv[i] === "--seed" && argv[i + 1]) options.seed = Number(argv[++i])
    else if (argv[i] === "--difficulties" && argv[i + 1]) options.difficulties = argv[++i].split(",").map(Number)
    else if (argv[i] === "--loss" && argv[i + 1]) options.loss = Number(argv[++i])
    else if (argv[i] === "--models" && argv[i + 1]) options.models = argv[++i].split(",").map((s) => s.trim())
  }
  return options
}

const { count, seed, difficulties, models, loss } = parseArgs(process.argv)
console.log(
  `Darknet solver bench  N=${count} per cell  seed=${seed}${loss ? `  loss=${loss}` : ""}   (mean / worst guesses; !n = n unsolved)`
)
console.log("model".padEnd(22) + difficulties.map((d) => `d${d}`.padStart(16)).join(""))
let failed = false
for (const modelId of models) {
  let line = modelId.padEnd(22)
  const notes = []
  for (const difficulty of difficulties) {
    const s = benchModel(modelId, difficulty, count, seed, loss)
    const unsolved = count - s.solved
    if (unsolved > 0) {
      failed = true
      notes.push(`d${difficulty}: ${JSON.stringify(s.failures)} e.g. password ${JSON.stringify(s.firstFailure)}`)
    }
    const cell = s.solved ? `${s.mean.toFixed(2)} / ${s.worst}` : "-"
    line += `${cell}${unsolved ? ` !${unsolved}` : ""}`.padStart(16)
  }
  console.log(line)
  for (const note of notes) console.log(`    ${note}`)
}
process.exit(failed ? 1 : 0)
