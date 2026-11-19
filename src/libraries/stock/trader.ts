/**
 * Stock trader: allocate by the edge that will be left *after* our own trades.
 *
 * The game moves a stock's forecast toward 50% whenever anyone trades it
 * (`processTransactionForecastMovement`): every `shareTxForMovement` shares bought or sold take 0.006
 * off the outlook magnitude, down to a floor of 5. That cost grows with position size, so the right
 * portfolio changes with the account: a small one should concentrate in the best edge, a large one
 * should spread out because each further dollar in the same company erodes the edge of every share
 * already held there. One rule produces both: investable cash goes, one slice at a time, to whichever
 * company gains the most expected growth from that slice once the slice's own impact is paid. Share
 * caps fall out of the same rule (a company with no room left gains nothing), so money a capped
 * company cannot hold flows to the next one instead of idling.
 *
 * Positions are closed when their edge turns, and swapped when a candidate's edge, net of the impact
 * of buying it, earns back its round trip over the time both can be expected to keep their edge.
 * That horizon uses the market cycle: every 75 updates each company flips direction with probability
 * 0.45, and with 4S the cycle is detected exactly because a strong forecast cannot cross 50% in an
 * ordinary update.
 *
 * Without 4S the forecast and volatility are estimated from price history and the same rules run on
 * the estimates, with a higher entry bar and a much higher rotation hurdle.
 *
 * docs/stock-trader.md has the derivation and the measurements behind every choice here.
 */

import { NS } from "@ns"
import { DEFAULT_STOCK_TRADER_CONFIG, mergeStockTraderConfig, type StockTraderConfig } from "@/libraries/stock/config.js"
import { createBlindCycleState, observeBlindCycle, type BlindCycleState } from "@/libraries/stock/blindCycle.js"
import type { StockPositionSide, StockSymbolSnapshot, StockTraderSnapshot } from "@/libraries/stock/types.js"

const POS_LONG: StockPositionSide = "L"
const POS_SHORT: StockPositionSide = "S"

/** Updates between market cycles (StockMarketConstants.TicksPerCycle). */
export const STOCK_TICKS_PER_CYCLE = 75
/** Chance that a company keeps its direction through a cycle (the game flips with probability 0.45). */
const CYCLE_SURVIVAL = 0.55
/** Outlook magnitude lost per `shareTxForMovement` shares traded (forecastChangePerPriceMovement). */
const IMPACT_PER_MOVEMENT = 0.006
/** Trading cannot push the outlook magnitude below this. */
const IMPACT_FLOOR = 5

/**
 * Shares per forecast movement: the midpoint of each company's `shareTxForMovement` range in the
 * game's InitStockMetadata. The game does not report the drawn value, and the midpoint is within
 * a factor of two of it, which is enough to tell a cheap company to trade from an expensive one.
 * Keep in sync with ../bitburner-src/src/StockMarket/data/InitStockMetadata.ts.
 */
const SHARES_PER_MOVEMENT: Record<string, number> = {
  ECP: 60e3, MGCP: 60e3, BLD: 60e3, CLRK: 60e3, OMTK: 60e3, FSIG: 60e3, KGI: 60e3, FLCM: 60e3,
  STM: 72e3, DCOMM: 72e3, HLS: 72e3, VITA: 72e3, ICRS: 72e3, UNV: 72e3,
  AERO: 84e3, OMN: 84e3, SLRS: 84e3, GPH: 84e3, NVMD: 84e3,
  WDS: 33e3, LXO: 72e3, RHOC: 93e3, APHE: 60e3, SYSC: 52.5e3, CTK: 93e3, NTLK: 36e3, OMGA: 60e3,
  FNS: 120e3, JGN: 33.5e3, SGC: 45e3, CTYS: 48e3, MDYN: 153e3, TITN: 153e3,
}
const DEFAULT_SHARES_PER_MOVEMENT = 60e3

