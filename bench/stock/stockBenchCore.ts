/**
 * Stock trader benchmark core: runs the real strategy (src/libraries/stock/trader.ts) against
 * the local Bitburner market model (bench/stock/stockMarketModel.ts).
 *
 * Pure and environment-free so both the CLI (bench/stock/stockTraderBench.ts) and the GUI
 * (bench/stock/stockTraderViz.template.html) share it. Bundle with build/bundleStockViz.cjs.
 */

import type { NS } from "@ns"
import {
  DEFAULT_STOCK_TRADER_CONFIG,
  mergeStockTraderConfig,
  type StockTraderConfig,
} from "@/libraries/stock/config.js"
import { createStockTraderState, runStockTradingTick } from "@/libraries/stock/trader.js"

import {
  STOCK_MARKET_COMMISSION,
  StockMarketSim,
  createNsStub,
  mulberry32,
  type SimTrade,
} from "./stockMarketModel.js"
import { TRADER_V1_CONFIG, runStockTradingTickV1 } from "./traderV1.js"

// Re-exported so the GUI bundle gets the config defaults and money formatter.
export { DEFAULT_STOCK_TRADER_CONFIG } from "@/libraries/stock/config.js"
export { formatNumber } from "./stockMarketModel.js"

export const DEFAULT_CAPITAL = 1e10
export const DEFAULT_TICKS = 3000
export const DEFAULT_SEED = 1337
export const SEED_STRIDE = 9973
export const MAX_GRID_COMBINATIONS = 500

export interface BenchOptions {
  seed: number
  capital: number
  ticks: number
  config: Partial<StockTraderConfig>
  bitNode: number
  ownedSf8: number
  /** Set false to model a player without the 4S Market Data TIX API (no forecasts, no volatilities). */
  marketData?: boolean
}

export interface SymbolStats {
  symbol: string
  trades: number
  profit: number
  openShares: number
  openShortShares: number
}

export interface BenchResult {
  seed: number
  capital: number
  ticks: number
  finalCash: number
  finalPositionsValue: number
  finalNetWorth: number
  profit: number
  returnPct: number
  maxDrawdown: number
  maxDrawdownPct: number
  peakNetWorth: number
  buys: number
  sells: number
  shorts: number
  covers: number
  trades: number
  commissionPaid: number
  realizedProfit: number
  unrealizedProfit: number
  winRate: number | null
  avgHoldTicks: number | null
  exposureAvgPct: number
  flatTickPct: number
  avgOpenPositions: number
  perSymbol: SymbolStats[]
  equityCurve: number[]
}

export interface Aggregate {
  runs: number
  meanReturnPct: number
  medianReturnPct: number
  stdReturnPct: number
  minReturnPct: number
  maxReturnPct: number
  meanMaxDrawdownPct: number
  worstMaxDrawdownPct: number
  meanTrades: number
  meanCommission: number
  meanNetWorth: number
  /** Average share of net worth actually invested. Low values mean the share caps, not the rules, bound us. */
  meanExposurePct: number
  /** Average share of ticks holding nothing at all. */
  meanFlatTickPct: number
}

export interface StrategyHooks {
  setup?: (sim: StockMarketSim) => void
  tick: (sim: StockMarketSim) => void
}

export function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = average(values)
  return Math.sqrt(average(values.map((v) => (v - mean) ** 2)))
}

function holdTimeStats(trades: readonly SimTrade[]): number | null {
  const openTick = new Map<string, number>()
  const position = new Map<string, number>()
  const holds: number[] = []

  for (const trade of trades) {
    const key = `${trade.symbol}:${trade.side}`
    const before = position.get(key) ?? 0
    const delta = trade.kind === "buy" || trade.kind === "short" ? trade.shares : -trade.shares
    const after = before + delta

    if (before === 0 && after > 0) openTick.set(key, trade.tick)
    if (before > 0 && after === 0) {
      const opened = openTick.get(key)
      if (opened !== undefined) holds.push(trade.tick - opened)
      openTick.delete(key)
    }
    position.set(key, after)
  }

  return holds.length > 0 ? average(holds) : null
}

function unrealizedAtMark(sim: StockMarketSim): number {
  let total = 0
  for (const stock of sim.stocks) {
    if (stock.playerShares > 0) total += (stock.price - stock.playerAvgPx) * stock.playerShares
    if (stock.playerShortShares > 0) {
      total += (stock.playerAvgShortPx - stock.price) * stock.playerShortShares
    }
  }
  return total
}

