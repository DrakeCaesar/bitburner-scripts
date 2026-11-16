/**
 * Genetic tuning for the stock trader config, modelled on the ipvgo tuner
 * (`ipvgo-engine/cpp/game/game_cli.cpp`, `runTune`). The parts that matter, all kept:
 *
 * - **Common random numbers.** Every genome in a generation is measured on the *same* seeds,
 *   so a difference between two genomes is a difference in behaviour, not in which markets
 *   they happened to draw.
 * - **Pure fitness.** A genome's score depends only on the genome, so a genome seen in an
 *   earlier generation is reused from a cache instead of re-run. Elitism guarantees at least
 *   one such genome per generation once the search converges.
 * - **Elitism + tournament of two + uniform crossover + 40% mutation per gene**, with
 *   duplicates bred away (a duplicate measures the same seeds and returns the same number).
 * - **Held-back validation.** The winner is re-measured against the shipped defaults on seeds
 *   the search never saw, because a handful of seeds cannot separate close genomes.
 * - **Resume is safe.** A stored genome seeds the next population and already counts as
 *   measured, so a stop/start cycle continues from the best values instead of restarting.
 *
 * What differs from ipvgo: fitness here is continuous (money) rather than a win rate, so the
 * score is the mean log growth across seeds — the geometric mean, which is what compounding
 * actually does. Averaging plain returns would let one explosive seed decide a genome.
 */

import { DEFAULT_STOCK_TRADER_CONFIG, type StockTraderConfig } from "@/libraries/stock/config.js"

import { mulberry32 } from "./stockMarketModel.js"
import type { BenchResult } from "./stockBenchCore.js"

/** Config keys the search moves. Each one is a number in `StockTraderConfig`. */
export type StockGeneKey =
  | "entryEdge"
  | "exitEdge"
  | "rotateMargin"
  | "maxPositions"
  | "maxWeightPerSymbol"
  | "maxShareFraction"
  | "enableShorts"
  | "no4sEntryEdge"
  | "no4sRotateMargin"
  | "historyTicks"

export interface StockGeneSpec {
  key: StockGeneKey
  label: string
  kind: "int" | "float" | "bool"
  min: number
  max: number
  /** One mutation step. Breeding moves a gene by a small multiple of this. */
  step: number
  /** Decimals kept in the key and in the display, so equal genomes compare equal. */
  digits: number
}

// The knobs that shape decisions when the 4S forecast is available. Money plumbing
// (moneyKeep, minShares) is left alone: it is a scale question, not a strategy one, and
// tuning it here would only fit the starting capital of this run.
//
// The ranges are deliberately narrow. A wide box looks thorough and is worse: an entry edge
// above ~1.5%/tick never fires on the model (the strategy then never trades, so the genome
// scores a flat 0 and teaches the search nothing), and below ~0.1% it trades on noise. Both
// ends are measured, not guessed.
const PRICE_GENES: readonly StockGeneSpec[] = [
  { key: "entryEdge", label: "entry edge", kind: "float", min: 0.0005, max: 0.008, step: 0.0005, digits: 4 },
  { key: "exitEdge", label: "exit edge", kind: "float", min: -0.002, max: 0.002, step: 0.0005, digits: 4 },
  { key: "rotateMargin", label: "rotate margin", kind: "float", min: 1, max: 4, step: 0.25, digits: 2 },
  { key: "maxPositions", label: "max positions", kind: "int", min: 1, max: 8, step: 1, digits: 0 },
  { key: "maxWeightPerSymbol", label: "max weight/symbol", kind: "float", min: 0.1, max: 1, step: 0.05, digits: 2 },
  { key: "maxShareFraction", label: "max share fraction", kind: "float", min: 0.1, max: 1, step: 0.1, digits: 2 },
  { key: "enableShorts", label: "shorts", kind: "bool", min: 0, max: 1, step: 1, digits: 0 },
]

// Only reachable without 4S data, so they are only genes in that mode: a gene that cannot
// change the outcome would just be noise the search has to carry.
const HISTORY_GENES: readonly StockGeneSpec[] = [
  { key: "no4sEntryEdge", label: "entry edge (no 4S)", kind: "float", min: 0.001, max: 0.01, step: 0.001, digits: 3 },
  { key: "no4sRotateMargin", label: "rotate margin (no 4S)", kind: "float", min: 1, max: 200, step: 10, digits: 0 },
  { key: "historyTicks", label: "history updates", kind: "int", min: 5, max: 120, step: 5, digits: 0 },
]

