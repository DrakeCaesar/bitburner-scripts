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

function signalForSnapshot(
  snap: Pick<
    StockSymbolSnapshot,
    "longShares" | "shortShares" | "forecast" | "volatility" | "price"
  >,
  config: StockTraderConfig,
  totalNetWorth: number,
  allowShorts: boolean
): string {
  const volOk = snap.volatility <= config.maxVolatility
  const parts: string[] = []
  const longValue = snap.longShares * snap.price
  const longOverweight =
    snap.longShares > 0 && longValue > totalNetWorth * config.portfolioFractionPerSymbol

  if (snap.longShares > 0) {
    if (snap.forecast < config.longSellForecast) {
      parts.push("sell long")
    } else if (longOverweight) {
      parts.push("trim long")
    } else {
      parts.push("hold long")
    }
  } else if (volOk && snap.forecast >= config.longBuyForecast) {
    parts.push("buy long")
  }
  if (allowShorts) {
    const shortValue = snap.shortShares * snap.price
    const shortOverweight =
      snap.shortShares > 0 && shortValue > totalNetWorth * config.portfolioFractionPerSymbol
    if (snap.shortShares > 0) {
      if (snap.forecast > config.shortSellForecast) {
        parts.push("cover short")
      } else if (shortOverweight) {
        parts.push("trim short")
      } else {
        parts.push("hold short")
      }
    } else if (volOk && snap.forecast <= config.shortBuyForecast) {
      parts.push("short")
    }
  }
  return parts.length > 0 ? parts.join(", ") : "wait"
}