/** Runs one strategy against a fresh market and collects performance metrics. */
export function runScenario(
  options: BenchOptions,
  createHooks: (sim: StockMarketSim) => StrategyHooks,
): BenchResult {
  const sim = new StockMarketSim({ seed: options.seed, cash: options.capital })
  const hooks = createHooks(sim)
  const equityCurve: number[] = []
  const exposures: number[] = []
  const openPositionCounts: number[] = []

  sim.updatePrices()
  hooks.setup?.(sim)

  let peak = Math.max(options.capital, sim.netWorth())
  let maxDrawdown = 0
  let maxDrawdownPct = 0
  let flatTicks = 0

  for (let i = 0; i < options.ticks; i++) {
    if (i > 0) sim.updatePrices()
    hooks.tick(sim)

    const netWorth = sim.netWorth()
    equityCurve.push(netWorth)
    peak = Math.max(peak, netWorth)
    const drawdown = peak - netWorth
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
      maxDrawdownPct = peak > 0 ? drawdown / peak : 0
    }
    const positionsValue = sim.positionsValue()
    exposures.push(netWorth > 0 ? positionsValue / netWorth : 0)
    openPositionCounts.push(sim.stocks.filter((s) => s.playerShares > 0 || s.playerShortShares > 0).length)
    if (!sim.hasAnyPosition()) flatTicks++
  }

  const closingTrades = sim.trades.filter((t) => t.kind === "sell" || t.kind === "cover")
  const wins = closingTrades.filter((t) => t.realized > 0).length
  const finalNetWorth = sim.netWorth()
  const finalPositionsValue = sim.positionsValue()

  const perSymbol: SymbolStats[] = sim.stocks
    .map((stock) => {
      const stats = sim.symbolProfit(stock.symbol)
      return {
        symbol: stock.symbol,
        trades: stats.trades,
        profit: stats.profit,
        openShares: stock.playerShares,
        openShortShares: stock.playerShortShares,
      }
    })
    .sort((a, b) => b.profit - a.profit)

  return {
    seed: options.seed,
    capital: options.capital,
    ticks: options.ticks,
    finalCash: sim.cash,
    finalPositionsValue,
    finalNetWorth,
    profit: finalNetWorth - options.capital,
    returnPct: options.capital > 0 ? (finalNetWorth - options.capital) / options.capital : 0,
    maxDrawdown,
    maxDrawdownPct,
    peakNetWorth: peak,
    buys: sim.trades.filter((t) => t.kind === "buy").length,
    sells: sim.trades.filter((t) => t.kind === "sell").length,
    shorts: sim.trades.filter((t) => t.kind === "short").length,
    covers: sim.trades.filter((t) => t.kind === "cover").length,
    trades: sim.trades.length,
    commissionPaid: sim.trades.length * STOCK_MARKET_COMMISSION,
    realizedProfit: closingTrades.reduce((sum, t) => sum + t.realized, 0),
    unrealizedProfit: unrealizedAtMark(sim),
    winRate: closingTrades.length > 0 ? wins / closingTrades.length : null,
    avgHoldTicks: holdTimeStats(sim.trades),
    exposureAvgPct: average(exposures),
    flatTickPct: options.ticks > 0 ? flatTicks / options.ticks : 0,
    avgOpenPositions: average(openPositionCounts),
    perSymbol,
    equityCurve,
  }
}

/** Which strategy implementation a scenario runs. `v1` is the frozen baseline in traderV1.ts. */
export type StrategyId = "current" | "v1"

/** Runs src/libraries/stock/trader.ts against the market model, one call per stock update. */
export function runTraderScenario(options: BenchOptions, strategy: StrategyId = "current"): BenchResult {
  return runScenario(options, (sim) => {
    const ns = createNsStub(sim, {
      bitNode: options.bitNode,
      ownedSf8: options.ownedSf8,
      marketData: options.marketData,
    })
    if (strategy === "v1") {
      return { tick: () => runStockTradingTickV1(ns as unknown as NS, TRADER_V1_CONFIG) }
    }
    const config = mergeStockTraderConfig(options.config)
    // Fresh history per run: without 4S the strategy learns from prices it has seen itself.
    const state = createStockTraderState()
    return { tick: () => runStockTradingTick(ns as unknown as NS, config, state) }
  })
}

