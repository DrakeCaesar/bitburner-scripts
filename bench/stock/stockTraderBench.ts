/**
 * Stock trader benchmark CLI: runs the real strategy (src/libraries/stock/trader.ts) against
 * the local Bitburner market model (bench/stock/stockMarketModel.ts).
 *
 * Bundle + run:
 *   pnpm run test:stock
 *   pnpm run test:stock -- --capital 10b --ticks 3000 --seeds 5
 *   pnpm run test:stock -- --compare                   (current strategy vs the frozen v1 baseline)
 *   pnpm run test:stock -- --compare --seed-range 1-100 (paired, same-seed comparison)
 *   pnpm run test:stock -- --strategy v1 --seeds 5     (baseline on its own)
 *   pnpm run test:stock -- --grid entry-edge=0.002,0.003 --grid max-positions=3,4
 *   pnpm run test:stock -- --selftest
 *
 * GUI: pnpm run stock:viz  ->  open bench/stock/stockTraderViz.html
 */

import { pathToFileURL } from "node:url"

import { mergeStockTraderConfig, type StockTraderConfig } from "@/libraries/stock/config.js"
import { buildConfigSummary } from "@/libraries/stock/trader.js"
import { buildConfigSummaryV3, type StockTraderV3Config } from "@/libraries/stock/traderV3.js"

import { MS_PER_STOCK_UPDATE, STOCK_MARKET_COMMISSION, StockMarketSim, createNsStub } from "./stockMarketModel.js"
import {
  DEFAULT_CAPITAL,
  DEFAULT_SEED,
  DEFAULT_TICKS,
  SEED_STRIDE,
  StockTuner,
  aggregate,
  cartesianConfigs,
  defaultsGenome,
  genomeKey,
  genomeV3Config,
  logGrowth,
  measureHeadroom,
  pairResults,
  pairedGain,
  randomSeeds,
  runHoldBaseline,
  runSelfTest,
  runTraderScenario,
  scoreGenome,
  stockGeneSpecs,
  type Aggregate,
  type BenchResult,
  type GenomeScore,
  type PairedGain,
  type PairedStats,
  type StockGeneSpec,
  type StockGenome,
  type StrategyId,
  type TuneGeneration,
} from "./stockBenchCore.js"

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type ConfigKey = keyof StockTraderConfig

interface ConfigFlagSpec {
  key: ConfigKey
  kind: "number" | "boolean"
}

const CONFIG_FLAGS: Record<string, ConfigFlagSpec> = {
  "money-keep": { key: "moneyKeep", kind: "number" },
  "entry-edge": { key: "entryEdge", kind: "number" },
  "exit-edge": { key: "exitEdge", kind: "number" },
  "no4s-entry-edge": { key: "no4sEntryEdge", kind: "number" },
  "no4s-rotate-margin": { key: "no4sRotateMargin", kind: "number" },
  "max-positions": { key: "maxPositions", kind: "number" },
  "max-weight": { key: "maxWeightPerSymbol", kind: "number" },
  "max-share-fraction": { key: "maxShareFraction", kind: "number" },
  "rotate-margin": { key: "rotateMargin", kind: "number" },
  "history-ticks": { key: "historyTicks", kind: "number" },
  "min-shares": { key: "minShares", kind: "number" },
  shorts: { key: "enableShorts", kind: "boolean" },
}

interface CliOptions {
  capital: number
  ticks: number
  seed: number
  seeds: number
  /** When set, seeds are exactly from..to inclusive instead of `seed + i * SEED_STRIDE`. */
  seedRange: { from: number; to: number } | null
  /** Draw the seeds from a deterministic pseudo-random stream instead of a fixed stride. */
  seedStream: number | null
  bitNode: number
  ownedSf8: number
  config: Partial<StockTraderConfig>
  strategy: StrategyId
  compare: boolean
  marketData: boolean
  baseline: "none" | "filtered" | "all"
  grid: { flag: string; key: ConfigKey; values: number[] }[]
  json: boolean
  quiet: boolean
  symbols: number
  selfTest: boolean
  help: boolean
  tune: boolean
  generations: number
  population: number
  tuneSeed: number
  /** Print the ideal-frictionless ceiling next to the run and say how much of it the run captured. */
  headroom: boolean
  /** v3 sizing knobs; empty means the v3 defaults. */
  v3: Partial<StockTraderV3Config>
}

const SUFFIX_MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  b: 1e9,
  t: 1e12,
  q: 1e15,
}

export function parseNumberArg(text: string): number {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([kmbtq])?$/i.exec(text.trim())
  if (!match) return NaN
  const value = Number(match[1])
  const suffix = match[2]?.toLowerCase()
  return suffix ? value * SUFFIX_MULTIPLIERS[suffix] : value
}

