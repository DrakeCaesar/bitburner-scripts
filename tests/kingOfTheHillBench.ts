/**
 * KingOfTheHill benchmark — TypeScript equivalent of tests/koth_tune/python/bench.py
 *
 * Bundle + run:
 *   pnpm run test:koth:bench
 *   pnpm run test:koth:bench -- --count 10000 --workers 8
 */

import { cpus } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Worker } from "node:worker_threads"

import { DEFAULT_SEED, generateAssignments, runSolver } from "./kingOfTheHillCore.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKER_PATH = join(__dirname, "kingOfTheHillBenchWorker.mjs")

export const DEFAULT_BENCH_COUNT = 100_000
export const DEFAULT_DIFF_MIN = 1
export const DEFAULT_DIFF_MAX = 60

export interface BenchDifficultyResult {
  difficulty: number
  guesses: number[]
  unsolved: number
  seconds: number
}

export interface BenchStats {
  solved: number
  unsolved: number
  avg: number | null
  median: number | null
  min: number | null
  max: number | null
  p95: number | null
  p99: number | null
}

export function summarizeGuesses(guesses: readonly number[]): BenchStats {
  const gs = [...guesses].sort((a, b) => a - b)
  const n = gs.length
  if (n === 0) {
    return { solved: 0, unsolved: 0, avg: null, median: null, min: null, max: null, p95: null, p99: null }
  }
  const sum = gs.reduce((a, b) => a + b, 0)
  return {
    solved: n,
    unsolved: 0,
    avg: sum / n,
    median: gs[Math.floor(n / 2)] ?? null,
    min: gs[0] ?? null,
    max: gs[n - 1] ?? null,
    p95: gs[Math.floor(0.95 * n)] ?? null,
    p99: gs[Math.floor(0.99 * n)] ?? null,
  }
}

export function benchDifficulty(seed: number, count: number, difficulty: number): BenchDifficultyResult {
  const rows = generateAssignments(seed, count, difficulty)
  const t0 = performance.now()
  const guesses: number[] = []
  let unsolved = 0
  for (const { assignment } of rows) {
    const res = runSolver(assignment)
    if (res.solved) guesses.push(res.guesses)
    else unsolved++
  }
  guesses.sort((a, b) => a - b)
  return {
    difficulty,
    guesses,
    unsolved,
    seconds: (performance.now() - t0) / 1000,
  }
}

export function formatBenchRow(difficulty: number, guesses: readonly number[], unsolved: number, seconds: number): string {
  const stats = summarizeGuesses(guesses)
  const dash = "\u2014"
  if (stats.solved > 0) {
    return (
      `${String(difficulty).padStart(4)}  ${String(stats.solved).padStart(6)}  ${String(unsolved).padStart(8)}  ` +
      `${stats.avg!.toFixed(2).padStart(7)}  ${String(stats.median).padStart(6)}  ` +
      `${String(stats.min).padStart(5)}  ${String(stats.max).padStart(5)}  ` +
      `${String(stats.p95).padStart(5)}  ${String(stats.p99).padStart(5)}  ` +
      `${seconds.toFixed(1).padStart(5)}s`
    )
  }
  return (
    `${String(difficulty).padStart(4)}  ${String(0).padStart(6)}  ${String(unsolved).padStart(8)}  ` +
    `${dash.padStart(7)}  ${dash.padStart(6)}  ${dash.padStart(5)}  ${dash.padStart(5)}  ` +
    `${dash.padStart(5)}  ${dash.padStart(5)}  ${seconds.toFixed(1).padStart(5)}s`
  )
}

export const BENCH_HEADER =
  `${"diff".padStart(4)}  ${"solved".padStart(6)}  ${"unsolved".padStart(8)}  ${"avg".padStart(7)}  ` +
  `${"median".padStart(6)}  ${"min".padStart(5)}  ${"max".padStart(5)}  ${"p95".padStart(5)}  ` +
  `${"p99".padStart(5)}  ${"time".padStart(6)}`

