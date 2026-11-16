import { NS } from "@ns"
import { DEFAULT_STOCK_TRADER_CONFIG, mergeStockTraderConfig, type StockTraderConfig } from "@/libraries/stock/config.js"
import type { StockPositionSide, StockSymbolSnapshot, StockTraderSnapshot } from "@/libraries/stock/types.js"

const POS_LONG: StockPositionSide = "L"
const POS_SHORT: StockPositionSide = "S"

function formatMoney(ns: NS, value: number): string {
  return `$${ns.format.number(value)}`
}

function portfolioValue(ns: NS, symbols: string[]): number {
  let total = 0
  for (const sym of symbols) {
    const [longShares, , shortShares, avgShortPrice] = ns.stock.getPosition(sym)
    const price = ns.stock.getPrice(sym)
    if (longShares > 0) total += longShares * price
    if (shortShares > 0) total += shortShares * (2 * avgShortPrice - price)
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

/**
 * Memory the strategy needs between ticks when there is no 4S data.
 *
 * Without 4S the game refuses to report forecasts or volatilities, so the only signal left is the
 * price history the script collects itself. This holds the recent prices per symbol; the bench
 * creates one per scenario so runs never share state.
 */
export interface StockTraderState {
  /** Prices per symbol, oldest first, at most `historyTicks + 1` entries. */
  prices: Map<string, number[]>
}

export function createStockTraderState(): StockTraderState {
  return { prices: new Map() }
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

/** The thresholds actually in force, which depend on whether 4S data is available. */
export interface ResolvedStockThresholds {
  entryEdge: number
  exitEdge: number
  rotateMargin: number
  fromPrices: boolean
}

export function resolveStockThresholds(ns: NS, config: StockTraderConfig): ResolvedStockThresholds {
  const cfg = mergeStockTraderConfig(config)
  const fromPrices = !hasMarketData(ns)
  return {
    entryEdge: fromPrices ? cfg.no4sEntryEdge : cfg.entryEdge,
    exitEdge: cfg.exitEdge,
    rotateMargin: fromPrices ? cfg.no4sRotateMargin : cfg.rotateMargin,
    fromPrices,
  }
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
  const source = hasMarketData(ns) ? "4S forecast" : `prices (${cfg.historyTicks} updates)`
  const entry = hasMarketData(ns) ? cfg.entryEdge : cfg.no4sEntryEdge
  const rotate = hasMarketData(ns) ? cfg.rotateMargin : cfg.no4sRotateMargin
  return (
    `edge>=${(entry * 100).toFixed(2)}%/tick from ${source}, exit at ${(cfg.exitEdge * 100).toFixed(2)}%, ` +
    `${cfg.maxPositions} pos, ${(cfg.maxWeightPerSymbol * 100).toFixed(0)}%/sym, ` +
    `${(cfg.maxShareFraction * 100).toFixed(0)}% of max shares, rotate x${rotate}, shorts ${shortLabel}`
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
  const portfolio = portfolioValue(ns, symbolNames)
  const totalNetWorth = homeCash + portfolio
  const thresholds = resolveStockThresholds(ns, cfg)
  const edges = estimateEdges(ns, cfg, state, symbolNames, !thresholds.fromPrices)
  const symbols = symbolNames.map((sym) =>
    collectSymbolSnapshot(ns, sym, thresholds, allowShorts, edges.get(sym))
  )

  return {
    symbols,
    homeCash,
    moneyKeep: cfg.moneyKeep,
    investableCash: Math.max(0, homeCash - cfg.moneyKeep),
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

/** Sell all longs and cover all shorts (one pass over every symbol). */
export function liquidateAllPositions(ns: NS): string[] {
  const actions: string[] = []
  for (const sym of ns.stock.getSymbols()) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym)
    if (longShares > 0) {
      sellPartial(ns, sym, longShares, POS_LONG, actions, "SELL")
    }
    if (shortShares > 0) {
      sellPartial(ns, sym, shortShares, POS_SHORT, actions, "COVER")
    }
  }
  if (actions.length === 0) {
    actions.push(hasAnyStockPosition(ns) ? "(no trades this pass)" : "(flat — no positions)")
  }
  return actions
}

function buyShares(
  ns: NS,
  symbol: string,
  shares: number,
  side: StockPositionSide,
  actions: string[]
): void {
  if (shares < 1) return
  const cost = ns.stock.getPurchaseCost(symbol, shares, side)
  const cash = ns.getServerMoneyAvailable("home")
  if (cost > cash) return

  const price = side === POS_LONG ? ns.stock.buyStock(symbol, shares) : ns.stock.buyShort(symbol, shares)
  if (price > 0) {
    actions.push(`${side === POS_LONG ? "BUY" : "SHORT"} ${symbol} x${shares} @ $${ns.format.number(price)}`)
  }
}

function sellPartial(
  ns: NS,
  symbol: string,
  shares: number,
  side: StockPositionSide,
  actions: string[],
  label: "SELL" | "COVER"
): void {
  if (shares < 1) return
  if (side === POS_LONG) {
    ns.stock.sellStock(symbol, shares)
    actions.push(`${label} ${symbol} x${shares}`)
  } else {
    ns.stock.sellShort(symbol, shares)
    actions.push(`${label} ${symbol} x${shares}`)
  }
}

interface Candidate {
  symbol: string
  edge: number
  side: StockPositionSide
}

/** Shares we may still add before hitting our own share cap (long + short count together). */
function shareRoom(ns: NS, symbol: string, maxShareFraction: number): number {
  const [longShares, , shortShares] = ns.stock.getPosition(symbol)
  const cap = Math.floor(ns.stock.getMaxShares(symbol) * maxShareFraction)
  return Math.max(0, cap - longShares - shortShares)
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
    const cost = ns.stock.getPurchaseCost(symbol, shares, side)
    if (cost <= budget) return shares
    shares--
  }
  return 0
}

interface Budget {
  remaining: number
}

/** Adds to a position up to `targetShares`, capped by our share allowance and the remaining budget. */
function growPosition(
  ns: NS,
  candidate: Candidate,
  config: StockTraderConfig,
  targetShares: number,
  budget: Budget,
  actions: string[]
): boolean {
  if (budget.remaining <= 0) return false
  const [longShares, , shortShares] = ns.stock.getPosition(candidate.symbol)
  const held = candidate.side === POS_LONG ? longShares : shortShares
  const wanted = Math.min(targetShares - held, shareRoom(ns, candidate.symbol, config.maxShareFraction))
  const shares = sharesAffordable(
    ns,
    candidate.symbol,
    candidate.side,
    budget.remaining,
    config.minShares,
    wanted
  )
  if (shares <= 0) return false

  const before = ns.getServerMoneyAvailable("home")
  buyShares(ns, candidate.symbol, shares, candidate.side, actions)
  budget.remaining -= before - ns.getServerMoneyAvailable("home")
  return true
}

/** Edge per symbol: from 4S when available, otherwise estimated from the prices we have seen. */
/**
 * Edge for every symbol, from the 4S forecast when it is available and from the price history
 * we have recorded ourselves when it is not. Shared with v3 so both strategies act on the same
 * signal and a comparison measures the decision rules, not the input.
 */
export function estimateEdges(
  ns: NS,
  config: StockTraderConfig,
  state: StockTraderState,
  symbols: string[],
  marketData: boolean
): Map<string, number> {
  const edges = new Map<string, number>()
  for (const sym of symbols) {
    const price = ns.stock.getPrice(sym)
    recordPrice(state, sym, price, config.historyTicks)
    if (marketData) {
      edges.set(sym, stockEdge(ns.stock.getForecast(sym), ns.stock.getVolatility(sym)))
      continue
    }
    const estimate = estimateEdge(state.prices.get(sym) ?? [], config.historyTicks)
    if (estimate !== null) edges.set(sym, estimate)
  }
  return edges
}

/**
 * One market tick. Ranks every symbol by edge, closes positions whose edge has turned,
 * fills open slots with the strongest candidates, rotates capital out of the weakest holding
 * when something much better appears, then tops the remaining holdings up to target weight.
 */
export function runStockTradingTick(
  ns: NS,
  config: StockTraderConfig = DEFAULT_STOCK_TRADER_CONFIG,
  state: StockTraderState = createStockTraderState()
): string[] {
  const cfg = mergeStockTraderConfig(config)
  const allowShorts = shortsActive(ns, cfg)
  const actions: string[] = []
  const symbols = ns.stock.getSymbols()
  const thresholds = resolveStockThresholds(ns, cfg)

  const edges = estimateEdges(ns, cfg, state, symbols, !thresholds.fromPrices)

  const held = new Set<string>()
  for (const sym of symbols) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym)
    const edge = edges.get(sym)
    let longLeft = longShares
    let shortLeft = shortShares
    // No estimate yet (warm-up, or no 4S and too few samples): leave the position alone.
    if (edge !== undefined) {
      if (longShares > 0 && edge <= cfg.exitEdge) {
        sellPartial(ns, sym, longShares, POS_LONG, actions, "SELL")
        longLeft = 0
      }
      if (allowShorts && shortShares > 0 && -edge <= cfg.exitEdge) {
        sellPartial(ns, sym, shortShares, POS_SHORT, actions, "COVER")
        shortLeft = 0
      }
    }
    if (longLeft > 0 || shortLeft > 0) held.add(sym)
  }

  const candidates: Candidate[] = []
  for (const sym of symbols) {
    const edge = edges.get(sym)
    if (edge === undefined) continue
    if (edge >= thresholds.entryEdge) candidates.push({ symbol: sym, edge, side: POS_LONG })
    else if (allowShorts && -edge >= thresholds.entryEdge) candidates.push({ symbol: sym, edge, side: POS_SHORT })
  }
  candidates.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))

  const netWorth = ns.getServerMoneyAvailable("home") + portfolioValue(ns, symbols)
  const weight = Math.min(cfg.maxWeightPerSymbol, 1 / Math.max(1, Math.min(cfg.maxPositions, candidates.length)))
  const targetShares = (candidate: Candidate): number => {
    const price = ns.stock.getPrice(candidate.symbol)
    return price > 0 ? Math.floor((netWorth * weight) / price) : 0
  }
  const budget: Budget = { remaining: Math.max(0, ns.getServerMoneyAvailable("home") - cfg.moneyKeep) }

  for (const candidate of candidates) {
    if (held.size >= cfg.maxPositions || budget.remaining <= 0) break
    if (held.has(candidate.symbol)) continue
    if (growPosition(ns, candidate, cfg, targetShares(candidate), budget, actions)) {
      held.add(candidate.symbol)
    }
  }

  for (const candidate of candidates) {
    if (held.size < cfg.maxPositions) break
    if (held.has(candidate.symbol)) continue

    let weakest: string | null = null
    let weakestEdge = Infinity
    for (const sym of held) {
      const magnitude = Math.abs(edges.get(sym) ?? 0)
      if (magnitude < weakestEdge) {
        weakestEdge = magnitude
        weakest = sym
      }
    }
    if (weakest === null || Math.abs(candidate.edge) <= weakestEdge * thresholds.rotateMargin) continue

    const [weakLong, , weakShort] = ns.stock.getPosition(weakest)
    if (weakLong > 0) sellPartial(ns, weakest, weakLong, POS_LONG, actions, "SELL")
    if (weakShort > 0) sellPartial(ns, weakest, weakShort, POS_SHORT, actions, "COVER")
    held.delete(weakest)
    budget.remaining = Math.max(0, ns.getServerMoneyAvailable("home") - cfg.moneyKeep)
    if (growPosition(ns, candidate, cfg, targetShares(candidate), budget, actions)) {
      held.add(candidate.symbol)
    }
  }

  for (const candidate of candidates) {
    if (budget.remaining <= 0) break
    if (!held.has(candidate.symbol)) continue
    growPosition(ns, candidate, cfg, targetShares(candidate), budget, actions)
  }

  if (actions.length === 0) {
    if (budget.remaining <= 0) {
      actions.push("(no trades: no investable cash above reserve)")
    } else if (candidates.length === 0) {
      actions.push(`(no trades: no symbol reaches edge ${(thresholds.entryEdge * 100).toFixed(2)}%)`)
    } else {
      actions.push("(no trades: positions already at target weight)")
    }
  }

  return actions
}

export function formatSnapshotMoney(ns: NS, value: number): string {
  return formatMoney(ns, value)
}
