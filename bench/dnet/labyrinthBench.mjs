/**
 * Labyrinth bench: actions until some worker reaches the end, per labyrinth size and worker count.
 *
 * Run: pnpm run test:labyrinth
 *      pnpm run test:labyrinth -- --count 500 --workers 1,2,4,8 --disconnect 0.005 --loss 0.1 --stagger 10
 *      pnpm run test:labyrinth -- --unknown-host     (solver not told which labyrinth it is)
 *      pnpm run test:labyrinth -- --rebuildAt 30     (the game swaps the maze at tick 30)
 */
import { DEFAULT_RUN, LABS, benchLab } from "./labyrinthBenchCore.mjs"

const options = { count: 300, seed: 20260101, workers: [1, 2, 4, 8], run: { ...DEFAULT_RUN } }
const argv = process.argv
for (let i = 2; i < argv.length; i++) {
  const next = argv[i + 1]
  if (argv[i] === "--count") options.count = Number(argv[++i])
  else if (argv[i] === "--seed") options.seed = Number(argv[++i])
  else if (argv[i] === "--workers") options.workers = argv[++i].split(",").map(Number)
  else if (argv[i] === "--unknown-host") options.run.knownHost = false
  else if (["--disconnect", "--loss", "--stagger", "--restart", "--awayTicks", "--rebuildAt"].includes(argv[i]) && next !== undefined) {
    options.run[argv[i].slice(2)] = Number(argv[++i])
  }
}

const { disconnect, loss, stagger } = options.run
console.log(
  `Labyrinth bench  N=${options.count}  seed=${options.seed}  disconnect=${disconnect}  loss=${loss}  stagger=${stagger}` +
    `${options.run.knownHost ? "" : "  unknown host"}`
)
console.log("ticks = wall clock in actions, mean / worst; (total actions; of which labreport + labradar)")
let failed = false
for (const spec of LABS) {
  let shortest = 0
  const cells = []
  for (const workers of options.workers) {
    const s = benchLab(spec, options.count, options.seed, { ...options.run, workers })
    shortest = s.meanShortest
    const unsolved = s.count - s.solved
    if (unsolved > 0) failed = true
    cells.push(
      `${workers}w ${s.meanTicks.toFixed(1)} / ${s.worstTicks} (${s.meanActions.toFixed(0)}; ${s.meanReports.toFixed(1)}+${s.meanRadars.toFixed(1)})` +
        (unsolved ? ` !${unsolved} unsolved, e.g. seed ${s.firstFailure}` : "")
    )
  }
  console.log(`${spec.name.padEnd(20)} ${spec.width}x${spec.height}  shortest route ${shortest.toFixed(1)}`)
  for (const cell of cells) console.log(`    ${cell}`)
}
if (failed) process.exitCode = 1