function requireNumber(flag: string, text: string | undefined): number {
  const value = text === undefined ? NaN : parseNumberArg(text)
  if (!Number.isFinite(value)) throw new Error(`--${flag} expects a number, got '${text ?? ""}'`)
  return value
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    capital: DEFAULT_CAPITAL,
    ticks: DEFAULT_TICKS,
    seed: DEFAULT_SEED,
    seeds: 1,
    seedRange: null,
    seedStream: null,
    bitNode: 8,
    ownedSf8: 3,
    config: {},
    strategy: "current",
    compare: false,
    marketData: true,
    baseline: "filtered",
    grid: [],
    json: false,
    quiet: false,
    symbols: 10,
    selfTest: false,
    help: false,
    tune: false,
    generations: 6,
    population: 6,
    tuneSeed: 1,
    headroom: false,
    v3: {},
  }

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    // pnpm 10 forwards a bare `--` separator through `pnpm run`; ignore it.
    if (raw === "--") continue
    if (!raw.startsWith("--")) throw new Error(`Unexpected argument '${raw}'`)
    const eq = raw.indexOf("=")
    const flag = (eq === -1 ? raw.slice(2) : raw.slice(2, eq)).toLowerCase()
    const nextValue = (): string => {
      if (eq !== -1) return raw.slice(eq + 1)
      const value = argv[++i]
      if (value === undefined) throw new Error(`--${flag} expects a value`)
      return value
    }

    switch (flag) {
      case "capital":
        options.capital = requireNumber(flag, nextValue())
        break
      case "ticks": {
        const text = nextValue()
        const ticks = Math.floor(requireNumber(flag, text))
        if (!(ticks >= 1)) throw new Error(`--ticks expects at least 1 update, got '${text}'`)
        options.ticks = ticks
        break
      }
      case "seed":
        options.seed = Math.floor(requireNumber(flag, nextValue()))
        break
      case "seeds":
        options.seeds = Math.max(1, Math.floor(requireNumber(flag, nextValue())))
        break
      case "seed-stream":
        options.seedStream = Math.max(1, Math.floor(requireNumber(flag, nextValue())))
        break
      case "seed-range": {
        const text = nextValue()
        const match = /^(\d+)\s*[-:.]\s*(\d+)$/.exec(text.trim())
        if (!match) throw new Error(`--seed-range expects <first>-<last>, got '${text}'`)
        const from = Number(match[1])
        const to = Number(match[2])
        if (to < from) throw new Error(`--seed-range ${from}-${to}: last seed is below the first`)
        options.seedRange = { from, to }
        options.seeds = to - from + 1
        break
      }
      case "node":
        options.bitNode = Math.floor(requireNumber(flag, nextValue()))
        break
      case "sf8":
        options.ownedSf8 = Math.floor(requireNumber(flag, nextValue()))
        break
      case "baseline": {
        const value = nextValue().toLowerCase()
        if (value !== "none" && value !== "filtered" && value !== "all") {
          throw new Error(`--baseline expects none|filtered|all, got '${value}'`)
        }
        options.baseline = value
        break
      }
      case "symbols":
        options.symbols = Math.max(0, Math.floor(requireNumber(flag, nextValue())))
        break
      case "strategy": {
        const raw = nextValue().toLowerCase()
        // "v2" is the name used everywhere in the docs and the GUI; "current" is the old spelling.
        const value = raw === "v2" ? "current" : raw
        if (value !== "current" && value !== "v1" && value !== "v3") {
          throw new Error(`--strategy expects v2|current|v1|v3, got '${raw}'`)
        }
        options.strategy = value
        break
      }
      case "v3-kelly":
        options.v3.tilt = requireNumber(flag, nextValue())
        break
      case "v3-band":
        options.v3.rebalanceBand = requireNumber(flag, nextValue())
        break
      case "v3-gross":
        options.v3.maxGrossWeight = requireNumber(flag, nextValue())
        break
      case "v3-reserve":
        options.v3.reserveFraction = requireNumber(flag, nextValue())
        break
      case "v3-select":
        nextValue()
        break
      case "compare":
        options.compare = true
        break
      case "no-4s":
        options.marketData = false
        break
      case "tune":
        options.tune = true
        break
      case "generations":
        options.generations = Math.max(1, Math.floor(requireNumber(flag, nextValue())))
        break
      case "population":
        options.population = Math.max(2, Math.floor(requireNumber(flag, nextValue())))
        break
      case "tune-seed":
        options.tuneSeed = Math.max(1, Math.floor(requireNumber(flag, nextValue())))
        break
      case "grid": {
        const spec = nextValue()
        const eqIdx = spec.indexOf("=")
        if (eqIdx === -1) throw new Error(`--grid expects <flag>=<v1,v2,...>, got '${spec}'`)
        const gridFlag = spec.slice(0, eqIdx).toLowerCase()
        const configFlag = CONFIG_FLAGS[gridFlag]
        if (!configFlag || configFlag.kind !== "number") {
          throw new Error(`--grid does not support '${gridFlag}' (numeric config flags only)`)
        }
        const values = spec
          .slice(eqIdx + 1)
          .split(",")
          .filter((part) => part.trim() !== "")
          .map((part) => requireNumber(gridFlag, part))
        if (values.length === 0) throw new Error(`--grid ${gridFlag} needs at least one value`)
        options.grid.push({ flag: gridFlag, key: configFlag.key, values })
        break
      }
      case "headroom":
        options.headroom = true
        break
      case "json":
        options.json = true
        break
      case "quiet":
        options.quiet = true
        break
      case "selftest":
        options.selfTest = true
        break
      case "help":
        options.help = true
        break
      default: {
        const configFlag = CONFIG_FLAGS[flag]
        if (!configFlag) throw new Error(`Unknown flag --${flag} (try --help)`)
        if (configFlag.kind === "boolean") {
          const text = eq !== -1 ? raw.slice(eq + 1) : argv[i + 1]?.startsWith("--") ? "1" : argv[++i] ?? "1"
          ;(options.config as Record<string, unknown>)[configFlag.key] = parseNumberArg(text) !== 0
        } else {
          ;(options.config as Record<string, unknown>)[configFlag.key] = requireNumber(flag, nextValue())
        }
        break
      }
    }
  }

  return options
}