function formatMoney(ns: NS, value: number): string {
  return `$${ns.format.number(value)}`
}

/** Positions at market price, shorts marked as (2 * avgShort - price) per share, as the game does. */
function markedPortfolioValue(ns: NS, symbols: readonly string[]): number {
  let total = 0
  for (const sym of symbols) {
    const [longShares, , shortShares, avgShortPrice] = ns.stock.getPosition(sym)
    const price = ns.stock.getPrice(sym)
    if (longShares > 0) total += longShares * price
    if (shortShares > 0) total += shortShares * (2 * avgShortPrice - price)
  }
  return total
}

/** What the positions would actually fetch now: longs at the bid and shorts at the ask. */
function liquidationValue(ns: NS, symbols: readonly string[]): number {
  let total = 0
  for (const sym of symbols) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym)
    if (longShares > 0) total += ns.stock.getSaleGain(sym, longShares, POS_LONG)
    if (shortShares > 0) total += ns.stock.getSaleGain(sym, shortShares, POS_SHORT)
  }
  return total
}

/**
 * Expected price move per market update: how far the forecast leans times how big the move is.
 * Positive means the price is expected to rise, negative that it is expected to fall.
 */
export function stockEdge(forecast: number, volatility: number): number {
  return (2 * forecast - 1) * volatility
}

/** Does the player have the 4S Market Data TIX API, i.e. real forecasts and volatilities? */
export function hasMarketData(ns: NS): boolean {
  return ns.stock.has4SDataTixApi()
}

/** Memory the strategy needs between updates. One per running trader (the bench makes one per run). */
export interface StockTraderState {
  /** Prices per symbol, oldest first, at most `historyTicks + 1` entries. */
  prices: Map<string, number[]>
  /** Updates seen so far (one call per stock update). */
  tick: number
  /** Tick on which the last cycle was observed, or null until one has been seen. */
  lastCycleTick: number | null
  /** Forecast per symbol on the previous update. */
  forecasts: Map<string, number>
  /** Without 4S: the cycle phase and per-company sign tracking learnt from prices. */
  blindCycle?: BlindCycleState
  /** Without 4S: the last cycle-aware edges, or null while the phase is unknown. */
  blindEdges?: Map<string, number> | null
}

export function createStockTraderState(): StockTraderState {
  return { prices: new Map(), tick: 0, lastCycleTick: null, forecasts: new Map() }
}

function recordPrice(state: StockTraderState, symbol: string, price: number, historyTicks: number): void {
  if (!(price > 0)) return
  let history = state.prices.get(symbol)
  if (!history) {
    history = []
    state.prices.set(symbol, history)
  }
  history.push(price)
  const keep = historyTicks + 1
  if (history.length > keep) history.splice(0, history.length - keep)
}

/**
 * Edge estimated from past prices alone: twice the mean log return over the last `ticks` updates.
 *
 * Over one update the price moves by +/- v * volatility, and the up/down coin is biased by the
 * forecast, so the mean log return is exactly half the edge. Doubling it estimates the same
 * quantity the 4S forecast gives, in the same units, which is why the same entry threshold works.
 */
export function estimateEdge(prices: readonly number[], ticks: number): number | null {
  const samples = Math.min(ticks, prices.length - 1)
  if (samples < 3) return null
  let total = 0
  const first = prices.length - 1 - samples
  for (let i = first + 1; i < prices.length; i++) total += Math.log(prices[i] / prices[i - 1])
  return (2 * total) / samples
}

/**
 * Volatility estimated from price history. One update moves the price by a factor of
 * `1 ± v * volatility` with `v` uniform on [0, 1], so the mean absolute log return is half the
 * volatility.
 */
export function estimateVolatility(prices: readonly number[], ticks: number): number {
  const samples = Math.min(ticks, prices.length - 1)
  if (samples < 3) return 0
  let total = 0
  for (let i = prices.length - samples; i < prices.length; i++) total += Math.abs(Math.log(prices[i] / prices[i - 1]))
  return (2 * total) / samples
}