/**
 * Smallest gap kept between the entry and exit thresholds. `exitEdge` at or above `entryEdge`
 * closes every position on the update after it opens: on the model that is a permanent 1-tick
 * churn loop worth about -90% over 3000 updates, whatever the market does. Random genomes land
 * there constantly, so the search clamps the pair instead of spending evaluations on it.
 */
const MIN_ENTRY_EXIT_GAP = 0.0005

export function stockGeneSpecs(marketData: boolean): StockGeneSpec[] {
  return marketData ? [...PRICE_GENES] : [...PRICE_GENES, ...HISTORY_GENES]
}

/** The genes in play, as a partial config plus booleans. */
export type StockGenome = Partial<Record<StockGeneKey, number | boolean>>

export function genomeConfig(genome: StockGenome): Partial<StockTraderConfig> {
  const config: Record<string, number | boolean> = {}
  for (const [key, value] of Object.entries(genome)) {
    if (value !== undefined) config[key] = value
  }
  return config as Partial<StockTraderConfig>
}

function geneValue(spec: StockGeneSpec, genome: StockGenome): number {
  const value = Number(genome[spec.key] ?? 0)
  return spec.kind === "bool" ? (value ? 1 : 0) : value
}

/** Identity of a genome: two genomes with the same key measure identically on the same seeds. */
export function genomeKey(genome: StockGenome, specs: readonly StockGeneSpec[]): string {
  return specs
    .map((spec) => {
      const value = geneValue(spec, genome)
      return `${spec.key}=${spec.kind === "bool" ? (value ? 1 : 0) : value.toFixed(spec.digits)}`
    })
    .join(",")
}

export function sameGenome(a: StockGenome, b: StockGenome, specs: readonly StockGeneSpec[]): boolean {
  return genomeKey(a, specs) === genomeKey(b, specs)
}

function snap(spec: StockGeneSpec, value: number): number {
  if (spec.kind === "bool") return value ? 1 : 0
  const clamped = Math.min(spec.max, Math.max(spec.min, value))
  if (spec.kind === "int") return Math.round(clamped)
  // Round to the display precision only. Snapping to the step grid here would quietly move the
  // shipped defaults (maxWeightPerSymbol 0.34 -> 0.35) and make "vs default" compare against a
  // config that does not exist; mutations add whole steps anyway, so they stay on the grid.
  return Number(clamped.toFixed(spec.digits))
}

export function clampGenome(genome: StockGenome, specs: readonly StockGeneSpec[]): StockGenome {
  const out: StockGenome = {}
  for (const spec of specs) {
    const value = snap(spec, geneValue(spec, genome))
    out[spec.key] = spec.kind === "bool" ? value === 1 : value
  }
  // Keep the entry/exit pair ordered. Snapping can push them together, so re-snap both after.
  const hasEntry = specs.some((spec) => spec.key === "entryEdge")
  const hasExit = specs.some((spec) => spec.key === "exitEdge")
  if (hasEntry && hasExit) {
    const entrySpec = specs.find((spec) => spec.key === "entryEdge") as StockGeneSpec
    const exitSpec = specs.find((spec) => spec.key === "exitEdge") as StockGeneSpec
    const entry = Number(out.entryEdge ?? 0)
    const exit = Number(out.exitEdge ?? 0)
    if (exit > entry - MIN_ENTRY_EXIT_GAP) {
      out.exitEdge = snap(exitSpec, Math.min(exitSpec.max, entry - MIN_ENTRY_EXIT_GAP))
    }
    if (Number(out.exitEdge) > Number(out.entryEdge) - MIN_ENTRY_EXIT_GAP && entrySpec.min <= exitSpec.max) {
      out.entryEdge = snap(entrySpec, Math.max(entrySpec.min, Number(out.exitEdge) + MIN_ENTRY_EXIT_GAP))
    }
  }
  return out
}

/** The shipped defaults, so a run always has the status quo to beat. */
export function defaultsGenome(specs: readonly StockGeneSpec[]): StockGenome {
  return clampGenome({ ...DEFAULT_STOCK_TRADER_CONFIG } as StockGenome, specs)
}

function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1))
}