const HELP = `Stock trader benchmark (local Bitburner market model)

Usage: pnpm run test:stock -- [options]

Market
  --capital <n>        Starting home cash (suffixes k/m/b/t/q, default 10b)
  --ticks <n>          Stock updates to simulate, 6s each, 1 or more (default 3000)
  --node <n>           BitNode number (default 8 so shorts are unlocked)
  --sf8 <level>        Source-File 8 level when not in BitNode 8 (default 3)

Seeds
  --seed <n>           First seed (default 1337)
  --seeds <n>          Number of seeds to run, same config (default 1); spaced by 9973
  --seed-stream <n>    Draw the seeds from deterministic pseudo-random stream n instead of the
                       fixed stride. Same stream and count always give the same seeds, a shorter
                       run is a prefix of a longer one, and this is what the GUI uses
  --seed-range <a-b>   Run exactly seeds a..b inclusive, e.g. --seed-range 1-100

Config overrides (defaults come from src/libraries/stock/config.ts)
  --entry-edge <f>        Min |(2*forecast-1)*volatility| to open (default 0.0025)
  --exit-edge <f>         Close when the edge falls to this (default 0)
  --no4s-entry-edge <f>   Entry threshold when there is no 4S data (default 0.004)
  --no4s-rotate-margin <f>  Rotation margin when there is no 4S data (default 100 = never)
  --max-positions <n>     Symbols held at once (default 4)
  --max-weight <f>        Cap on one symbol's share of net worth (default 0.34)
  --max-share-fraction <f>  Fraction of getMaxShares() per symbol (default 1)
  --rotate-margin <f>     Swap the weakest holding at this edge ratio (default 1.5)
  --history-ticks <n>     Updates averaged to estimate the edge without 4S (default 40)
  --min-shares <n>        Skip orders below this size (default 50)
  --money-keep <n>        Cash left untouched (default 1b)
  --shorts <0|1>          Enable short positions

Strategy
  --strategy <id>      v2 (alias current) | v1 (frozen baseline from traderV1.ts) | v3 (conviction sizing)
  --compare            Also run the earlier versions on the same seeds and print the difference,
                       plus the same-seed (paired) ratio and its 95% interval. v3 compares
                       against v2 and v1; v2 against v1
  --v3-kelly <f>       v3: weight tilt, 0 = equal weight, 1 = in proportion to edge (default 0)
  --v3-band <f>        v3: rebalance dead band as a share of net worth (default 0)
  --v3-gross <f>       v3: cap on the sum of position weights (default 1)
  --v3-reserve <f>     v3: cash reserve as a share of net worth (default 0.01)
  --no-4s              Model a player without 4S Market Data: no forecasts or volatilities,
                       so the edge is estimated from the last --history-ticks prices

Genetic tuning (searches the config for you, on the seeds given above)
  --tune               Run the search instead of a single config, for --strategy v2 (default) or
                       v3. Trains on the seeds from --seed-range/--seed-stream/--seeds, then
                       checks the winner against the shipped defaults on held-back seeds the
                       search never saw. v1 is frozen and has no genes
  --generations <n>    Generations to breed (default 6)
  --population <n>     Genomes per generation, at least 2 (default 6)
  --tune-seed <n>      Seed for the search's own random stream (default 1)

Reporting
  --baseline <mode>    none | filtered | all (buy-and-hold reference, default filtered)
  --headroom           Print the ideal frictionless ceiling for this horizon next to the run, and
                       how much of it the run captured. The ceiling is not reachable: tracking the
                       strongest edges means following a set that changes every few updates, and
                       the printout prices that turnover
  --symbols <n>        Per-symbol rows in single-seed output (default 10)
  --json               Machine-readable output
  --quiet              One line per run, no tables
  --selftest           Verify the market model against game formulas
  --help               Show this help

Grid sweeps (runs every combination across all seeds)
  --grid entry-edge=0.002,0.0025,0.003 --grid max-positions=3,4,5

GUI: pnpm run stock:viz  ->  open bench/stock/stockTraderViz.html
`

function seedList(options: CliOptions): number[] {
  if (options.seedRange) {
    const seeds: number[] = []
    for (let seed = options.seedRange.from; seed <= options.seedRange.to; seed++) seeds.push(seed)
    return seeds
  }
  // A stream draws the same seeds the GUI uses for the same stream and count.
  if (options.seedStream !== null) return randomSeeds(options.seedStream, options.seeds)
  return Array.from({ length: options.seeds }, (_, i) => options.seed + i * SEED_STRIDE)
}

