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

function signalForSnapshot(
  snap: Pick<StockSymbolSnapshot, "longShares" | "shortShares" | "edge">,
  config: StockTraderConfig,
  allowShorts: boolean
): string {
  const parts: string[] = []
  if (snap.longShares > 0) parts.push(snap.edge <= config.exitEdge ? "sell long" : "hold long")
  else if (snap.edge >= config.entryEdge) parts.push("buy long")
  if (snap.shortShares > 0) parts.push(-snap.edge <= config.exitEdge ? "cover short" : "hold short")
  else if (allowShorts && -snap.edge >= config.entryEdge) parts.push("short")
  return parts.length > 0 ? parts.join(", ") : "wait"
}

function collectSymbolSnapshot(
  ns: NS,
  symbol: string,
  config: StockTraderConfig,
  allowShorts: boolean
): StockSymbolSnapshot {
  const [longShares, avgLongPrice, shortShares, avgShortPrice] = ns.stock.getPosition(symbol)
  const forecast = ns.stock.getForecast(symbol)
  const volatility = ns.stock.getVolatility(symbol)
  const snap: StockSymbolSnapshot = {
    symbol,
    price: ns.stock.getPrice(symbol),
    askPrice: ns.stock.getAskPrice(symbol),
    bidPrice: ns.stock.getBidPrice(symbol),
    forecast,
    volatility,
    edge: stockEdge(forecast, volatility),
    maxShares: ns.stock.getMaxShares(symbol),
    longShares,
    avgLongPrice,
    shortShares,
    avgShortPrice,
    longUnrealized: longShares > 0 ? ns.stock.getSaleGain(symbol, longShares, POS_LONG) : 0,
    shortUnrealized: shortShares > 0 ? ns.stock.getSaleGain(symbol, shortShares, POS_SHORT) : 0,
    signal: "",
  }
  snap.signal = signalForSnapshot(snap, config, allowShorts)
  return snap
}

export function hasRequiredStockAccess(ns: NS): boolean {
  return ns.stock.hasTixApiAccess() && ns.stock.has4SDataTixApi()
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
  return (
    `edge>=${(cfg.entryEdge * 100).toFixed(2)}%/tick, exit at ${(cfg.exitEdge * 100).toFixed(2)}%, ` +
    `${cfg.maxPositions} pos, ${(cfg.maxWeightPerSymbol * 100).toFixed(0)}%/sym, ` +
    `${(cfg.maxShareFraction * 100).toFixed(0)}% of max shares, rotate x${cfg.rotateMargin}, shorts ${shortLabel}`
  )
}

export function collectTraderSnapshot(
  ns: NS,
  config: StockTraderConfig,
  sessionStartNetWorth: number,
  tickCount: number,
  lastTickActions: string[]
): StockTraderSnapshot {
  const cfg = mergeStockTraderConfig(config)
  const allowShorts = shortsActive(ns, cfg)
  const symbolNames = ns.stock.getSymbols()
  const homeCash = ns.getServerMoneyAvailable("home")
  const portfolio = portfolioValue(ns, symbolNames)
  const totalNetWorth = homeCash + portfolio
  const symbols = symbolNames.map((sym) => collectSymbolSnapshot(ns, sym, cfg, allowShorts))

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

/**
 * One market tick. Ranks every symbol by edge, closes positions whose edge has turned,
 * fills open slots with the strongest candidates, rotates capital out of the weakest holding
 * when something much better appears, then tops the remaining holdings up to target weight.
 */
export function runStockTradingTick(
  ns: NS,
  config: StockTraderConfig = DEFAULT_STOCK_TRADER_CONFIG
): string[] {
  const cfg = mergeStockTraderConfig(config)
  const allowShorts = shortsActive(ns, cfg)
  const actions: string[] = []
  const symbols = ns.stock.getSymbols()

  const edges = new Map<string, number>()
  for (const sym of symbols) {
    edges.set(sym, stockEdge(ns.stock.getForecast(sym), ns.stock.getVolatility(sym)))
  }

  const held = new Set<string>()
  for (const sym of symbols) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym)
    const edge = edges.get(sym) ?? 0
    let longLeft = longShares
    let shortLeft = shortShares
    if (longShares > 0 && edge <= cfg.exitEdge) {
      sellPartial(ns, sym, longShares, POS_LONG, actions, "SELL")
      longLeft = 0
    }
    if (allowShorts && shortShares > 0 && -edge <= cfg.exitEdge) {
      sellPartial(ns, sym, shortShares, POS_SHORT, actions, "COVER")
      shortLeft = 0
    }
    if (longLeft > 0 || shortLeft > 0) held.add(sym)
  }

  const candidates: Candidate[] = []
  for (const sym of symbols) {
    const edge = edges.get(sym) ?? 0
    if (edge >= cfg.entryEdge) candidates.push({ symbol: sym, edge, side: POS_LONG })
    else if (allowShorts && -edge >= cfg.entryEdge) candidates.push({ symbol: sym, edge, side: POS_SHORT })
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
    if (weakest === null || Math.abs(candidate.edge) <= weakestEdge * cfg.rotateMargin) continue

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
      actions.push(`(no trades: no symbol reaches edge ${(cfg.entryEdge * 100).toFixed(2)}%)`)
    } else {
      actions.push("(no trades: positions already at target weight)")
    }
  }

  return actions
}

export function formatSnapshotMoney(ns: NS, value: number): string {
  return formatMoney(ns, value)
}