function randomGeneValue(spec: StockGeneSpec, rng: () => number): number {
  if (spec.kind === "bool") return rng() < 0.5 ? 0 : 1
  if (spec.kind === "int") return randInt(rng, spec.min, spec.max)
  const steps = Math.max(0, Math.floor((spec.max - spec.min) / spec.step))
  return Number((spec.min + randInt(rng, 0, steps) * spec.step).toFixed(spec.digits))
}

export function randomGenome(specs: readonly StockGeneSpec[], rng: () => number): StockGenome {
  const genome: StockGenome = {}
  for (const spec of specs) {
    const value = randomGeneValue(spec, rng)
    genome[spec.key] = spec.kind === "bool" ? value === 1 : value
  }
  return genome
}

/** One child: uniform crossover per gene, then a 40% chance of nudging each gene. */
export function breedGenomes(
  mother: StockGenome,
  father: StockGenome,
  specs: readonly StockGeneSpec[],
  rng: () => number,
): StockGenome {
  const child: StockGenome = {}
  for (const spec of specs) {
    const fromMother = rng() < 0.5
    let value = geneValue(spec, fromMother ? mother : father)
    if (rng() < 0.4) {
      if (spec.kind === "bool") value = value ? 0 : 1
      else value += randInt(rng, -3, 3) * spec.step
    }
    const snapped = snap(spec, value)
    child[spec.key] = spec.kind === "bool" ? snapped === 1 : snapped
  }
  return child
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface GenomeScore {
  key: string
  runs: number
  /** Mean of log(final / capital) across seeds. The fitness: this is log geometric growth. */
  logGrowth: number
  /** exp(logGrowth) - 1, i.e. the geometric mean return, which is what one account would earn. */
  growthPct: number
  /** Middle seed's return, for reading against the mean. */
  medianGrowthPct: number
  meanDrawdownPct: number
  /** Standard error of `logGrowth`; how much of the gap between two genomes could be noise. */
  se: number
  results: BenchResult[]
}

/**
 * Per-seed difference against a reference genome on the *same* seeds, with the standard error
 * of that difference. This is the number that says whether a genome is actually better: the
 * unpaired spread above is dominated by how lucky the seed set is, while the paired
 * difference cancels it, exactly like the paired comparison the benchmark reports.
 */
export interface PairedGain {
  /** Mean per-seed log difference; exp() of it is the growth ratio. */
  diff: number
  se: number
  wins: number
  runs: number
}

export function pairedGain(genome: readonly BenchResult[], reference: readonly BenchResult[]): PairedGain | null {
  const bySeed = new Map(reference.map((result) => [result.seed, result]))
  const diffs: number[] = []
  for (const result of genome) {
    const other = bySeed.get(result.seed)
    if (!other) continue
    diffs.push(
      Math.log(Math.max(result.finalNetWorth, 1e-9) / Math.max(result.capital, 1)) -
        Math.log(Math.max(other.finalNetWorth, 1e-9) / Math.max(other.capital, 1)),
    )
  }
  if (diffs.length === 0) return null
  const diff = mean(diffs)
  const spread = diffs.length > 1 ? mean(diffs.map((value) => (value - diff) ** 2)) : 0
  return {
    diff,
    se: Math.sqrt(spread / Math.max(1, diffs.length)),
    wins: diffs.filter((value) => value > 0).length,
    runs: diffs.length,
  }
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  let total = 0
  for (const value of values) total += value
  return total / values.length
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

export function scoreGenome(key: string, results: readonly BenchResult[]): GenomeScore {
  const logs = results.map((result) => Math.log(Math.max(result.finalNetWorth, 1e-9) / Math.max(result.capital, 1)))
  const logGrowth = mean(logs)
  const spread = logs.length > 1 ? mean(logs.map((value) => (value - logGrowth) ** 2)) : 0
  return {
    key,
    runs: results.length,
    logGrowth,
    growthPct: Math.expm1(logGrowth),
    medianGrowthPct: median(results.map((result) => result.returnPct)),
    meanDrawdownPct: mean(results.map((result) => result.maxDrawdownPct)),
    se: Math.sqrt(spread / Math.max(1, logs.length)),
    results: [...results],
  }
}

function betterThan(a: GenomeScore, b: GenomeScore | null): boolean {
  if (!b) return true
  if (a.logGrowth !== b.logGrowth) return a.logGrowth > b.logGrowth
  // Same growth: prefer the one that got there with less pain.
  return a.meanDrawdownPct < b.meanDrawdownPct
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

export interface TuneRow {
  rank: number
  genome: StockGenome
  score: GenomeScore
  /** Improvement over the shipped defaults on the same seeds, when the defaults were measured. */
  gain: PairedGain | null
}

export interface TuneGeneration {
  /** 1-based index of the generation that was just measured. */
  index: number
  generations: number
  rows: TuneRow[]
  best: TuneRow
  /** True when this generation found a genome better than anything before it. */
  improved: boolean
  /** Genomes reused from the cache instead of being run again. */
  cached: number
  evaluated: number
}

export interface StockTunerOptions {
  specs: readonly StockGeneSpec[]
  population: number
  generations: number
  /** Seed for the search's own random stream: same seed, same sequence of populations. */
  seed: number
  /** The seeds every genome is measured on (common random numbers). */
  trainSeeds: readonly number[]
  /** Genome to resume from. It joins the population and its score is kept. */
  resume?: StockGenome | null
}

export interface PendingGenome {
  genome: StockGenome
  key: string
}

export class StockTuner {
  readonly specs: readonly StockGeneSpec[]
  readonly generations: number
  readonly trainSeeds: readonly number[]
  /** Seeds never used for the search, for the final comparison against the defaults. */
  readonly validationSeeds: readonly number[]

  private readonly rng: () => number
  private readonly size: number
  private readonly defaults: StockGenome
  private population: StockGenome[]
  private readonly measured = new Map<string, GenomeScore>()
  private currentGeneration = 0
  private incumbent: TuneRow | null = null
  private lastRows: TuneRow[] = []

  constructor(options: StockTunerOptions) {
    this.specs = options.specs
    this.generations = Math.max(1, Math.floor(options.generations))
    this.size = Math.max(2, Math.floor(options.population))
    this.trainSeeds = [...options.trainSeeds]
    if (this.trainSeeds.length === 0) throw new Error("tuning needs at least one training seed")
    this.rng = mulberry32(Math.max(1, Math.floor(options.seed) || 1))
    this.defaults = defaultsGenome(this.specs)
    // 3x the training set, at least 60, drawn away from the training seeds so the final
    // comparison is on markets the search never selected against.
    const validationCount = Math.max(this.trainSeeds.length * 3, 60)
    const used = new Set(this.trainSeeds)
    const validation: number[] = []
    while (validation.length < validationCount) {
      const seed = 1_000_000 + Math.floor(this.rng() * 2_000_000_000)
      if (!used.has(seed)) {
        used.add(seed)
        validation.push(seed)
      }
    }
    this.validationSeeds = validation
    this.population = this.initialPopulation(options.resume ?? null)
  }

  get generation(): number {
    return this.currentGeneration
  }

  get finished(): boolean {
    return this.currentGeneration >= this.generations
  }

  get best(): TuneRow | null {
    return this.incumbent
  }

  get ranked(): TuneRow[] {
    return this.lastRows
  }

  /** Scores the cache already holds, for genomes that need no further runs. */
  get measuredCount(): number {
    return this.measured.size
  }

  /** The shipped defaults, always part of the search so there is something to beat. */
  get defaultGenome(): StockGenome {
    return this.defaults
  }

  /** The defaults' score on the training seeds, once measured. */
  get reference(): GenomeScore | null {
    return this.measured.get(genomeKey(this.defaults, this.specs)) ?? null
  }

  /** The work for the current generation: genomes the cache has never scored. */
  pending(): PendingGenome[] {
    if (this.finished) return []
    const work: PendingGenome[] = []
    for (const genome of this.population) {
      const key = genomeKey(genome, this.specs)
      if (this.measured.has(key)) continue
      work.push({ genome, key })
    }
    return work
  }

  /** Store the measured scores, rank the generation, and breed the next population. */
  commit(scores: ReadonlyMap<string, GenomeScore>): TuneGeneration {
    if (this.finished) throw new Error("the search has already run all of its generations")
    let evaluated = 0
    for (const genome of this.population) {
      const key = genomeKey(genome, this.specs)
      if (this.measured.has(key)) continue
      const score = scores.get(key)
      if (!score) throw new Error(`no score for genome ${key}`)
      this.measured.set(key, score)
      evaluated++
    }

    const rows: TuneRow[] = this.population
      .map((genome) => {
        const key = genomeKey(genome, this.specs)
        const score = this.measured.get(key)
        if (!score) throw new Error(`genome ${key} was never scored`)
        return { rank: 0, genome, score, gain: null as PairedGain | null }
      })
      .map((row) => ({
        ...row,
        gain: this.reference ? pairedGain(row.score.results, this.reference.results) : null,
      }))
      .sort((a, b) => (betterThan(a.score, b.score) ? -1 : betterThan(b.score, a.score) ? 1 : 0))
      .map((row, index) => ({ ...row, rank: index + 1 }))

    this.currentGeneration++
    this.lastRows = rows
    const leader = rows[0]
    const improved = betterThan(leader.score, this.incumbent?.score ?? null)
    if (improved) this.incumbent = leader

    if (this.currentGeneration < this.generations) this.population = this.breed(rows)

    return {
      index: this.currentGeneration,
      generations: this.generations,
      rows,
      best: this.incumbent ?? leader,
      improved,
      cached: this.population.length - evaluated,
      evaluated,
    }
  }

  /** Apply a genome to a config, keeping whatever the caller set that is not a gene. */
  config(genome: StockGenome, base: Partial<StockTraderConfig> = {}): Partial<StockTraderConfig> {
    const genes = genomeConfig(genome)
    const out: Record<string, number | boolean> = { ...base }
    for (const [key, value] of Object.entries(genes)) out[key] = value
    return out as Partial<StockTraderConfig>
  }

  private initialPopulation(resume: StockGenome | null): StockGenome[] {
    const population: StockGenome[] = []
    const push = (genome: StockGenome): void => {
      const clamped = clampGenome(genome, this.specs)
      if (population.some((other) => sameGenome(other, clamped, this.specs))) return
      population.push(clamped)
    }

    // The shipped defaults always compete: a run has to have the status quo to beat, and
    // their score is what every other genome's gain is measured against.
    push(this.defaults)

    if (resume) {
      // Resume: the stored genome is an individual, and the rest of the first generation is
      // bred around it, so a stop/start cycle continues from the best values found so far.
      push(resume)
      let guard = 0
      while (population.length < this.size && guard++ < this.size * 400) {
        const nearby: StockGenome = {}
        for (const spec of this.specs) {
          const base = geneValue(spec, resume)
          if (spec.kind === "bool") nearby[spec.key] = this.rng() < 0.15 ? base === 0 : base === 1
          else nearby[spec.key] = base + randInt(this.rng, -4, 4) * spec.step
        }
        push(nearby)
      }
    }

    let guard = 0
    while (population.length < this.size && guard++ < this.size * 400) {
      push(randomGenome(this.specs, this.rng))
    }
    // Clamping at an edge can collapse the draws; fill whatever is left from anywhere.
    while (population.length < this.size) push(randomGenome(this.specs, this.rng))
    return population
  }

  private breed(rows: readonly TuneRow[]): StockGenome[] {
    const next: StockGenome[] = []
    const push = (genome: StockGenome): boolean => {
      const clamped = clampGenome(genome, this.specs)
      if (next.some((other) => sameGenome(other, clamped, this.specs))) return false
      next.push(clamped)
      return true
    }

    // Elitism: the best survives, and so does the runner-up when it is a different genome.
    push(rows[0].genome)
    if (rows.length > 1) push(rows[1].genome)

    const pick = (): StockGenome => {
      const a = rows[Math.floor(this.rng() * rows.length)]
      const b = rows[Math.floor(this.rng() * rows.length)]
      return betterThan(a.score, b.score) ? a.genome : b.genome
    }

    while (next.length < this.size) {
      let added = false
      // A child is a copy of a parent fairly often; retrying is far cheaper than measuring it.
      for (let attempt = 0; attempt < 24 && !added; attempt++) {
        added = push(breedGenomes(pick(), pick(), this.specs, this.rng))
      }
      // Converged: force one gene to a fresh value rather than accept a duplicate.
      for (let attempt = 0; attempt < 200 && !added; attempt++) {
        const spec = this.specs[Math.floor(this.rng() * this.specs.length)]
        const fresh: StockGenome = { ...(next[next.length - 1] ?? rows[0].genome) }
        const value = randomGeneValue(spec, this.rng)
        fresh[spec.key] = spec.kind === "bool" ? value === 1 : value
        added = push(fresh)
      }
      if (!added) break
    }
    return next
  }
}
