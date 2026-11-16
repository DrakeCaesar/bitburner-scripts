/**
 * Frozen snapshot of the first stock-trading strategy (v1), kept only so the benchmark can show
 * what the current strategy improves on. Do not edit: this is the reference baseline.
 *
 * Source: src/libraries/stock/trader.ts at commit b4feb55.
 * v1 entered on forecast alone (`forecast >= 0.6`), ranked by forecast, spent a fixed 12% of the
 * budget per symbol, trimmed anything above 12% of net worth and capped itself at 25% of
 * getMaxShares(). It ignores how large the expected move is, which is the whole edge.
 */

import type { NS } from "@ns"
import { canUseStockShorts } from "@/libraries/stock/trader.js"
import type { StockPositionSide } from "@/libraries/stock/types.js"

const POS_LONG: StockPositionSide = "L"
const POS_SHORT: StockPositionSide = "S"

export interface TraderV1Config {
  moneyKeep: number
  maxShareFraction: number
  portfolioFractionPerSymbol: number
  trimFractionPerTick: number
  budgetFractionPerSymbol: number
  minShares: number
  longBuyForecast: number
  longSellForecast: number
  shortBuyForecast: number
  shortSellForecast: number
  maxVolatility: number
  enableShorts: boolean
}

export const TRADER_V1_CONFIG: TraderV1Config = {
  moneyKeep: 1e9,
  maxShareFraction: 0.25,
  portfolioFractionPerSymbol: 0.12,
  trimFractionPerTick: 0.05,
  budgetFractionPerSymbol: 0.12,
  minShares: 50,
  longBuyForecast: 0.6,
  longSellForecast: 0.5,
  shortBuyForecast: 0.35,
  shortSellForecast: 0.5,
  maxVolatility: 0.05,
  enableShorts: true,
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
  config: TraderV1Config,
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
  config: TraderV1Config,
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
  config: TraderV1Config,
  budget: { total: number; remaining: number },
  actions: string[]
): void {
  const symbolBudget = budgetCapForSymbol(budget.total, budget.remaining, config.budgetFractionPerSymbol)
  const maxShares = maxBuyableShares(ns, candidate.symbol, config.maxShareFraction, candidate.held)
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

/** One market tick as v1 ran it: exit weak positions, trim overweight, then enter strong ones. */
export function runStockTradingTickV1(
  ns: NS,
  config: TraderV1Config = TRADER_V1_CONFIG
): string[] {
  const cfg = config
  const allowShorts = cfg.enableShorts && canUseStockShorts(ns)
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
      const maxShares = maxBuyableShares(ns, sym, cfg.maxShareFraction, longShares)
      if (maxShares >= cfg.minShares) {
        longCandidates.push({ symbol: sym, forecast, side: POS_LONG, held: longShares })
      }
    }

    if (allowShorts && forecast <= cfg.shortBuyForecast) {
      const maxShares = maxBuyableShares(ns, sym, cfg.maxShareFraction, shortShares)
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