/** The thresholds actually in force, which depend on whether 4S data is available. */
export interface ResolvedStockThresholds {
  entryEdge: number
  exitEdge: number
  rotationCostFactor: number
  fromPrices: boolean
}

export function resolveStockThresholds(ns: NS, config: StockTraderConfig): ResolvedStockThresholds {
  const cfg = mergeStockTraderConfig(config)
  const fromPrices = !hasMarketData(ns)
  return {
    entryEdge: fromPrices ? cfg.no4sEntryEdge : cfg.entryEdge,
    exitEdge: cfg.exitEdge,
    rotationCostFactor: fromPrices ? cfg.no4sRotationCostFactor : cfg.rotationCostFactor,
    fromPrices,
  }
}

/**
 * Edge for every symbol, from the 4S forecast when it is available and from the price history
 * recorded here when it is not. Records this update's prices unless `record` is false.
 */
export function estimateEdges(
  ns: NS,
  config: StockTraderConfig,
  state: StockTraderState,
  symbols: readonly string[],
  marketData: boolean,
  record = true
): Map<string, number> {
  const edges = new Map<string, number>()
  for (const sym of symbols) {
    if (record) recordPrice(state, sym, ns.stock.getPrice(sym), config.historyTicks)
    if (marketData) {
      edges.set(sym, stockEdge(ns.stock.getForecast(sym), ns.stock.getVolatility(sym)))
      continue
    }
    const estimate = estimateEdge(state.prices.get(sym) ?? [], config.historyTicks)
    if (estimate !== null) edges.set(sym, estimate)
  }
  // Without 4S, once the cycle phase is known from prices, the cycle-aware estimate replaces the
  // moving average (blindCycle.ts). The dashboard reads the last one instead of recording again.
  if (!marketData && config.no4sCycleAware) {
    if (record) {
      state.blindCycle ??= createBlindCycleState()
      state.blindEdges = observeBlindCycle(state.blindCycle, new Map(symbols.map((sym) => [sym, ns.stock.getPrice(sym)])))
    }
    for (const [sym, edge] of state.blindEdges ?? []) edges.set(sym, edge)
  }
  return edges
}

/**
 * Updates until the next cycle, or null while it is unknown. Between cycles a forecast moves by
 * a few percent of its own distance from 50% per update, so a forecast that was clearly on one side
 * and is now clearly on the other can only have been flipped by the cycle. Missed updates only blur
 * the count until the next cycle resynchronises it.
 */
export function observeCycle(state: StockTraderState, forecasts: ReadonlyMap<string, number>): number | null {
  state.tick++
  let flipped = false
  for (const [symbol, forecast] of forecasts) {
    const previous = state.forecasts.get(symbol)
    if (previous !== undefined && Math.abs(previous - 0.5) > 0.02 && Math.abs(forecast - 0.5) > 0.02) {
      if (previous > 0.5 !== forecast > 0.5) flipped = true
    }
    state.forecasts.set(symbol, forecast)
  }
  if (flipped) state.lastCycleTick = state.tick
  if (state.lastCycleTick === null) return null
  const since = (state.tick - state.lastCycleTick) % STOCK_TICKS_PER_CYCLE
  return STOCK_TICKS_PER_CYCLE - since
}

/** One company as the allocator sees it. All weights are shares of net worth. */
export interface ImpactProfile {
  symbol: string
  side: StockPositionSide
  /** Volatility as getVolatility() reports it. */
  volatility: number
  /** Outlook magnitude now, in forecast points: |forecast - 50%| * 100. */
  outlook: number
  /** Outlook points our own trading removes per unit of weight bought. */
  impact: number
  /** Weight already held on `side`. */
  held: number
  /** Most weight the share cap allows on `side`, including what is held. */
  capacity: number
  /** Round trip as a fraction of the position: two spreads. */
  roundTrip: number
}