/**
 * Buy-and-hold baseline: equal-weight long positions taken at the first update, then held.
 * `filtered` restricts picks to symbols the strategy would consider buyable (same edge threshold).
 */
export function runHoldBaseline(options: BenchOptions, filtered: boolean): BenchResult {
  const config = mergeStockTraderConfig(options.config)

  return runScenario(options, (sim) => ({
    setup: () => {
      let picks = sim.getSymbols()
      // With no 4S data there is no forecast to filter on, so this degrades to "hold all".
      if (filtered && options.marketData !== false) {
        picks = picks.filter((symbol) => {
          const stock = sim.getStock(symbol)
          return (2 * stock.getForecast() - 1) * stock.getVolatility() >= config.entryEdge
        })
        if (picks.length === 0) picks = sim.getSymbols()
      }

      const budget = Math.max(0, sim.cash - config.moneyKeep)
      const budgetPerSymbol = budget / picks.length
      for (const symbol of picks) {
        const stock = sim.getStock(symbol)
        const maxShares = Math.floor(stock.maxShares * config.maxShareFraction)
        const shares = Math.min(maxShares, Math.floor((budgetPerSymbol - STOCK_MARKET_COMMISSION) / stock.getAskPrice()))
        if (shares >= 1) sim.buyLong(symbol, shares)
      }
    },
    tick: () => {
      /* hold */
    },
  }))
}

/** Seeds actually used by a `--seeds n` run starting at `seed`. */
export function seedsFor(seed: number, count: number): number[] {
  const seeds: number[] = []
  for (let i = 0; i < count; i++) seeds.push(seed + i * SEED_STRIDE)
  return seeds
}

/** Contiguous seeds from..from+count-1, i.e. the range a person expects from "first seed" + count. */
export function seedRange(from: number, count: number): number[] {
  const seeds: number[] = []
  for (let i = 0; i < count; i++) seeds.push(from + i)
  return seeds
}

export function aggregate(results: readonly BenchResult[]): Aggregate {
  const returns = results.map((r) => r.returnPct)
  const drawdowns = results.map((r) => r.maxDrawdownPct)
  return {
    runs: results.length,
    meanReturnPct: average(returns),
    medianReturnPct: median(returns),
    stdReturnPct: stdDev(returns),
    minReturnPct: returns.length > 0 ? Math.min(...returns) : 0,
    maxReturnPct: returns.length > 0 ? Math.max(...returns) : 0,
    meanMaxDrawdownPct: average(drawdowns),
    worstMaxDrawdownPct: drawdowns.length > 0 ? Math.max(...drawdowns) : 0,
    meanTrades: average(results.map((r) => r.trades)),
    meanCommission: average(results.map((r) => r.commissionPaid)),
    meanNetWorth: average(results.map((r) => r.finalNetWorth)),
    meanExposurePct: average(results.map((r) => r.exposureAvgPct)),
    meanFlatTickPct: average(results.map((r) => r.flatTickPct)),
  }
}

export interface PairedStats {
  runs: number
  wins: number
  geometricRatio: number
  lowRatio: number
  highRatio: number
  medianRatio: number
}

/**
 * Compare two strategies seed by seed. Both see the identical market on a given seed, so the
 * per-seed net-worth ratio is much less noisy than the difference between two means. Net worth is
 * multiplicative, so the summary is the geometric mean ratio with a 95% interval derived from the
 * spread of the log ratios.
 */
export function pairResults(current: readonly BenchResult[], baseline: readonly BenchResult[]): PairedStats | null {
  const bySeed = new Map(baseline.map((result) => [result.seed, result]))
  const ratios: number[] = []
  for (const result of current) {
    const other = bySeed.get(result.seed)
    if (!other || !(other.finalNetWorth > 0) || !(result.finalNetWorth > 0)) continue
    ratios.push(result.finalNetWorth / other.finalNetWorth)
  }
  if (ratios.length === 0) return null

  const logs = ratios.map((ratio) => Math.log(ratio))
  const meanLog = average(logs)
  const spread = logs.reduce((sum, value) => sum + (value - meanLog) ** 2, 0) / Math.max(1, logs.length - 1)
  const halfWidth = 1.96 * Math.sqrt(spread / logs.length)

  return {
    runs: ratios.length,
    wins: ratios.filter((ratio) => ratio > 1).length,
    geometricRatio: Math.exp(meanLog),
    lowRatio: Math.exp(meanLog - halfWidth),
    highRatio: Math.exp(meanLog + halfWidth),
    medianRatio: median(ratios),
  }
}