function runSeeds(options: CliOptions, config: Partial<StockTraderConfig>, strategy: StrategyId): BenchResult[] {
  return seedList(options).map((seed) =>
    runTraderScenario(
      {
        seed,
        capital: options.capital,
        ticks: options.ticks,
        config,
        bitNode: options.bitNode,
        ownedSf8: options.ownedSf8,
        marketData: options.marketData,
        v3: options.v3,
      },
      strategy,
    ),
  )
}

/** Space-grouped digits: 12502852 -> "12 502 852". Used for every exact number the CLI prints. */
function groupDigits(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "n/a"
  const [whole, fraction] = value.toFixed(digits).split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+$)/g, " ")
  return fraction === undefined ? grouped : `${grouped}.${fraction}`
}

const moneyDigits = (value: number): number => (Math.abs(value) < 100 && value % 1 !== 0 ? 2 : 0)
const money = (value: number, digits?: number): string =>
  `${value < 0 ? "-" : ""}$${groupDigits(Math.abs(value), digits ?? moneyDigits(value))}`
const count = (value: number): string => groupDigits(value, 0)
const pct = (value: number): string => `${groupDigits(value * 100, 2)}%`
const signedPct = (value: number): string => `${value >= 0 ? "+" : "-"}${groupDigits(Math.abs(value) * 100, 2)}%`
const signedMoney = (value: number): string => `${value >= 0 ? "+" : "-"}${money(Math.abs(value))}`
const pad = (text: string, width: number, align: "left" | "right" = "right"): string =>
  align === "right" ? text.padStart(width) : text.padEnd(width)
const tableRow = (cells: readonly (string | number)[], widths: readonly number[], aligns: readonly ("left" | "right")[]): string =>
  cells.map((cell, i) => pad(String(cell), widths[i], aligns[i])).join("  ")

function gameHours(ticks: number): number {
  return (ticks * MS_PER_STOCK_UPDATE) / 3_600_000
}

/** Human name for a strategy id, used in the comparison lines. */
function strategyLabel(strategy: StrategyId): string {
  return strategy === "v3" ? "v3" : strategy === "v1" ? "v1 baseline" : "v2 (current)"
}

function seedLabel(options: CliOptions): string {
  const count = `${options.seeds} seed${options.seeds === 1 ? "" : "s"}`
  if (options.seedRange) return `seeds ${options.seedRange.from}-${options.seedRange.to} (${count})`
  if (options.seedStream !== null) return `seed stream ${options.seedStream} (${count})`
  return `seed ${options.seed} (${count})`
}

function printHeader(options: CliOptions, config: Partial<StockTraderConfig>): void {
  const sim = new StockMarketSim({ seed: options.seed, cash: options.capital })
  const ns = createNsStub(sim, {
    bitNode: options.bitNode,
    ownedSf8: options.ownedSf8,
    marketData: options.marketData,
  })
  const merged = mergeStockTraderConfig(config)
  console.log("=== stock trader benchmark (bitburner-src market model) ===")
  console.log(
    `market   ${sim.stocks.length} symbols | ${MS_PER_STOCK_UPDATE / 1000}s per update | 75-update cycles | ` +
      `commission ${money(STOCK_MARKET_COMMISSION)}`,
  )
  console.log(
    `run      ${seedLabel(options)} | capital ${money(options.capital)} | ` +
      `${count(options.ticks)} updates (${gameHours(options.ticks).toFixed(1)}h) | BitNode ${options.bitNode}`,
  )
  if (options.strategy === "v1") {
    console.log("strategy v1 baseline (frozen in bench/stock/traderV1.ts): long fcst 0.6/0.5, short 0.35/0.5, port 12%/sym")
    if (!options.marketData) {
      console.log("warning  v1 reads forecast/volatility directly and cannot run without 4S data")
    }
  } else if (options.strategy === "v3") {
    console.log(`strategy v3 ${buildConfigSummaryV3(ns as never, merged, options.v3)}`)
  } else {
    console.log(`strategy ${buildConfigSummary(ns as never, merged)}`)
  }
}

/** Guards that explain a run which cannot mean anything. Printed in every mode, including --quiet. */
function printWarnings(options: CliOptions, merged: StockTraderConfig): void {
  if (options.capital <= merged.moneyKeep) {
    console.log(
      `warning  capital (${money(options.capital)}) is at or below money-keep (${money(merged.moneyKeep)}); ` +
        `the strategy cannot open positions. Raise --capital or lower --money-keep.`,
    )
  }
  if (!options.marketData && options.strategy === "current" && options.ticks <= merged.historyTicks) {
    console.log(
      `warning  the price-history estimate needs ${merged.historyTicks + 1} prices to fill its window; ` +
        (options.ticks < 4
          ? `with ${options.ticks} update(s) it never collects enough samples, so the run stays entirely in cash.`
          : `with ${options.ticks} updates it only trades on a partial window ` +
            `(full window reached at update ${merged.historyTicks + 1}).`),
    )
  }
  if (options.ticks < 2) {
    console.log("warning  1 update is a single decision; there is nothing to chart and the result is one draw")
  }
}