function collectSymbolSnapshot(
  ns: NS,
  symbol: string,
  config: StockTraderConfig,
  portfolioValue: number,
  totalNetWorth: number,
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
    maxShares: ns.stock.getMaxShares(symbol),
    longShares,
    avgLongPrice,
    shortShares,
    avgShortPrice,
    longUnrealized: longShares > 0 ? ns.stock.getSaleGain(symbol, longShares, POS_LONG) : 0,
    shortUnrealized: shortShares > 0 ? ns.stock.getSaleGain(symbol, shortShares, POS_SHORT) : 0,
    signal: "",
  }
  snap.signal = signalForSnapshot(snap, config, totalNetWorth, allowShorts)
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
    `long ${cfg.longBuyForecast}/${cfg.longSellForecast}, ` +
    `short ${cfg.shortBuyForecast}/${cfg.shortSellForecast}, ` +
    `vol<=${cfg.maxVolatility}, max ${(cfg.maxShareFraction * 100).toFixed(0)}% sh, ` +
    `port ${(cfg.portfolioFractionPerSymbol * 100).toFixed(0)}%/sym, shorts ${shortLabel}`
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
  const symbols = symbolNames.map((sym) =>
    collectSymbolSnapshot(ns, sym, cfg, portfolio, totalNetWorth, allowShorts)
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
  label: "SELL" | "COVER" | "TRIM"
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

function trimOverweightLong(
  ns: NS,
  symbol: string,
  config: StockTraderConfig,
  totalNetWorth: number,
  actions: string[]
): void {
  const [longShares] = ns.stock.getPosition(symbol)
  if (longShares < config.minShares) return

  const price = ns.stock.getPrice(symbol)
  const positionValue = longShares * price
  const maxValue = totalNetWorth * config.portfolioFractionPerSymbol
  if (positionValue <= maxValue) return

  const targetShares = Math.floor(maxValue / price)
  const sharesToTarget = longShares - targetShares
  const maxTrim = Math.max(config.minShares, Math.floor(longShares * config.trimFractionPerTick))
  const sellShares = Math.min(sharesToTarget, maxTrim)
  if (sellShares >= config.minShares) {
    sellPartial(ns, symbol, sellShares, POS_LONG, actions, "TRIM")
  }
}

function trimOverweightShort(
  ns: NS,
  symbol: string,
  config: StockTraderConfig,
  totalNetWorth: number,
  actions: string[]
): void {
  const [, , shortShares] = ns.stock.getPosition(symbol)
  if (shortShares < config.minShares) return

  const price = ns.stock.getPrice(symbol)
  const positionValue = shortShares * price
  const maxValue = totalNetWorth * config.portfolioFractionPerSymbol
  if (positionValue <= maxValue) return

  const targetShares = Math.floor(maxValue / price)
  const sharesToTarget = shortShares - targetShares
  const maxTrim = Math.max(config.minShares, Math.floor(shortShares * config.trimFractionPerTick))
  const coverShares = Math.min(sharesToTarget, maxTrim)
  if (coverShares >= config.minShares) {
    sellPartial(ns, symbol, coverShares, POS_SHORT, actions, "TRIM")
  }
}

interface TradeCandidate {
  symbol: string
  forecast: number
  side: StockPositionSide
  held: number
}

function budgetCapForSymbol(totalBudget: number, remainingBudget: number, fraction: number): number {
  return Math.min(remainingBudget, Math.max(0, totalBudget * fraction))
}

function maxBuyableShares(
  ns: NS,
  symbol: string,
  _side: StockPositionSide,
  maxShareFraction: number,
  currentHeld: number
): number {
  const cap = Math.floor(ns.stock.getMaxShares(symbol) * maxShareFraction) - currentHeld
  return Math.max(0, cap)
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

function tryBuyCandidate(
  ns: NS,
  candidate: TradeCandidate,
  config: StockTraderConfig,
  budget: { total: number; remaining: number },
  actions: string[]
): void {
  const symbolBudget = budgetCapForSymbol(budget.total, budget.remaining, config.budgetFractionPerSymbol)
  const maxShares = maxBuyableShares(
    ns,
    candidate.symbol,
    candidate.side,
    config.maxShareFraction,
    candidate.held
  )
  const shares = sharesAffordable(
    ns,
    candidate.symbol,
    candidate.side,
    symbolBudget,
    config.minShares,
    maxShares
  )
  if (shares <= 0) return

  const before = ns.getServerMoneyAvailable("home")
  buyShares(ns, candidate.symbol, shares, candidate.side, actions)
  budget.remaining -= before - ns.getServerMoneyAvailable("home")
}

/** One market tick: exit weak positions, trim overweight, then enter strong ones. */
export function runStockTradingTick(
  ns: NS,
  config: StockTraderConfig = DEFAULT_STOCK_TRADER_CONFIG
): string[] {
  const cfg = mergeStockTraderConfig(config)
  const allowShorts = shortsActive(ns, cfg)
  const actions: string[] = []
  const symbols = ns.stock.getSymbols()
  const homeCash = ns.getServerMoneyAvailable("home")
  const portfolio = portfolioValue(ns, symbols)
  const totalNetWorth = homeCash + portfolio

  for (const sym of symbols) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym)
    const forecast = ns.stock.getForecast(sym)

    if (longShares > 0 && forecast < cfg.longSellForecast) {
      sellPartial(ns, sym, longShares, POS_LONG, actions, "SELL")
    } else if (longShares > 0 && forecast >= cfg.longSellForecast) {
      trimOverweightLong(ns, sym, cfg, totalNetWorth, actions)
    }

    if (allowShorts && shortShares > 0 && forecast > cfg.shortSellForecast) {
      sellPartial(ns, sym, shortShares, POS_SHORT, actions, "COVER")
    } else if (allowShorts && shortShares > 0 && forecast <= cfg.shortSellForecast) {
      trimOverweightShort(ns, sym, cfg, totalNetWorth, actions)
    }
  }

  const budget = { total: Math.max(0, ns.getServerMoneyAvailable("home") - cfg.moneyKeep), remaining: 0 }
  budget.remaining = budget.total

  const longCandidates: TradeCandidate[] = []
  const shortCandidates: TradeCandidate[] = []

  for (const sym of symbols) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym)
    const forecast = ns.stock.getForecast(sym)
    const vol = ns.stock.getVolatility(sym)
    if (vol > cfg.maxVolatility) continue

    if (forecast >= cfg.longBuyForecast) {
      const maxShares = maxBuyableShares(ns, sym, POS_LONG, cfg.maxShareFraction, longShares)
      if (maxShares >= cfg.minShares) {
        longCandidates.push({ symbol: sym, forecast, side: POS_LONG, held: longShares })
      }
    }

    if (allowShorts && forecast <= cfg.shortBuyForecast) {
      const maxShares = maxBuyableShares(ns, sym, POS_SHORT, cfg.maxShareFraction, shortShares)
      if (maxShares >= cfg.minShares) {
        shortCandidates.push({ symbol: sym, forecast, side: POS_SHORT, held: shortShares })
      }
    }
  }

  longCandidates.sort((a, b) => b.forecast - a.forecast)
  shortCandidates.sort((a, b) => a.forecast - b.forecast)

  for (const candidate of longCandidates) {
    if (budget.remaining <= 0) break
    tryBuyCandidate(ns, candidate, cfg, budget, actions)
  }

  for (const candidate of shortCandidates) {
    if (budget.remaining <= 0) break
    tryBuyCandidate(ns, candidate, cfg, budget, actions)
  }

  if (actions.length === 0) {
    if (budget.total <= 0) {
      actions.push("(no trades: no investable cash above reserve)")
    } else if (longCandidates.length === 0 && shortCandidates.length === 0) {
      actions.push("(no trades: no symbols pass forecast/vol filters)")
    } else {
      actions.push("(no trades: budget or share caps blocked all orders)")
    }
  }

  return actions
}

export function formatSnapshotMoney(ns: NS, value: number): string {
  return formatMoney(ns, value)
}
