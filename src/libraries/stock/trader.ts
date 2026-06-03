import { NS } from "@ns"
import { DEFAULT_STOCK_TRADER_CONFIG, type StockTraderConfig } from "@/libraries/stock/config.js"
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
  snap: Pick<StockSymbolSnapshot, "longShares" | "shortShares" | "forecast" | "volatility">,
  config: StockTraderConfig
): string {
  const volOk = snap.volatility <= config.maxVolatility
  const parts: string[] = []
  if (snap.longShares > 0) {
    parts.push(snap.forecast < config.longSellForecast ? "sell long" : "hold long")
  } else if (volOk && snap.forecast >= config.longBuyForecast) {
    parts.push("buy long")
  }
  if (config.enableShorts) {
    if (snap.shortShares > 0) {
      parts.push(snap.forecast > config.shortSellForecast ? "cover short" : "hold short")
    } else if (volOk && snap.forecast <= config.shortBuyForecast) {
      parts.push("short")
    }
  }
  return parts.length > 0 ? parts.join(", ") : "wait"
}

function collectSymbolSnapshot(ns: NS, symbol: string, config: StockTraderConfig): StockSymbolSnapshot {
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
  snap.signal = signalForSnapshot(snap, config)
  return snap
}

export function hasRequiredStockAccess(ns: NS): boolean {
  return ns.stock.hasTixApiAccess() && ns.stock.has4SDataTixApi()
}

export function buildConfigSummary(config: StockTraderConfig): string {
  const short = config.enableShorts ? "on" : "off"
  return (
    `long ${config.longBuyForecast}/${config.longSellForecast}, ` +
    `short ${config.shortBuyForecast}/${config.shortSellForecast}, ` +
    `vol<=${config.maxVolatility}, min ${config.minShares} sh, shorts ${short}`
  )
}

export function collectTraderSnapshot(
  ns: NS,
  config: StockTraderConfig,
  sessionStartNetWorth: number,
  tickCount: number,
  lastTickActions: string[]
): StockTraderSnapshot {
  const symbols = ns.stock.getSymbols().map((sym) => collectSymbolSnapshot(ns, sym, config))
  const homeCash = ns.getServerMoneyAvailable("home")
  const portfolio = portfolioValue(
    ns,
    symbols.map((s) => s.symbol)
  )
  const totalNetWorth = homeCash + portfolio

  return {
    symbols,
    homeCash,
    moneyKeep: config.moneyKeep,
    investableCash: Math.max(0, homeCash - config.moneyKeep),
    portfolioValue: portfolio,
    totalNetWorth,
    sessionStartNetWorth,
    sessionProfit: totalNetWorth - sessionStartNetWorth,
    commission: ns.stock.getConstants().StockMarketCommission,
    tickCount,
    lastTickActions,
    configSummary: buildConfigSummary(config),
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

function sellAll(
  ns: NS,
  symbol: string,
  shares: number,
  side: StockPositionSide,
  actions: string[]
): void {
  if (shares < 1) return
  if (side === POS_LONG) {
    ns.stock.sellStock(symbol, shares)
    actions.push(`SELL ${symbol} x${shares}`)
  } else {
    ns.stock.sellShort(symbol, shares)
    actions.push(`COVER ${symbol} x${shares}`)
  }
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

/** One market tick: exit weak positions, then enter strong ones. */
export function runStockTradingTick(ns: NS, config: StockTraderConfig = DEFAULT_STOCK_TRADER_CONFIG): string[] {
  const actions: string[] = []
  const symbols = ns.stock.getSymbols()

  for (const sym of symbols) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym)
    const forecast = ns.stock.getForecast(sym)
    const vol = ns.stock.getVolatility(sym)

    if (longShares > 0 && forecast < config.longSellForecast) {
      sellAll(ns, sym, longShares, POS_LONG, actions)
    }
    if (config.enableShorts && shortShares > 0 && forecast > config.shortSellForecast) {
      sellAll(ns, sym, shortShares, POS_SHORT, actions)
    }
  }

  let budget = Math.max(0, ns.getServerMoneyAvailable("home") - config.moneyKeep)

  for (const sym of symbols) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym)
    const forecast = ns.stock.getForecast(sym)
    const vol = ns.stock.getVolatility(sym)
    if (vol > config.maxVolatility) continue

    if (longShares === 0 && forecast >= config.longBuyForecast) {
      const maxShares = maxBuyableShares(ns, sym, POS_LONG, config.maxShareFraction, 0)
      const shares = sharesAffordable(ns, sym, POS_LONG, budget, config.minShares, maxShares)
      if (shares > 0) {
        const before = ns.getServerMoneyAvailable("home")
        buyShares(ns, sym, shares, POS_LONG, actions)
        budget -= before - ns.getServerMoneyAvailable("home")
      }
    }

    if (config.enableShorts && shortShares === 0 && forecast <= config.shortBuyForecast) {
      const maxShares = maxBuyableShares(ns, sym, POS_SHORT, config.maxShareFraction, 0)
      const shares = sharesAffordable(ns, sym, POS_SHORT, budget, config.minShares, maxShares)
      if (shares > 0) {
        const before = ns.getServerMoneyAvailable("home")
        buyShares(ns, sym, shares, POS_SHORT, actions)
        budget -= before - ns.getServerMoneyAvailable("home")
      }
    }
  }

  if (actions.length === 0) {
    actions.push("(no trades)")
  }

  return actions
}

export function formatSnapshotMoney(ns: NS, value: number): string {
  return formatMoney(ns, value)
}