function printRun(result: BenchResult, options: CliOptions): void {
  console.log(`\n--- seed ${result.seed} ---`)
  console.log(`net worth        ${money(result.finalNetWorth)}  (start ${money(result.capital)})`)
  console.log(`profit           ${signedMoney(result.profit)}  (${signedPct(result.returnPct)})`)
  console.log(
    `max drawdown     -${pct(result.maxDrawdownPct)}  (${signedMoney(-result.maxDrawdown)})  peak ${money(result.peakNetWorth)}`,
  )
  console.log(`cash / positions ${money(result.finalCash)} / ${money(result.finalPositionsValue)}`)
  console.log(
    `trades           ${count(result.trades)} (${count(result.buys)} buy, ${count(result.sells)} sell, ` +
      `${count(result.shorts)} short, ${count(result.covers)} cover)`,
  )
  console.log(`commission       ${money(result.commissionPaid)}`)
  console.log(
    `realized / unreal ${signedMoney(result.realizedProfit)} / ${signedMoney(result.unrealizedProfit)}`,
  )
  console.log(
    `win rate         ${result.winRate === null ? "n/a" : pct(result.winRate)} of ${result.sells + result.covers} closed legs`,
  )
  console.log(`avg hold         ${result.avgHoldTicks === null ? "n/a" : `${result.avgHoldTicks.toFixed(1)} updates`}`)
  console.log(
    `exposure         ${pct(result.exposureAvgPct)} avg | ${pct(result.flatTickPct)} flat | ${result.avgOpenPositions.toFixed(1)} symbols avg`,
  )

  const traded = result.perSymbol.filter((s) => s.trades > 0)
  if (traded.length > 0 && options.symbols > 0) {
    console.log("\nsymbol   trades         P/L  position")
    const rows = traded.slice(0, options.symbols)
    const worst = traded.slice(-Math.min(options.symbols, traded.length)).filter((s) => !rows.includes(s))
    for (const row of [...rows, ...worst]) {
      const position =
        row.openShares > 0
          ? `L ${count(row.openShares)}`
          : row.openShortShares > 0
            ? `S ${count(row.openShortShares)}`
            : "-"
      console.log(`${pad(row.symbol, 6, "left")} ${pad(count(row.trades), 7)} ${pad(signedMoney(row.profit), 16)}  ${position}`)
    }
  }
}

function printAggregate(results: readonly BenchResult[], label: string): void {
  const stats = aggregate(results)
  console.log(`\n--- ${label} (${stats.runs} run${stats.runs === 1 ? "" : "s"}) ---`)
  console.log(
    `return  mean ${signedPct(stats.meanReturnPct)} | median ${signedPct(stats.medianReturnPct)} | ` +
      `std ${pct(stats.stdReturnPct)} | min ${signedPct(stats.minReturnPct)} | max ${signedPct(stats.maxReturnPct)}`,
  )
  console.log(
    `risk    mean max drawdown -${pct(stats.meanMaxDrawdownPct)} | worst -${pct(stats.worstMaxDrawdownPct)}`,
  )
  console.log(
    `capital ${pct(stats.meanExposurePct)} of net worth in positions | ${pct(stats.meanFlatTickPct)} of ticks flat` +
      (stats.meanTrades > 0 && stats.meanExposurePct < 0.5
        ? "  <- share caps bind: extra time cannot compound"
        : ""),
  )
  console.log(
    `churn   ${count(stats.meanTrades)} trades avg | ${money(stats.meanCommission)} commission avg | net worth ${money(stats.meanNetWorth)} avg`,
  )
}

/** Labels matter here: v3 is compared against v2 as well as v1, so the ratio cannot say "current/v1". */
function printPaired(stats: PairedStats, better: string, baseline: string): void {
  const ratio = (value: number): string => `${value >= 100 ? groupDigits(Math.round(value)) : value.toFixed(2)}x`
  const verdict =
    stats.lowRatio > 1
      ? `${better} is better on average (95% interval excludes 1x)`
      : stats.highRatio < 1
        ? `${baseline} is better on average (95% interval excludes 1x)`
        : `no measurable difference at this horizon (interval spans 1x)`
  console.log(
    `\npaired  net worth ratio ${better} / ${baseline}, same seed: ${stats.wins}/${stats.runs} seeds better | ` +
      `geometric mean ${ratio(stats.geometricRatio)} (95% ${ratio(stats.lowRatio)} - ${ratio(stats.highRatio)}) | ` +
      `median ${ratio(stats.medianRatio)}`,
  )
  console.log(`verdict ${verdict}`)
}

function printSeedTable(results: readonly BenchResult[]): void {
  console.log("\n      seed          return    maxDD    trades        commission             net worth")
  for (const result of results) {
    console.log(
      tableRow(
        [
          result.seed,
          signedPct(result.returnPct),
          `-${pct(result.maxDrawdownPct)}`,
          count(result.trades),
          money(result.commissionPaid),
          money(result.finalNetWorth),
        ],
        [10, 16, 9, 9, 18, 21],
        ["right", "right", "right", "right", "right", "right"],
      ),
    )
  }
}

interface GridRow {
  config: Partial<StockTraderConfig>
  stats: Aggregate
}