/**
 * Expected log growth per update from holding `held + added` of a company once `added` has been
 * bought. Buying lowers the outlook of every share held, not just the new ones, until the floor.
 * `varianceScale` subtracts the variance drag of log growth: one update moves the price by
 * `v * volatility` with `v` uniform on [0, 1], so the per-update variance is `volatility^2 / 3`
 * and the drag on a weight `w` is `w^2 * volatility^2 / 6`.
 */
export function impactedGrowth(p: ImpactProfile, added: number, varianceScale = 0): number {
  const floor = Math.min(p.outlook, IMPACT_FLOOR)
  const outlook = Math.max(floor, p.outlook - p.impact * added)
  const weight = p.held + added
  // edge = (2f - 1) * volatility = outlook / 50 * volatility; growth per update is edge / 2.
  return (weight * p.volatility * outlook) / 100 - (varianceScale * weight * weight * p.volatility * p.volatility) / 6
}

/** Edge per unit of weight of a position of size `weight` opened now, net of its own impact. */
export function impactedEdge(p: ImpactProfile, weight: number): number {
  const floor = Math.min(p.outlook, IMPACT_FLOOR)
  return (Math.max(floor, p.outlook - p.impact * weight) / 50) * p.volatility
}

/**
 * Hand out `budget` (a share of net worth) in equal slices, each to the company whose expected
 * growth rises most from it. Returns the weight to add per symbol. `pool` holds every company that
 * may receive money; new ones only count against `openSlots` once they actually get a slice.
 */
export function allocateWithImpact(
  pool: readonly ImpactProfile[],
  budget: number,
  options: { slices: number; maxWeight: number; openSlots: number; varianceScale?: number }
): Map<string, number> {
  const added = new Map<string, number>()
  if (!(budget > 0) || pool.length === 0) return added
  const slice = budget / options.slices
  const varianceScale = options.varianceScale ?? 0
  let opened = 0
  for (let step = 0; step < options.slices; step++) {
    let best: ImpactProfile | null = null
    let bestGain = 0
    for (const p of pool) {
      const now = added.get(p.symbol) ?? 0
      if (now === 0 && p.held === 0 && opened >= options.openSlots) continue
      const room = Math.min(options.maxWeight, p.capacity) - p.held - now
      if (room <= 1e-12) continue
      const size = Math.min(slice, room)
      // Gain per unit of weight, so a slice cut short by the cap is compared fairly.
      const gain = (impactedGrowth(p, now + size, varianceScale) - impactedGrowth(p, now, varianceScale)) / size
      if (gain > bestGain) {
        bestGain = gain
        best = p
      }
    }
    if (best === null) break
    const now = added.get(best.symbol) ?? 0
    if (now === 0 && best.held === 0) opened++
    const room = Math.min(options.maxWeight, best.capacity) - best.held - now
    added.set(best.symbol, now + Math.min(slice, room))
  }
  return added
}

function signalForSnapshot(
  snap: Pick<StockSymbolSnapshot, "longShares" | "shortShares" | "edge">,
  thresholds: ResolvedStockThresholds,
  allowShorts: boolean
): string {
  const parts: string[] = []
  if (snap.longShares > 0) parts.push(snap.edge <= thresholds.exitEdge ? "sell long" : "hold long")
  else if (snap.edge >= thresholds.entryEdge) parts.push("buy long")
  if (snap.shortShares > 0) parts.push(-snap.edge <= thresholds.exitEdge ? "cover short" : "hold short")
  else if (allowShorts && -snap.edge >= thresholds.entryEdge) parts.push("short")
  return parts.length > 0 ? parts.join(", ") : "wait"
}

