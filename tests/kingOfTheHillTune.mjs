/**
 * Genetic tuner for KingOfTheHill improved-solver constants.
 *
 * Run: node tests/kingOfTheHillTune.mjs
 *      node tests/kingOfTheHillTune.mjs --count 100 --population 24
 *      node tests/kingOfTheHillTune.mjs --load tests/kingOfTheHillTune.best.json
 *
 * Stop anytime with Ctrl+C — best config is written to --out (default below).
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import {
  DEFAULT_DIFFICULTY,
  DEFAULT_SEED,
  IMPROVED_TUNABLE_SPECS,
  evaluateImprovedConfig,
  generateAssignments,
  getDefaultImprovedConfig,
  normalizeImprovedConfig,
} from "./kingOfTheHillCore.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_OUT = resolve(__dirname, "kingOfTheHillTune.best.json")

function parseArgs(argv) {
  let seed = DEFAULT_SEED
  let count = 100
  let difficulty = DEFAULT_DIFFICULTY
  let population = 20
  let generations = Infinity
  let mutationRate = 0.35
  let tournamentSize = 3
  let eliteCount = 2
  let loadPath = null
  let outPath = DEFAULT_OUT
  let saveEvery = 1

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--seed" && argv[i + 1]) seed = Number(argv[++i])
    else if (arg === "--count" && argv[i + 1]) count = Number(argv[++i])
    else if (arg === "--difficulty" && argv[i + 1]) difficulty = Number(argv[++i])
    else if (arg === "--population" && argv[i + 1]) population = Number(argv[++i])
    else if (arg === "--generations" && argv[i + 1]) generations = Number(argv[++i])
    else if (arg === "--mutation-rate" && argv[i + 1]) mutationRate = Number(argv[++i])
    else if (arg === "--tournament" && argv[i + 1]) tournamentSize = Number(argv[++i])
    else if (arg === "--elite" && argv[i + 1]) eliteCount = Number(argv[++i])
    else if (arg === "--load" && argv[i + 1]) loadPath = resolve(argv[++i])
    else if (arg === "--out" && argv[i + 1]) outPath = resolve(argv[++i])
    else if (arg === "--save-every" && argv[i + 1]) saveEvery = Number(argv[++i])
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node tests/kingOfTheHillTune.mjs [options]

Options:
  --seed N            Assignment seed (default ${DEFAULT_SEED})
  --count N           Assignments per evaluation (default 100)
  --difficulty N      Game difficulty (default ${DEFAULT_DIFFICULTY})
  --population N      Population size (default 20)
  --generations N     Max generations; omit to run until Ctrl+C
  --mutation-rate F   Per-gene mutation chance 0..1 (default 0.35)
  --tournament N      Tournament selection size (default 3)
  --elite N           Elite individuals kept each generation (default 2)
  --load PATH         Start from a saved best config JSON
  --out PATH          Write best config here (default tests/kingOfTheHillTune.best.json)
  --save-every N      Persist best every N generations (default 1)

Press Ctrl+C to stop; the current best config is saved to --out.`)
      process.exit(0)
    }
  }

  return {
    seed,
    count,
    difficulty,
    population,
    generations,
    mutationRate,
    tournamentSize,
    eliteCount,
    loadPath,
    outPath,
    saveEvery,
  }
}

function randomInSpec(spec, rng = Math.random) {
  const span = spec.max - spec.min
  if (spec.type === "int") {
    const steps = Math.floor(span / spec.step)
    return spec.min + Math.floor(rng() * (steps + 1)) * spec.step
  }
  const steps = Math.floor(span / spec.step)
  const stepIdx = Math.floor(rng() * (steps + 1))
  return spec.min + stepIdx * spec.step
}

function mutateGene(key, value, mutationRate) {
  const spec = IMPROVED_TUNABLE_SPECS.find((s) => s.key === key)
  if (!spec || Math.random() > mutationRate) return value

  if (spec.type === "int") {
    const delta = (Math.random() < 0.5 ? -1 : 1) * spec.step * (1 + Math.floor(Math.random() * 3))
    return Math.round(Math.max(spec.min, Math.min(spec.max, value + delta)))
  }
  const delta = (Math.random() < 0.5 ? -1 : 1) * spec.step * (1 + Math.random() * 2)
  return Math.max(spec.min, Math.min(spec.max, value + delta))
}

function randomIndividual(rng = Math.random) {
  const raw = {}
  for (const spec of IMPROVED_TUNABLE_SPECS) {
    raw[spec.key] = randomInSpec(spec, rng)
  }
  return normalizeImprovedConfig(raw)
}

function crossover(a, b) {
  const raw = {}
  for (const spec of IMPROVED_TUNABLE_SPECS) {
    raw[spec.key] = Math.random() < 0.5 ? a[spec.key] : b[spec.key]
  }
  return normalizeImprovedConfig(raw)
}

function mutate(cfg, mutationRate) {
  const raw = { ...cfg }
  for (const spec of IMPROVED_TUNABLE_SPECS) {
    raw[spec.key] = mutateGene(spec.key, raw[spec.key], mutationRate)
  }
  return normalizeImprovedConfig(raw)
}

function cloneConfig(cfg) {
  return normalizeImprovedConfig({ ...cfg })
}

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`
  return `${s}s`
}

function formatScore(score) {
  if (score.unsolved > 0) return `FAIL ${score.unsolved} unsolved`
  return `avg ${score.avgGuesses.toFixed(2)} total ${score.totalGuesses} min ${score.minGuesses} max ${score.maxGuesses}`
}

function loadSavedConfig(path) {
  if (!existsSync(path)) return null
  const data = JSON.parse(readFileSync(path, "utf8"))
  const cfg = data?.best?.config ?? data?.config
  return cfg ? normalizeImprovedConfig(cfg) : null
}

function saveBest(state, reason) {
  const payload = {
    savedAt: new Date().toISOString(),
    reason,
    generation: state.generation,
    seed: state.seed,
    count: state.count,
    difficulty: state.difficulty,
    evaluations: state.evaluations,
    elapsedMs: Date.now() - state.startedAt,
    best: state.bestScore,
    history: state.history.slice(-20),
  }
  writeFileSync(state.outPath, `${JSON.stringify(payload, null, 2)}\n`)
}

function tournamentSelect(scored, size) {
  let best = null
  for (let i = 0; i < size; i++) {
    const pick = scored[Math.floor(Math.random() * scored.length)]
    if (!best || pick.score.fitness < best.score.fitness) best = pick
  }
  return best
}

function buildInitialPopulation(args, loadedCfg) {
  const pop = []
  pop.push(cloneConfig(getDefaultImprovedConfig()))
  if (loadedCfg) pop.push(cloneConfig(loadedCfg))
  while (pop.length < args.population) {
    pop.push(randomIndividual())
  }
  return pop.slice(0, args.population)
}

function evolveGeneration(state, args, assignments) {
  const scored = []
  for (let i = 0; i < state.population.length; i++) {
    if (state.stopRequested) break
    const cfg = state.population[i]
    const score = evaluateImprovedConfig(assignments, cfg)
    state.evaluations++
    scored.push({ cfg, score })

    if (!state.bestScore || score.fitness < state.bestScore.fitness) {
      state.bestScore = score
      state.bestConfig = cloneConfig(score.config)
      console.log(
        `  [gen ${state.generation} ${i + 1}/${state.population.length}] NEW BEST: ${formatScore(score)}`,
      )
    } else if ((i + 1) % Math.max(1, Math.floor(state.population.length / 4)) === 0) {
      process.stdout.write(
        `\r  [gen ${state.generation} ${i + 1}/${state.population.length}] best avg ${state.bestScore.avgGuesses?.toFixed(2) ?? "FAIL"}   `,
      )
    }
  }
  if (!state.stopRequested) process.stdout.write("\n")

  scored.sort((a, b) => a.score.fitness - b.score.fitness)
  state.history.push({
    generation: state.generation,
    bestFitness: scored[0].score.fitness,
    bestAvg: scored[0].score.avgGuesses,
    bestSolved: scored[0].score.solved,
    populationAvgFitness:
      scored.reduce((sum, row) => sum + row.score.fitness, 0) / Math.max(1, scored.length),
  })

  const next = scored.slice(0, args.eliteCount).map((row) => cloneConfig(row.cfg))
  while (next.length < args.population && !state.stopRequested) {
    const p1 = tournamentSelect(scored, args.tournamentSize)
    const p2 = tournamentSelect(scored, args.tournamentSize)
    let child = crossover(p1.cfg, p2.cfg)
    child = mutate(child, args.mutationRate)
    next.push(child)
  }
  state.population = next.slice(0, args.population)

  const elapsed = Date.now() - state.startedAt
  const best = state.bestScore
  console.log(
    `gen ${String(state.generation).padStart(4)} | pop best ${formatScore(scored[0].score)} | ` +
      `global best ${formatScore(best)} | evals ${state.evaluations} | ${formatDuration(elapsed)}`,
  )

  if (state.generation % args.saveEvery === 0) {
    saveBest(state, "checkpoint")
  }
}

async function main() {
  const args = parseArgs(process.argv)
  const assignments = generateAssignments(args.seed, args.count, args.difficulty).map((row) => row.assignment)
  const loadedCfg = args.loadPath ? loadSavedConfig(args.loadPath) : null

  const state = {
    seed: args.seed,
    count: args.count,
    difficulty: args.difficulty,
    outPath: args.outPath,
    generation: 0,
    evaluations: 0,
    startedAt: Date.now(),
    stopRequested: false,
    population: buildInitialPopulation(args, loadedCfg),
    bestScore: null,
    bestConfig: null,
    history: [],
  }

  console.log("=== KingOfTheHill improved solver tuner ===")
  console.log(
    `assignments=${args.count} seed=${args.seed} difficulty=${args.difficulty} population=${args.population}`,
  )
  console.log(`tunable genes=${IMPROVED_TUNABLE_SPECS.length} out=${args.outPath}`)
  if (loadedCfg) console.log(`loaded seed config from ${args.loadPath}`)
  console.log("Ctrl+C saves best config and exits.\n")

  console.log("Evaluating baseline...")
  const baseline = evaluateImprovedConfig(assignments, getDefaultImprovedConfig())
  state.bestScore = baseline
  state.bestConfig = cloneConfig(baseline.config)
  state.evaluations = 1
  console.log(`baseline (defaults): ${formatScore(baseline)}\n`)

  if (loadedCfg) {
    const loadedScore = evaluateImprovedConfig(assignments, loadedCfg)
    state.evaluations++
    if (loadedScore.fitness < state.bestScore.fitness) {
      state.bestScore = loadedScore
      state.bestConfig = cloneConfig(loadedScore.config)
    }
    console.log(`loaded config: ${formatScore(loadedScore)}\n`)
  }

  const onStop = () => {
    if (state.stopRequested) return
    state.stopRequested = true
    console.log("\nStopping after current work...")
  }
  process.on("SIGINT", onStop)
  process.on("SIGTERM", onStop)

  while (!state.stopRequested && state.generation < args.generations) {
    state.generation++
    evolveGeneration(state, args, assignments)
  }

  saveBest(state, state.stopRequested ? "interrupt" : "complete")
  console.log(`\nSaved best config to ${args.outPath}`)
  console.log(formatScore(state.bestScore))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