function printGrid(rows: readonly GridRow[], options: CliOptions): void {
  console.log(`\n--- grid sweep: ${rows.length} configs x ${options.seeds} seeds, ranked by mean return ---`)
  const headers = [...options.grid.map((g) => g.flag), "mean", "median", "std", "meanDD", "trades", "commission"]
  const aligns: ("left" | "right")[] = headers.map(() => "right")
  const configText = (value: number): string => (Number.isInteger(value) ? groupDigits(value) : String(value))
  const body = rows.map((row) => [
    ...options.grid.map((g) => configText(Number(row.config[g.key]))),
    signedPct(row.stats.meanReturnPct),
    signedPct(row.stats.medianReturnPct),
    pct(row.stats.stdReturnPct),
    `-${pct(row.stats.meanMaxDrawdownPct)}`,
    count(row.stats.meanTrades),
    money(row.stats.meanCommission),
  ])
  const widths = headers.map((header, i) =>
    Math.max(header.length, 10, ...body.map((cells) => (cells[i] ?? "").length)),
  )
  console.log(tableRow(headers, widths, aligns))
  console.log("-".repeat(widths.reduce((a, b) => a + b, 0) + 2 * (widths.length - 1)))

  for (const cells of body) console.log(tableRow(cells, widths, aligns))
}

// ---------------------------------------------------------------------------
// Genetic tuning
// ---------------------------------------------------------------------------

function printGenome(genome: StockGenome, specs: readonly StockGeneSpec[]): string {
  return specs
    .map((spec) => {
      const value = genome[spec.key]
      const text =
        spec.kind === "bool"
          ? value
            ? "on"
            : "off"
          : spec.kind === "int"
            ? String(value ?? 0)
            : Number(value ?? 0).toFixed(spec.digits)
      return `${spec.label} ${text}`
    })
    .join(", ")
}

function printTuneRows(report: TuneGeneration, specs: readonly StockGeneSpec[], started: number): void {
  const headers = ["rank", ...specs.map((spec) => spec.label), "growth", "+-se", "vs default", "maxDD"]
  const body = report.rows.map((row) => [
    String(row.rank),
    ...specs.map((spec) => {
      const value = row.genome[spec.key]
      return spec.kind === "bool"
        ? value
          ? "on"
          : "off"
        : spec.kind === "int"
          ? String(value)
          : Number(value).toFixed(spec.digits)
    }),
    signedPct(row.score.growthPct),
    `+-${groupDigits(row.score.se * 100, 2)}%`,
    row.gain ? `${signedPct(Math.expm1(row.gain.diff))} +-${groupDigits(row.gain.se * 100, 2)}%` : "-",
    `-${pct(row.score.meanDrawdownPct)}`,
  ])
  const widths = headers.map((header, i) => Math.max(header.length, ...body.map((cells) => (cells[i] ?? "").length)))
  const aligns: ("left" | "right")[] = headers.map(() => "right")
  const leader = report.rows[0]
  console.log(
    `\ngen ${report.index}/${report.generations}  best ${signedPct(leader.score.growthPct)}` +
      (leader.gain ? ` (${signedPct(Math.expm1(leader.gain.diff))} vs default)` : "") +
      `  [${report.cached} reused, ${report.evaluated} measured]` +
      (report.improved ? "  <- new best" : ""),
  )
  console.log(tableRow(headers, widths, aligns))
  console.log("-".repeat(widths.reduce((a, b) => a + b, 0) + 2 * (widths.length - 1)))
  for (const cells of body) console.log(tableRow(cells, widths, aligns))
  console.log(`elapsed ${((performance.now() - started) / 1000).toFixed(1)}s`)
}

