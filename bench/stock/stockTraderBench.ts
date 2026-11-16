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

import { MS_PER_STOCK_UPDATE, STOCK_MARKET_COMMISSION, StockMarketSim, createNsStub } from "./stockMarketModel.js"
import {
  DEFAULT_CAPITAL,
  DEFAULT_SEED,
  DEFAULT_TICKS,
  SEED_STRIDE,
  aggregate,
  cartesianConfigs,
  pairResults,
  runHoldBaseline,
  runSelfTest,
  runTraderScenario,
  type Aggregate,
  type BenchResult,
  type PairedStats,
  type StrategyId,
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
        const value = nextValue().toLowerCase()
        if (value !== "current" && value !== "v1") {
          throw new Error(`--strategy expects current|v1, got '${value}'`)
        }
        options.strategy = value
        break
      }
      case "compare":
        options.compare = true
        break
      case "no-4s":
        options.marketData = false
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
  --strategy <id>      current | v1 (frozen baseline from traderV1.ts, default current)
  --compare            Also run v1 on the same seeds and print the difference, plus the
                       same-seed (paired) ratio and its 95% interval
  --no-4s              Model a player without 4S Market Data: no forecasts or volatilities,
                       so the edge is estimated from the last --history-ticks prices

Reporting
  --baseline <mode>    none | filtered | all (buy-and-hold reference, default filtered)
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
  if (!options.seedRange) return Array.from({ length: options.seeds }, (_, i) => options.seed + i * SEED_STRIDE)
  const seeds: number[] = []
  for (let seed = options.seedRange.from; seed <= options.seedRange.to; seed++) seeds.push(seed)
  return seeds
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

function seedLabel(options: CliOptions): string {
  const count = `${options.seeds} seed${options.seeds === 1 ? "" : "s"}`
  if (options.seedRange) return `seeds ${options.seedRange.from}-${options.seedRange.to} (${count})`
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

function printPaired(stats: PairedStats): void {
  const ratio = (value: number): string => `${value >= 100 ? groupDigits(Math.round(value)) : value.toFixed(2)}x`
  const verdict =
    stats.lowRatio > 1
      ? "current is better on average (95% interval excludes 1x)"
      : stats.highRatio < 1
        ? "v1 is better on average (95% interval excludes 1x)"
        : "no measurable difference at this horizon"
  console.log(
    `\npaired  net worth ratio current/v1, same seed: ${stats.wins}/${stats.runs} seeds better | ` +
      `geometric mean ${ratio(stats.geometricRatio)} (95% ${ratio(stats.lowRatio)} - ${ratio(stats.highRatio)}) | ` +
      `median ${ratio(stats.medianRatio)}`,
  )
  console.log(`verdict ${verdict}`)
}

function printSeedTable(results: readonly BenchResult[]): void {
  console.log("\n    seed          return    maxDD    trades        commission             net worth")
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
        [8, 16, 9, 9, 18, 21],
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
    const v1Results =
      options.compare && options.strategy === "current" ? runSeeds(options, options.config, "v1") : null
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
          `seed ${String(result.seed).padStart(6)}  ${signedPct(result.returnPct).padStart(16)}  ` +
            `dd -${pct(result.maxDrawdownPct)}  trades ${count(result.trades).padStart(9)}  ${money(result.finalNetWorth)}`,
        )
      }
    } else if (results.length === 1) {
      printRun(results[0], options)
    } else {
      printSeedTable(results)
    }

    if (results.length > 1) printAggregate(results, "all seeds")

    if (v1Results) {
      printAggregate(v1Results, "v1 baseline")
      const current = aggregate(results)
      const v1 = aggregate(v1Results)
      console.log(
        `\nv1 -> current: mean ${signedPct(v1.meanReturnPct)} -> ${signedPct(current.meanReturnPct)} ` +
          `(${v1.meanReturnPct !== 0 ? `${(current.meanReturnPct / v1.meanReturnPct).toFixed(2)}x` : "n/a"}), ` +
          `trades ${count(v1.meanTrades)} -> ${count(current.meanTrades)}`,
      )
      if (results.length > 1) {
        const paired = pairResults(results, v1Results)
        if (paired) printPaired(paired)
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