export interface BenchOptions {
  seed?: number
  count?: number
  diffMin?: number
  diffMax?: number
  workers?: number
  onProgress?: (done: number, total: number) => void
}

function runDifficultyInWorker(
  seed: number,
  count: number,
  difficulty: number,
): Promise<BenchDifficultyResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData: { seed, count, difficulty } })
    worker.on("message", (msg: BenchDifficultyResult) => resolve(msg))
    worker.on("error", reject)
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`bench worker for difficulty ${difficulty} exited with code ${code}`))
    })
  })
}

export async function runBenchmark(options: BenchOptions = {}): Promise<{
  results: BenchDifficultyResult[]
  totalSeconds: number
}> {
  const seed = options.seed ?? DEFAULT_SEED
  const count = options.count ?? DEFAULT_BENCH_COUNT
  const diffMin = options.diffMin ?? DEFAULT_DIFF_MIN
  const diffMax = options.diffMax ?? DEFAULT_DIFF_MAX
  const workers = Math.max(1, options.workers ?? cpus().length)
  const difficulties = Array.from({ length: diffMax - diffMin + 1 }, (_, i) => diffMin + i)

  const tTotal = performance.now()
  const results: BenchDifficultyResult[] = []
  let done = 0
  const total = difficulties.length

  const report = () => options.onProgress?.(done, total)

  if (workers <= 1) {
    for (const difficulty of difficulties) {
      results.push(benchDifficulty(seed, count, difficulty))
      done++
      report()
    }
  } else {
    let next = 0
    await Promise.all(
      Array.from({ length: Math.min(workers, total) }, async () => {
        for (;;) {
          const i = next++
          if (i >= total) break
          const difficulty = difficulties[i]!
          const row = await runDifficultyInWorker(seed, count, difficulty)
          results.push(row)
          done++
          report()
        }
      }),
    )
  }

  results.sort((a, b) => a.difficulty - b.difficulty)
  return { results, totalSeconds: (performance.now() - tTotal) / 1000 }
}

function parseArgs(argv: string[]) {
  let seed = DEFAULT_SEED
  let count = DEFAULT_BENCH_COUNT
  let diffMin = DEFAULT_DIFF_MIN
  let diffMax = DEFAULT_DIFF_MAX
  let workers = cpus().length
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if ((arg === "--seed" || arg === "-s") && argv[i + 1]) seed = Number(argv[++i])
    else if ((arg === "--count" || arg === "-n") && argv[i + 1]) count = Number(argv[++i])
    else if (arg === "--diff-min" && argv[i + 1]) diffMin = Number(argv[++i])
    else if (arg === "--diff-max" && argv[i + 1]) diffMax = Number(argv[++i])
    else if ((arg === "--workers" || arg === "-w") && argv[i + 1]) workers = Number(argv[++i])
    else if (arg === "--sequential") workers = 1
  }
  return { seed, count, diffMin, diffMax, workers }
}

function printProgress(done: number, total: number) {
  const pct = (done / total) * 100
  const bar = "#".repeat(done) + ".".repeat(total - done)
  process.stdout.write(`\r  [${bar}] ${done}/${total}  (${pct.toFixed(0)}%)`)
}

async function main() {
  const { seed, count, diffMin, diffMax, workers } = parseArgs(process.argv)
  const sep = "-".repeat(BENCH_HEADER.length)

  console.log(`Benchmark  N=${count} per difficulty  workers=${workers}`)
  console.log(sep)
  console.log(BENCH_HEADER)
  console.log(sep)

  const { results, totalSeconds } = await runBenchmark({
    seed,
    count,
    diffMin,
    diffMax,
    workers,
    onProgress: printProgress,
  })

  process.stdout.write("\n")

  let failed = false
  for (const row of results) {
    if (row.unsolved > 0) failed = true
    console.log(formatBenchRow(row.difficulty, row.guesses, row.unsolved, row.seconds))
  }

  console.log(sep)
  console.log(`Total wall time: ${totalSeconds.toFixed(1)}s`)

  if (failed) process.exit(1)
}

const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