export interface CurveStats {
  runs: number
  /** Net worth per tick across seeds: the typical (median) run and its p10/p90 spread. */
  median: number[]
  low: number[]
  high: number[]
}

/**
 * Collapse several seeds' equity curves into one plottable shape. Wealth compounds, so the
 * median seed is the honest "typical" line: the arithmetic mean is dragged upward by a few
 * explosive runs (at 30k updates the mean return is 3x the median), and drawing seed 1 alone
 * says nothing about the other seeds. The p10/p90 band shows how much that spread matters.
 */
export function aggregateCurves(results: readonly BenchResult[]): CurveStats | null {
  const curves = results.map((result) => result.equityCurve).filter((curve) => curve.length > 0)
  if (curves.length === 0) return null
  const length = Math.min(...curves.map((curve) => curve.length))
  const medianCurve: number[] = []
  const low: number[] = []
  const high: number[] = []
  const column: number[] = []
  for (let i = 0; i < length; i++) {
    column.length = 0
    for (const curve of curves) column.push(curve[i])
    column.sort((a, b) => a - b)
    medianCurve.push(quantile(column, 0.5))
    low.push(quantile(column, 0.1))
    high.push(quantile(column, 0.9))
  }
  return { runs: curves.length, median: medianCurve, low, high }
}

/** Quantile of an already-sorted array, linearly interpolated between neighbours. */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 1) return sorted[0]
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

// The genetic search lives in its own module so the GA reads as a GA; both bundles pick it
// up from here, which is also what puts it on the GUI's `StockBench` global.
export {
  StockTuner,
  clampGenome,
  defaultsGenome,
  genomeConfig,
  genomeKey,
  pairedGain,
  randomGenome,
  scoreGenome,
  stockGeneSpecs,
  type GenomeScore,
  type PairedGain,
  type PendingGenome,
  type StockGeneKey,
  type StockGeneSpec,
  type StockGenome,
  type StockTunerOptions,
  type TuneGeneration,
  type TuneRow,
} from "./stockTuner.js"

/** Config keys that hold numbers, i.e. everything a grid sweep can vary. */
export const NUMERIC_CONFIG_KEYS = [
  "moneyKeep",
  "entryEdge",
  "exitEdge",
  "no4sEntryEdge",
  "no4sRotateMargin",
  "maxPositions",
  "maxWeightPerSymbol",
  "maxShareFraction",
  "rotateMargin",
  "historyTicks",
  "minShares",
] as const satisfies readonly (keyof StockTraderConfig)[]

/** Every combination of the numeric overrides, base config included. */
export function cartesianConfigs(
  base: Partial<StockTraderConfig>,
  grid: Partial<Record<(typeof NUMERIC_CONFIG_KEYS)[number], readonly number[]>>,
): Partial<StockTraderConfig>[] {
  let combinations: Partial<StockTraderConfig>[] = [{ ...base }]
  for (const key of NUMERIC_CONFIG_KEYS) {
    const values = grid[key]
    if (!values || values.length === 0) continue
    const next: Partial<StockTraderConfig>[] = []
    for (const combo of combinations) {
      for (const value of values) next.push({ ...combo, [key]: value })
    }
    combinations = next
  }
  if (combinations.length > MAX_GRID_COMBINATIONS) {
    throw new Error(`grid has ${combinations.length} combinations; limit is ${MAX_GRID_COMBINATIONS}`)
  }
  return combinations
}

// ---------------------------------------------------------------------------
// Self-test: model invariants + game formula checks
// ---------------------------------------------------------------------------