function collectSymbolSnapshot(
  ns: NS,
  symbol: string,
  thresholds: ResolvedStockThresholds,
  allowShorts: boolean,
  edge: number | undefined
): StockSymbolSnapshot {
  const [longShares, avgLongPrice, shortShares, avgShortPrice] = ns.stock.getPosition(symbol)
  const known = edge !== undefined
  const forecast = known && !thresholds.fromPrices ? ns.stock.getForecast(symbol) : NaN
  const volatility = known && !thresholds.fromPrices ? ns.stock.getVolatility(symbol) : NaN
  const snap: StockSymbolSnapshot = {
    symbol,
    price: ns.stock.getPrice(symbol),
    askPrice: ns.stock.getAskPrice(symbol),
    bidPrice: ns.stock.getBidPrice(symbol),
    forecast,
    volatility,
    edge: edge ?? NaN,
    edgeFromPrices: thresholds.fromPrices,
    maxShares: ns.stock.getMaxShares(symbol),
    longShares,
    avgLongPrice,
    shortShares,
    avgShortPrice,
    longUnrealized: longShares > 0 ? ns.stock.getSaleGain(symbol, longShares, POS_LONG) : 0,
    shortUnrealized: shortShares > 0 ? ns.stock.getSaleGain(symbol, shortShares, POS_SHORT) : 0,
    signal: "",
  }
  snap.signal = signalForSnapshot(snap, thresholds, allowShorts)
  return snap
}

export function hasRequiredStockAccess(ns: NS): boolean {
  return ns.stock.hasTixApiAccess()
}

/** Shorts need BitNode 8 or Source-File 8 level 2+. */
export function canUseStockShorts(ns: NS): boolean {
  const reset = ns.getResetInfo()
  if (reset.currentNode === 8) return true
  return (reset.ownedSF.get(8) ?? 0) >= 2
}

export function shortsActive(ns: NS, config: StockTraderConfig): boolean {
  return mergeStockTraderConfig(config).enableShorts && canUseStockShorts(ns)
}

/** Cash kept back: the larger of the absolute floor and the share of net worth. */
export function cashReserve(config: StockTraderConfig, netWorth: number): number {
  return Math.max(config.moneyKeep, config.reserveFraction * netWorth)
}

export function buildConfigSummary(ns: NS, config: StockTraderConfig): string {
  const cfg = mergeStockTraderConfig(config)
  let shortLabel: string
  if (!cfg.enableShorts) {
    shortLabel = "off"
  } else if (!canUseStockShorts(ns)) {
    shortLabel = "locked (need BN8 or SF8 L2)"
  } else {
    shortLabel = "on"
  }
  const thresholds = resolveStockThresholds(ns, cfg)
  const source = thresholds.fromPrices ? `prices (${cfg.historyTicks} updates)` : "4S forecast"
  return (
    `impact-aware, edge>=${(thresholds.entryEdge * 100).toFixed(2)}%/tick from ${source}, ` +
    `exit at ${(cfg.exitEdge * 100).toFixed(2)}%, up to ${cfg.maxOpenPositions} pos, ` +
    `${(cfg.maxWeight * 100).toFixed(0)}%/sym, rotate at ${thresholds.rotationCostFactor}x round trip, ` +
    `shorts ${shortLabel}`
  )
}

export function collectTraderSnapshot(
  ns: NS,
  config: StockTraderConfig,
  sessionStartNetWorth: number,
  tickCount: number,
  lastTickActions: string[],
  state: StockTraderState = createStockTraderState()
): StockTraderSnapshot {
  const cfg = mergeStockTraderConfig(config)
  const allowShorts = shortsActive(ns, cfg)
  const symbolNames = ns.stock.getSymbols()
  const homeCash = ns.getServerMoneyAvailable("home")
  const portfolio = markedPortfolioValue(ns, symbolNames)
  const totalNetWorth = homeCash + portfolio
  const thresholds = resolveStockThresholds(ns, cfg)
  // Read-only: the trading tick already recorded this update's prices.
  const edges = estimateEdges(ns, cfg, state, symbolNames, !thresholds.fromPrices, false)
  const symbols = symbolNames.map((sym) => collectSymbolSnapshot(ns, sym, thresholds, allowShorts, edges.get(sym)))
  const reserve = cashReserve(cfg, totalNetWorth)

  return {
    symbols,
    homeCash,
    moneyKeep: reserve,
    investableCash: Math.max(0, homeCash - reserve),
    portfolioValue: portfolio,
    totalNetWorth,
    sessionStartNetWorth,
    sessionProfit: totalNetWorth - sessionStartNetWorth,
    commission: ns.stock.getConstants().StockMarketCommission,
    tickCount,
    lastTickActions,
    configSummary: buildConfigSummary(ns, cfg),
  }
}