function runTune(options: CliOptions): number {
  if (options.strategy === "v1") {
    throw new Error("--tune searches v2 or v3; v1 is frozen in bench/stock/traderV1.ts and has no genes")
  }
  const family = options.strategy === "v3" ? "v3" : "v2"
  const specs = stockGeneSpecs(options.marketData, family)
  // Tuning on one seed is meaningless: the fitness would be a single market's opinion. When
  // the caller did not ask for a seed set, use a contiguous block so a run is still a search.
  const requested = seedList(options)
  const trainSeeds = requested.length >= 4 ? requested : Array.from({ length: 16 }, (_, i) => options.seed + i)
  const tuner = new StockTuner({
    specs,
    population: options.population,
    generations: options.generations,
    seed: options.tuneSeed,
    trainSeeds,
  })
  const merged = mergeStockTraderConfig(options.config)
  const started = performance.now()

  console.log("=== stock trader tuner (bitburner-src market model) ===")
  console.log(
    `market   ${new StockMarketSim({ seed: trainSeeds[0], cash: options.capital }).stocks.length} symbols | ` +
      `${MS_PER_STOCK_UPDATE / 1000}s per update | 75-update cycles | commission ${money(STOCK_MARKET_COMMISSION)}`,
  )
  console.log(
    `run      ${seedLabel(options)} | capital ${money(options.capital)} | ` +
      `${count(options.ticks)} updates (${gameHours(options.ticks).toFixed(1)}h) | BitNode ${options.bitNode}`,
  )
  console.log(
    `search   ${options.population} genomes x ${options.generations} generations, ` +
      `${trainSeeds.length} training seed${trainSeeds.length === 1 ? "" : "s"}, ` +
      `${tuner.validationSeeds.length} held back | search seed ${options.tuneSeed}`,
  )
  console.log(`strategy ${strategyLabel(options.strategy)}`)
  console.log(`genes    ${specs.map((spec) => `${spec.label} ${spec.min}-${spec.max}`).join(", ")}`)
  console.log(`fitness  mean log growth over the training seeds (geometric mean return), tie-break lower drawdown`)
  console.log(`mode     ${options.marketData ? "4S forecast" : "no 4S, edge from price history"}`)
  if (merged.moneyKeep > 0) console.log(`fixed    money keep ${money(merged.moneyKeep)}, min shares ${count(merged.minShares)}`)

  const runGenome = (genome: StockGenome, seeds: readonly number[]): GenomeScore => {
    const config = tuner.config(genome, options.config)
    const v3 = family === "v3" ? tuner.v3Config(genome, options.v3) : undefined
    const results = seeds.map((seed) =>
      runTraderScenario(
        {
          seed,
          capital: options.capital,
          ticks: options.ticks,
          config,
          bitNode: options.bitNode,
          ownedSf8: options.ownedSf8,
          marketData: options.marketData,
          ...(v3 ? { v3 } : {}),
        },
        family === "v3" ? "v3" : "current",
      ),
    )
    return scoreGenome(genomeKey(genome, specs), results)
  }

  while (!tuner.finished) {
    const scores = new Map<string, GenomeScore>()
    for (const item of tuner.pending()) scores.set(item.key, runGenome(item.genome, trainSeeds))
    printTuneRows(tuner.commit(scores), specs, started)
  }

  const best = tuner.best
  if (!best) throw new Error("the search produced no genome")
  const tuned = runGenome(best.genome, tuner.validationSeeds)
  const baseline = runGenome(defaultsGenome(specs), tuner.validationSeeds)
  const gain = pairedGain(tuned.results, baseline.results)
  const ratio = Math.exp(tuned.logGrowth - baseline.logGrowth)

  console.log(`\nvalidated on ${count(tuner.validationSeeds.length)} held-back seeds:`)
  console.log(
    `  tuned    ${signedPct(tuned.growthPct)} +-${groupDigits(tuned.se * 100, 2)}%  ` +
      `median ${signedPct(tuned.medianGrowthPct)}  maxDD -${pct(tuned.meanDrawdownPct)}`,
  )
  console.log(
    `  default  ${signedPct(baseline.growthPct)} +-${groupDigits(baseline.se * 100, 2)}%  ` +
      `median ${signedPct(baseline.medianGrowthPct)}  maxDD -${pct(baseline.meanDrawdownPct)}`,
  )
  if (gain) {
    console.log(
      `  paired   ${signedPct(Math.expm1(gain.diff))} +-${groupDigits(gain.se * 100, 2)}% per seed, ` +
        `better on ${count(gain.wins)}/${count(gain.runs)} seeds  (growth ratio ${groupDigits(ratio, 2)}x)`,
    )
  }
  console.log(`\nbest genome: ${printGenome(best.genome, specs)}`)
  if (options.json) console.log(JSON.stringify({ genome: best.genome, tuned, baseline, gain }, null, 2))
  console.log(`\nelapsed ${((performance.now() - started) / 1000).toFixed(1)}s`)
  return 0
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): number {
  let options: CliOptions
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }

  if (options.help) {
    console.log(HELP)
    return 0
  }

  if (options.selfTest) {
    const failures = runSelfTest()
    if (failures.length > 0) {
      console.error(`self-test FAILED (${failures.length})`)
      for (const failure of failures) console.error(`  - ${failure}`)
      return 1
    }
    console.log("self-test OK")
    return 0
  }

  const started = performance.now()
  try {
    if (options.tune) {
      if (options.grid.length > 0) throw new Error("--tune searches the config itself; it does not combine with --grid")
      return runTune(options)
    }
    if (options.grid.length > 0) {
      const grid: Record<string, readonly number[]> = {}
      for (const entry of options.grid) {
        const key = entry.key as string
        grid[key] = [...(grid[key] ?? []), ...entry.values]
      }
      const configs = cartesianConfigs(
        options.config,
        grid as Parameters<typeof cartesianConfigs>[1],
      )
      const rows: GridRow[] = configs.map((config) => ({
        config,
        stats: aggregate(runSeeds(options, config, options.strategy)),
      }))
      rows.sort((a, b) => b.stats.meanReturnPct - a.stats.meanReturnPct)

      if (options.json) {
        console.log(JSON.stringify(rows.map((row) => ({ config: row.config, stats: row.stats })), null, 2))
      } else {
        if (!options.quiet) printHeader(options, options.config)
        printGrid(rows, options)
        console.log(`\nelapsed ${((performance.now() - started) / 1000).toFixed(2)}s`)
      }
      return 0
    }

    const results = runSeeds(options, options.config, options.strategy)
    // v3 is judged against both earlier versions; v2 against v1; nothing compares to itself.
    const opponents: { label: string; strategy: StrategyId }[] =
      options.compare && options.strategy === "v3"
        ? [
            { label: "v2 (current)", strategy: "current" },
            { label: "v1 baseline", strategy: "v1" },
          ]
        : options.compare && options.strategy === "current"
          ? [{ label: "v1 baseline", strategy: "v1" }]
          : []
    const comparisons = opponents.map((opponent) => ({
      label: opponent.label,
      results: runSeeds(options, options.config, opponent.strategy),
    }))
    const v1Results = comparisons.find((entry) => entry.label === "v1 baseline")?.results ?? null
    const baselineFiltered =
      options.baseline === "none" ? null : runHoldBaseline({ ...options, seed: options.seed, config: options.config }, true)
    const baselineAll =
      options.baseline === "all" ? runHoldBaseline({ ...options, seed: options.seed, config: options.config }, false) : null

    if (options.json) {
      const stripCurve = ({ equityCurve: _curve, ...rest }: BenchResult): Omit<BenchResult, "equityCurve"> => rest
      console.log(
        JSON.stringify(
          {
            options,
            config: mergeStockTraderConfig(options.config),
            aggregate: aggregate(results),
            runs: results.map(stripCurve),
            v1: v1Results ? { aggregate: aggregate(v1Results), runs: v1Results.map(stripCurve) } : null,
            paired: v1Results && results.length > 1 ? pairResults(results, v1Results) : null,
            comparisons: comparisons.map((entry) => ({
              label: entry.label,
              aggregate: aggregate(entry.results),
              paired: results.length > 1 ? pairResults(results, entry.results) : null,
            })),
            baselines: {
              holdFiltered: baselineFiltered ? stripCurve(baselineFiltered) : null,
              holdAll: baselineAll ? stripCurve(baselineAll) : null,
            },
          },
          null,
          2,
        ),
      )
      return 0
    }

    if (!options.quiet) printHeader(options, options.config)
    printWarnings(options, mergeStockTraderConfig(options.config))

    if (options.quiet) {
      for (const result of results) {
        console.log(
          `seed ${String(result.seed).padStart(10)}  ${signedPct(result.returnPct).padStart(16)}  ` +
            `dd -${pct(result.maxDrawdownPct)}  trades ${count(result.trades).padStart(9)}  ${money(result.finalNetWorth)}`,
        )
      }
    } else if (results.length === 1) {
      printRun(results[0], options)
    } else {
      printSeedTable(results)
    }

    if (results.length > 1) printAggregate(results, "all seeds")

    for (const comparison of comparisons) {
      printAggregate(comparison.results, comparison.label)
      const mine = aggregate(results)
      const theirs = aggregate(comparison.results)
      console.log(
        `\n${comparison.label} -> ${options.strategy}: mean ${signedPct(theirs.meanReturnPct)} -> ${signedPct(mine.meanReturnPct)} ` +
          `(${theirs.meanReturnPct !== 0 ? `${(mine.meanReturnPct / theirs.meanReturnPct).toFixed(2)}x` : "n/a"}), ` +
          `trades ${count(theirs.meanTrades)} -> ${count(mine.meanTrades)}`,
      )
      if (results.length > 1) {
        const paired = pairResults(results, comparison.results)
        if (paired) printPaired(paired, strategyLabel(options.strategy), comparison.label)
      }
    }

    if (baselineFiltered) {
      console.log(
        `\nbaseline hold (filtered)  ${signedPct(baselineFiltered.returnPct)}  ` +
          `max dd -${pct(baselineFiltered.maxDrawdownPct)}  trades ${count(baselineFiltered.trades)}`,
      )
    }
    if (baselineAll) {
      console.log(
        `baseline hold (all)       ${signedPct(baselineAll.returnPct)}  ` +
          `max dd -${pct(baselineAll.maxDrawdownPct)}  trades ${count(baselineAll.trades)}`,
      )
    }

    if (options.headroom) {
      const slots = mergeStockTraderConfig(options.config).maxPositions
      const report = measureHeadroom(
        {
          seed: options.seed,
          ticks: options.ticks,
          capital: options.capital,
          bitNode: options.bitNode,
          ownedSf8: options.ownedSf8,
        },
        slots,
      )
      const achieved = logGrowth(results)
      console.log(
        `\nheadroom  ideal ${slots}-slot trader with no costs: ${signedPct(Math.expm1(report.top4Log))}` +
          `   ideal 1-slot: ${signedPct(Math.expm1(report.top1Log))}`,
      )
      console.log(
        `          this run got ${signedPct(Math.expm1(achieved))}, ` +
          `${((achieved / report.top4Log) * 100).toFixed(1)}% of the ideal in log terms`,
      )
      console.log(
        `          mean strongest edge ${pct(report.meanMaxEdge)}/update, mean top-${slots} sum ` +
          `${pct(report.meanTop4Edge)}/update, mean spread ${pct(report.meanSpread)}/side`,
      )
      console.log(
        `          tracking the ideal needs ${count(report.top4Changes)} swaps at that spread, ` +
          `costing ${pct(-Math.expm1(report.trackingCostLog))} of the portfolio`,
      )
      if (options.json) console.log(JSON.stringify({ headroom: report, achievedLogGrowth: achieved }, null, 2))
    }

    console.log(`\nelapsed ${((performance.now() - started) / 1000).toFixed(2)}s`)
    return 0
  } catch (error) {
    console.error(`error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    return 1
  }
}

const invokedPath = process.argv[1]
const isDirectRun = invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href
if (isDirectRun) {
  process.exitCode = main()
}