export function runSelfTest(): string[] {
  const failures: string[] = []
  const check = (condition: boolean, message: string): void => {
    if (!condition) failures.push(message)
  }
  const close = (a: number, b: number, tolerance = 1e-6): boolean => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b))

  // Long round trip: buy pays ask + commission, sell returns bid - commission.
  {
    const sim = new StockMarketSim({ seed: 1, cash: 1e9 })
    const stock = sim.getStock("ECP")
    const ask = stock.getAskPrice()
    const bid = stock.getBidPrice()
    const before = sim.cash
    check(sim.buyLong("ECP", 100) > 0, "self-test: buyLong should fill")
    check(close(sim.cash, before - 100 * ask - STOCK_MARKET_COMMISSION), "self-test: long buy cost mismatch")
    check(close(stock.playerAvgPx, ask, 1e-9), "self-test: long average price should equal ask")
    const afterBuy = sim.cash
    sim.sellLong("ECP", 100)
    check(close(sim.cash, afterBuy + 100 * bid - STOCK_MARKET_COMMISSION), "self-test: long sell gain mismatch")
  }

  // Commission and spread make an instant round trip a loss.
  {
    const sim = new StockMarketSim({ seed: 2, cash: 1e9 })
    const before = sim.cash
    sim.buyLong("MGCP", 100)
    sim.sellLong("MGCP", 100)
    check(sim.cash < before, "self-test: instant long round trip should lose money")
  }

  // Short round trip: open at bid, cover at ask, pay two commissions.
  {
    const sim = new StockMarketSim({ seed: 3, cash: 1e9 })
    const stock = sim.getStock("FSIG")
    const ask = stock.getAskPrice()
    const bid = stock.getBidPrice()
    const before = sim.cash
    sim.openShort("FSIG", 100)
    check(close(stock.playerAvgShortPx, bid, 1e-9), "self-test: short average price should equal bid")
    sim.closeShort("FSIG", 100)
    const expectedLoss = 100 * (ask - bid) + 2 * STOCK_MARKET_COMMISSION
    check(close(before - sim.cash, expectedLoss, 1e-6), "self-test: short round trip loss should be spread + 2 commissions")
  }

  // maxShares caps long + short combined.
  {
    const sim = new StockMarketSim({ seed: 4, cash: 1e15 })
    const stock = sim.getStock("CTK")
    check(sim.buyLong("CTK", stock.maxShares + 1) === 0, "self-test: oversize long should be rejected")
    check(stock.playerShares === 0, "self-test: rejected order must not change position")
    check(sim.buyLong("CTK", stock.maxShares) > 0, "self-test: buying maxShares should fill")
    check(sim.openShort("CTK", 1) === 0, "self-test: short must not exceed maxShares with long held")
  }

  // Large trades push forecast magnitude down, but it never goes below 5.
  {
    const sim = new StockMarketSim({ seed: 5, cash: 1e15 })
    const stock = sim.getStock("ECP")
    const otlkBefore = stock.otlkMag
    const forecastBefore = stock.getForecast()
    sim.buyLong("ECP", Math.floor(stock.maxShares * 0.9))
    check(stock.otlkMag <= otlkBefore, "self-test: buying should not increase |otlkMag|")
    check(stock.getForecast() <= forecastBefore, "self-test: buying should not increase forecast")
    check(stock.otlkMag >= 5, "self-test: otlkMag floor is 5")
  }

  // Long run: price and forecast stay in valid ranges.
  {
    const sim = new StockMarketSim({ seed: 6, cash: 0 })
    for (let i = 0; i < 5000; i++) sim.updatePrices()
    for (const stock of sim.stocks) {
      check(Number.isFinite(stock.price) && stock.price > 0, `self-test: ${stock.symbol} price not positive finite`)
      check(stock.otlkMag >= 0 && stock.otlkMag <= 50, `self-test: ${stock.symbol} otlkMag out of [0, 50]`)
      check(
        stock.otlkMagForecast >= 0 && stock.otlkMagForecast <= 100,
        `self-test: ${stock.symbol} otlkMagForecast out of [0, 100]`,
      )
      const forecast = stock.getForecast()
      check(forecast > 0 && forecast < 1, `self-test: ${stock.symbol} forecast out of (0, 1)`)
    }
  }

  // Determinism: identical seed -> identical result.
  {
    const base: BenchOptions = {
      seed: 42,
      capital: 1e10,
      ticks: 400,
      config: DEFAULT_STOCK_TRADER_CONFIG,
      bitNode: 8,
      ownedSf8: 3,
    }
    const a = runTraderScenario(base)
    const b = runTraderScenario(base)
    check(a.finalNetWorth === b.finalNetWorth, "self-test: same seed must reproduce the same net worth")
    check(a.trades === b.trades, "self-test: same seed must reproduce the same trade count")
    check(a.trades > 0, "self-test: default strategy should place trades")

    const other = runTraderScenario({ ...base, seed: 43 })
    check(other.finalNetWorth !== a.finalNetWorth, "self-test: different seeds should diverge")
  }

  // The edge the strategy exploits: up-move frequency tracks the published forecast.
  {
    const sim = new StockMarketSim({ seed: 8, cash: 0 })
    const stock = sim.getStock("ECP")
    let upMoves = 0
    let forecastSum = 0
    const updates = 2000
    for (let i = 0; i < updates; i++) {
      const forecast = stock.getForecast()
      sim.updatePrices()
      forecastSum += forecast
      if (stock.price > stock.lastPrice) upMoves++
    }
    const upRate = upMoves / updates
    const avgForecast = forecastSum / updates
    check(
      Math.abs(upRate - avgForecast) < 0.03,
      `self-test: up-move rate ${upRate.toFixed(3)} should track average forecast ${avgForecast.toFixed(3)}`,
    )
  }

  // Profit identity: net worth change equals the sum of per-symbol P/L.
  {
    const result = runTraderScenario({
      seed: 7,
      capital: 1e10,
      ticks: 300,
      config: DEFAULT_STOCK_TRADER_CONFIG,
      bitNode: 8,
      ownedSf8: 3,
    })
    const symbolSum = result.perSymbol.reduce((sum, s) => sum + s.profit, 0)
    check(close(symbolSum, result.profit, 1e-9), "self-test: per-symbol P/L should sum to total profit")
    check(close(result.finalCash + result.finalPositionsValue, result.finalNetWorth), "self-test: net worth identity")
  }

  // Strategy invariants: never more than maxPositions open, and an unreachable edge gate blocks all trading.
  {
    const base: BenchOptions = {
      seed: 11,
      capital: 1e10,
      ticks: 300,
      config: DEFAULT_STOCK_TRADER_CONFIG,
      bitNode: 8,
      ownedSf8: 3,
    }
    const config = mergeStockTraderConfig(base.config)
    let maxOpen = 0
    const state = createStockTraderState()
    const result = runScenario(base, (sim) => {
      const ns = createNsStub(sim, { bitNode: base.bitNode, ownedSf8: base.ownedSf8 })
      return {
        tick: () => {
          runStockTradingTick(ns as unknown as NS, config, state)
          const open = sim.stocks.filter((s) => s.playerShares > 0 || s.playerShortShares > 0).length
          if (open > maxOpen) maxOpen = open
        },
      }
    })
    check(result.trades > 0, "self-test: the strategy should trade at $10b")
    check(
      maxOpen <= config.maxPositions,
      `self-test: strategy held ${maxOpen} symbols, above maxPositions ${config.maxPositions}`,
    )

    const blocked = runTraderScenario({
      ...base,
      config: { ...DEFAULT_STOCK_TRADER_CONFIG, entryEdge: 1 },
    })
    check(blocked.trades === 0, "self-test: an unreachable entry edge should block every trade")

    // Without 4S the strategy must work from price history alone and never touch the gated calls.
    const blind = runTraderScenario({ ...base, ticks: 600, marketData: false })
    check(blind.trades > 0, "self-test: the strategy should still trade without 4S data")
    const blindAgain = runTraderScenario({ ...base, ticks: 600, marketData: false })
    check(blind.finalNetWorth === blindAgain.finalNetWorth, "self-test: price-history estimation must be deterministic")
  }

  // Seeded RNG sanity: the market is always initialized and deterministic.
  {
    const a = new StockMarketSim({ seed: 99, cash: 0 })
    const b = new StockMarketSim({ seed: 99, cash: 0 })
    check(a.getSymbols().length === 33, "self-test: expected 33 symbols")
    for (const symbol of a.getSymbols()) {
      check(a.getStock(symbol).price === b.getStock(symbol).price, `self-test: ${symbol} price must be deterministic`)
    }
    check(mulberry32(1)() === mulberry32(1)(), "self-test: mulberry32 must be deterministic")

    for (const stock of a.stocks) {
      check(
        stock.maxShares > 0 && stock.maxShares % 1e5 === 0,
        `self-test: ${stock.symbol} maxShares should be a positive multiple of 1e5`,
      )
      check(
        stock.cap >= stock.price * 1e3 && stock.cap <= stock.price * 25e3,
        `self-test: ${stock.symbol} cap should be 1e3x-25e3x the initial price`,
      )
      check(
        stock.mv >= 0.3 && stock.mv <= 4.5 && stock.spreadPerc > 0 && stock.spreadPerc <= 2,
        `self-test: ${stock.symbol} volatility/spread out of metadata range`,
      )
      check(
        stock.totalShares >= stock.maxShares && stock.maxShares > 0,
        `self-test: ${stock.symbol} maxShares should not exceed totalShares`,
      )
    }
  }

  return failures
}