export function hasAnyStockPosition(ns: NS): boolean {
  for (const sym of ns.stock.getSymbols()) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym)
    if (longShares > 0 || shortShares > 0) return true
  }
  return false
}

function sell(ns: NS, symbol: string, shares: number, side: StockPositionSide, actions: string[], label: string): void {
  if (shares < 1) return
  if (side === POS_LONG) ns.stock.sellStock(symbol, shares)
  else ns.stock.sellShort(symbol, shares)
  actions.push(`${label} ${symbol} x${shares}`)
}

/** Sell all longs and cover all shorts (one pass over every symbol). */
export function liquidateAllPositions(ns: NS): string[] {
  const actions: string[] = []
  for (const sym of ns.stock.getSymbols()) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym)
    if (longShares > 0) sell(ns, sym, longShares, POS_LONG, actions, "SELL")
    if (shortShares > 0) sell(ns, sym, shortShares, POS_SHORT, actions, "COVER")
  }
  if (actions.length === 0) {
    actions.push(hasAnyStockPosition(ns) ? "(no trades this pass)" : "(flat — no positions)")
  }
  return actions
}

function sharesAffordable(
  ns: NS,
  symbol: string,
  side: StockPositionSide,
  budget: number,
  minShares: number,
  maxShares: number
): number {
  if (maxShares < minShares || budget <= 0) return 0
  const ask = ns.stock.getAskPrice(symbol)
  const commission = ns.stock.getConstants().StockMarketCommission
  let shares = Math.min(maxShares, Math.floor((budget - commission) / ask))
  while (shares >= minShares) {
    if (ns.stock.getPurchaseCost(symbol, shares, side) <= budget) return shares
    shares--
  }
  return 0
}

/**
 * One market update: close what has turned, swap the weakest holding when a candidate is worth the
 * round trip, then hand out the investable cash by impact-adjusted expected growth. Never trims:
 * selling a position back to a target every update pays the impact twice for nothing.
 */
export function runStockTradingTick(
  ns: NS,
  config: StockTraderConfig = DEFAULT_STOCK_TRADER_CONFIG,
  state: StockTraderState = createStockTraderState()
): string[] {
  const cfg = mergeStockTraderConfig(config)
  const thresholds = resolveStockThresholds(ns, cfg)
  const blind = thresholds.fromPrices
  const allowShorts = shortsActive(ns, cfg)
  const actions: string[] = []
  const symbols = ns.stock.getSymbols()
  const edges = estimateEdges(ns, cfg, state, symbols, !blind)
  const toCycle = blind ? null : observeCycle(state, new Map(symbols.map((sym) => [sym, ns.stock.getForecast(sym)])))

  // Phase 1: close anything whose edge has turned.
  for (const sym of symbols) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym)
    const edge = edges.get(sym)
    // No estimate yet (no 4S and too few samples): leave the position alone.
    if (edge === undefined) continue
    if (longShares > 0 && edge <= cfg.exitEdge) sell(ns, sym, longShares, POS_LONG, actions, "SELL")
    if (allowShorts && shortShares > 0 && -edge <= cfg.exitEdge) sell(ns, sym, shortShares, POS_SHORT, actions, "COVER")
  }

  const netWorth = ns.getServerMoneyAvailable("home") + liquidationValue(ns, symbols)
  if (!(netWorth > 0)) return actions
  // Forecasts are read again: the sales above moved them. Without 4S the forecast and volatility
  // are estimated from the price history instead.
  const profile = (symbol: string): ImpactProfile => {
    let forecast: number
    let volatility: number
    if (blind) {
      const edge = edges.get(symbol) ?? 0
      volatility = estimateVolatility(state.prices.get(symbol) ?? [], cfg.historyTicks)
      const lean = volatility > 0 ? Math.min(0.5, Math.abs(edge) / volatility / 2) : 0
      forecast = 0.5 + Math.sign(edge) * lean
    } else {
      forecast = ns.stock.getForecast(symbol)
      volatility = ns.stock.getVolatility(symbol)
    }
    const side = forecast >= 0.5 ? POS_LONG : POS_SHORT
    const price = ns.stock.getPrice(symbol)
    const [longShares, , shortShares] = ns.stock.getPosition(symbol)
    const heldShares = side === POS_LONG ? longShares : shortShares
    const capShares = Math.floor(ns.stock.getMaxShares(symbol) * cfg.maxShareFraction)
    const perMovement = SHARES_PER_MOVEMENT[symbol] ?? DEFAULT_SHARES_PER_MOVEMENT
    return {
      symbol,
      side,
      volatility,
      outlook: Math.abs(forecast - 0.5) * 100,
      impact: price > 0 ? (cfg.impactScale * IMPACT_PER_MOVEMENT * netWorth) / (price * perMovement) : 0,
      held: (heldShares * price) / netWorth,
      capacity: ((capShares - (side === POS_LONG ? shortShares : longShares)) * price) / netWorth,
      roundTrip: price > 0 ? 2 * (ns.stock.getAskPrice(symbol) / price - 1) : 0,
    }
  }
  const edgeOf = (p: ImpactProfile): number => (p.outlook / 50) * p.volatility
  const isHeld = (symbol: string): boolean => {
    const [longShares, , shortShares] = ns.stock.getPosition(symbol)
    return longShares > 0 || shortShares > 0
  }

  const held = symbols.filter(isHeld)
  const eligible = (p: ImpactProfile): boolean => edgeOf(p) >= thresholds.entryEdge && (p.side === POS_LONG || allowShorts)
  const fresh = symbols
    .filter((sym) => !isHeld(sym))
    .map(profile)
    .filter(eligible)
    .sort((a, b) => edgeOf(b) - edgeOf(a))

  // Phase 2: rotation. The candidate's edge is what is left after the impact of buying it at the
  // weakest holding's size; the gain has to pay back the candidate's round trip over the expected
  // time both keep their edge (until the cycle, then each survives it with probability 0.55, so the
  // tail is worth 0.55/0.45 cycles). Money that is already invested only moves through this rule
  // or the exit rule.
  const rotatedOut = new Set<string>()
  if (held.length > 0 && fresh.length > 0) {
    const horizon =
      (toCycle ?? STOCK_TICKS_PER_CYCLE / 2) + (STOCK_TICKS_PER_CYCLE * CYCLE_SURVIVAL) / (1 - CYCLE_SURVIVAL)
    let weakest: ImpactProfile | null = null
    let weakestWeight = 0
    for (const sym of held) {
      const p = profile(sym)
      const [longShares, , shortShares] = ns.stock.getPosition(sym)
      const weight = ((longShares + shortShares) * ns.stock.getPrice(sym)) / netWorth
      if (weakest === null || edgeOf(p) < edgeOf(weakest)) {
        weakest = p
        weakestWeight = weight
      }
    }
    if (weakest !== null) {
      const candidate = fresh[0]
      const gain = ((impactedEdge(candidate, weakestWeight) - edgeOf(weakest)) / 2) * horizon
      if (gain > thresholds.rotationCostFactor * candidate.roundTrip) {
        const [weakLong, , weakShort] = ns.stock.getPosition(weakest.symbol)
        if (weakLong > 0) sell(ns, weakest.symbol, weakLong, POS_LONG, actions, "SELL")
        if (weakShort > 0) sell(ns, weakest.symbol, weakShort, POS_SHORT, actions, "COVER")
        rotatedOut.add(weakest.symbol)
      }
    }
  }

  // Phase 3: hand out the investable cash. Holdings still worth entering may be topped up; a
  // holding whose edge has sagged below the entry bar is left alone until the exit rule takes it.
  const holdingsNow = symbols.filter(isHeld)
  const pool = [
    ...holdingsNow.map(profile).filter((p) => p.held > 0 && eligible(p)),
    ...fresh.filter((p) => !isHeld(p.symbol)),
  ]
  const cash = Math.max(0, ns.getServerMoneyAvailable("home") - cashReserve(cfg, netWorth))
  const plan = allocateWithImpact(pool, cash / netWorth, {
    slices: cfg.slices,
    maxWeight: cfg.maxWeight,
    openSlots: Math.max(0, cfg.maxOpenPositions - holdingsNow.length), varianceScale: cfg.varianceScale,
  })

  // Cash the entry bar leaves idle (every eligible company is at its cap) may go to weaker edges.
  let leftover = cash / netWorth
  for (const add of plan.values()) leftover -= add
  const idleEntryEdge = cfg.idleEntryFraction * thresholds.entryEdge
  if (cfg.idleEntryFraction < 1 && leftover > cfg.minNewWeight) {
    // A holding rotated out this update is never bought back by the idle pass in the same update.
    const idlePool = symbols
      .filter((sym) => !isHeld(sym) && !plan.has(sym) && !rotatedOut.has(sym))
      .map(profile)
      .filter(
        (p) =>
          edgeOf(p) >= idleEntryEdge &&
          edgeOf(p) < thresholds.entryEdge &&
          p.outlook >= cfg.idleMinOutlook &&
          (p.side === POS_LONG || allowShorts),
      )
    const idlePlan = allocateWithImpact(idlePool, leftover, {
      slices: cfg.slices,
      maxWeight: cfg.maxWeight,
      openSlots: cfg.idleExtraPositions, varianceScale: cfg.varianceScale,
    })
    for (const p of idlePool) {
      const add = idlePlan.get(p.symbol)
      if (!add) continue
      plan.set(p.symbol, add)
      pool.push(p)
    }
  }

  let budget = cash
  for (const p of pool) {
    const add = plan.get(p.symbol) ?? 0
    if (add <= 0 || budget <= 0) continue
    if (p.held === 0 && add < cfg.minNewWeight) continue
    const price = ns.stock.getPrice(p.symbol)
    const [longShares, , shortShares] = ns.stock.getPosition(p.symbol)
    const capShares = Math.floor(ns.stock.getMaxShares(p.symbol) * cfg.maxShareFraction)
    const wanted = Math.min(Math.floor((add * netWorth) / price), capShares - longShares - shortShares)
    const shares = sharesAffordable(ns, p.symbol, p.side, budget, cfg.minShares, wanted)
    if (shares <= 0) continue
    const before = ns.getServerMoneyAvailable("home")
    const filled = p.side === POS_LONG ? ns.stock.buyStock(p.symbol, shares) : ns.stock.buyShort(p.symbol, shares)
    if (filled > 0) {
      actions.push(`${p.side === POS_LONG ? "BUY" : "SHORT"} ${p.symbol} x${shares} @ $${ns.format.number(filled)}`)
      budget -= before - ns.getServerMoneyAvailable("home")
    }
  }

  if (actions.length === 0) {
    if (cash <= 0) actions.push("(no trades: no investable cash above reserve)")
    else if (pool.length === 0) {
      actions.push(`(no trades: no symbol reaches edge ${(thresholds.entryEdge * 100).toFixed(2)}%)`)
    } else actions.push("(no trades: holdings at target)")
  }
  return actions
}

export function formatSnapshotMoney(ns: NS, value: number): string {
  return formatMoney(ns, value)
}
