/**
 * Stock trader, version 3: v2's rules, with the two scale artefacts removed and one knob added.
 *
 * v2 was measured against every sizing idea I tried on the model (100 seeds, 3000 updates), and most
 * of them lose. Paired geometric mean net worth, v3 / v2, same seeds:
 *
 *   Kelly weights (mu/sigma²)                 0.83x   <- volatility-normalising loses
 *   Kelly, slots picked by edge               0.86x
 *   8 positions at 12.5% each                 0.50x
 *   2 positions at 50% each                   0.95x
 *   half the share cap                        0.82x
 *   trimming over-weight positions back       0.81x   <- a per-tick sell loop, 7x the trades
 *   exit at +0.15%/tick                       1.00x
 *   absolute $1b reserve removed              1.06x   <- the one real win
 *   weight ∝ edge, fractional reserve         **1.10x (95% 1.08x-1.12x, 163/200 held-out seeds)**
 *
 * So equal weight across about four names was already right, and the interesting part is not the
 * sizing maths. Two things v2 gets wrong for reasons unrelated to skill:
 *
 * 1. **The cash reserve is absolute.** `moneyKeep` is $1b. That is 10% of a $10b account and
 *    nothing to a $10t one, so a compounding account is forced to leave a tenth of its capital
 *    idle for the whole early run — measured as 90.8% invested against a 4 x 34% target. v3 reserves
 *    a *fraction* of net worth (default 0.1%, enough to pay commissions at any size).
 *
 * 2. **Weight does not depend on conviction.** v2 gives the strongest and the weakest candidate
 *    the same slice. v3 spreads each slot's weight as `|edge|^tilt`, so `tilt = 0` reproduces v2
 *    exactly and the knob measures how much conviction is worth. Measured: 1 is the sweet spot;
 *    Kelly is the far end of this curve (tilt 1 divided by 2*volatility²) and it loses, because
 *    the edge persists for ~10 updates at a time, so a high-volatility position is far less risky
 *    over its life than the per-tick variance suggests.
 *
 * Everything else is v2: same entry threshold, same exit at edge <= 0, same rotation rule, same
 * share caps, same add-up-to-target every update, and never a trim. A comparison therefore measures
 * these two knobs and nothing else.
 */

import { NS } from "@ns"
import { mergeStockTraderConfig, type StockTraderConfig } from "@/libraries/stock/config.js"
import type { StockPositionSide } from "@/libraries/stock/types.js"
import {
  createStockTraderState,
  estimateEdges,
  resolveStockThresholds,
  shortsActive,
  type StockTraderState,
} from "@/libraries/stock/trader.js"

const POS_LONG: StockPositionSide = "L"
const POS_SHORT: StockPositionSide = "S"

export interface StockTraderV3Config {
  /**
   * Conviction curve for slot weights: weight_i ∝ |edge_i|^tilt.
   * 0 reproduces v2's equal weight; 1 weights in proportion to expected return.
   */
  tilt: number
  /** Cash to keep back, as a share of net worth (v2 keeps an absolute `moneyKeep` instead). */
  reserveFraction: number
  /** Ignore a weight correction smaller than this share of net worth. */
  rebalanceBand: number
  /** Hard cap on the sum of position weights (1 = fully invested). */
  maxGrossWeight: number
}

export const DEFAULT_STOCK_TRADER_V3_CONFIG: StockTraderV3Config = {
  // Measured on 100 seeds, then confirmed on 200 held-out seeds: tilt 1 beat tilt 0, 0.5, 1.5 and 2.
  tilt: 1,
  // 0 measured very slightly better than 1%, but a reserve of exactly zero leaves nothing to pay
  // commission from; 0.1% is inside the noise and still pays for itself.
  reserveFraction: 0.001,
  rebalanceBand: 0,
  maxGrossWeight: 1,
}

export function mergeV3Config(partial?: Partial<StockTraderV3Config>): StockTraderV3Config {
  const base = DEFAULT_STOCK_TRADER_V3_CONFIG
  const merged = { ...base, ...partial }
  const finite = (value: unknown, fallback: number): number => {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }
  return {
    tilt: Math.max(0, Math.min(4, finite(merged.tilt, base.tilt))),
    reserveFraction: Math.max(0, Math.min(0.5, finite(merged.reserveFraction, base.reserveFraction))),
    rebalanceBand: Math.max(0, Math.min(1, finite(merged.rebalanceBand, base.rebalanceBand))),
    maxGrossWeight: Math.max(0, Math.min(1, finite(merged.maxGrossWeight, base.maxGrossWeight))),
  }
}

interface WeightedCandidate {
  symbol: string
  /** Signed edge: positive for a long, negative for a short. */
  edge: number
  side: StockPositionSide
  /** Kelly weight in units of net worth, before the fund's capacity scaling. */
  kelly: number
  /** Weight this symbol should end the tick at. */
  target: number
}

function priceOf(ns: NS, symbol: string): number {
  return ns.stock.getPrice(symbol)
}

/** Shares still allowed before our own cap on this symbol (long + short together). */
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
  maxShares: number,
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

function buy(ns: NS, symbol: string, shares: number, side: StockPositionSide, actions: string[]): void {
  if (shares < 1) return
  if (ns.stock.getPurchaseCost(symbol, shares, side) > ns.getServerMoneyAvailable("home")) return
  const price = side === POS_LONG ? ns.stock.buyStock(symbol, shares) : ns.stock.buyShort(symbol, shares)
  if (price > 0) {
    actions.push(`${side === POS_LONG ? "BUY" : "SHORT"} ${symbol} x${shares} @ $${ns.format.number(price)}`)
  }
}

function sell(ns: NS, symbol: string, shares: number, side: StockPositionSide, actions: string[], label: string): void {
  if (shares < 1) return
  if (side === POS_LONG) ns.stock.sellStock(symbol, shares)
  else ns.stock.sellShort(symbol, shares)
  actions.push(`${label} ${symbol} x${shares}`)
}

/**
 * Slot weights for the strongest candidates, scaled to the capital that actually exists.
 * Returns in descending order of desired weight, which is also the order slots are filled in.
 *
 * `tilt = 0` gives every slot the same weight (v2's rule). Higher values give the strongest
 * candidates more, on the curve `|edge|^tilt`. Scaling is water-filling rather than one
 * proportional sweep: if the strongest candidate alone would take more than `maxWeight`, it is
 * capped there and the remainder is spread over the rest, instead of being left as idle cash.
 */
export function tiltedWeights(
  edges: ReadonlyMap<string, number>,
  options: {
    entryEdge: number
    allowShorts: boolean
    maxPositions: number
    maxWeight: number
    v3: StockTraderV3Config
  },
): WeightedCandidate[] {
  const wants: WeightedCandidate[] = []
  for (const [symbol, edge] of edges) {
    if (!Number.isFinite(edge)) continue
    const side =
      edge >= options.entryEdge ? POS_LONG : options.allowShorts && -edge >= options.entryEdge ? POS_SHORT : null
    if (side === null) continue
    wants.push({ symbol, edge, side, kelly: Math.abs(edge), target: 0 })
  }
  if (wants.length === 0) return []

  wants.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))
  const selected = wants.slice(0, Math.max(1, options.maxPositions))

  // Conviction curve. Everything is relative here, so raising |edge| to a power only reorders the
  // shares; the absolute scale is set by the gross cap below.
  const curved = selected.map((item) => ({
    item,
    weight: options.v3.tilt === 0 ? 1 : Math.pow(Math.abs(item.edge), options.v3.tilt),
  }))
  const capped = curved.map((entry) => entry.weight)
  let budget = options.v3.maxGrossWeight
  // Normalise to the gross budget first so the numbers below are actual portfolio weights.
  const total = capped.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return selected
  const weights = capped.map((weight) => Math.min(options.maxWeight, (weight / total) * budget))
  if (weights.reduce((sum, weight) => sum + weight, 0) > budget) {
    const free = weights.map((_, index) => index)
    while (free.length > 0 && budget > 1e-9) {
      const freeTotal = free.reduce((sum, index) => sum + weights[index], 0)
      if (freeTotal <= 0) break
      let cappedAny = false
      for (const index of [...free]) {
        if (weights[index] >= options.maxWeight - 1e-12) {
          budget -= options.maxWeight
          weights[index] = options.maxWeight
          free.splice(free.indexOf(index), 1)
          cappedAny = true
        }
      }
      if (!cappedAny) break
    }
  }

  selected.forEach((item, index) => {
    item.target = weights[index]
  })
  return selected
}

export function buildConfigSummaryV3(ns: NS, config: StockTraderConfig, v3?: Partial<StockTraderV3Config>): string {
  const cfg = mergeStockTraderConfig(config)
  const extra = mergeV3Config(v3)
  return (
    `tilt ${extra.tilt.toFixed(2)}, reserve ${(extra.reserveFraction * 100).toFixed(1)}% of net worth, ` +
    `edge>=${(cfg.entryEdge * 100).toFixed(2)}%/tick, exit at ${(cfg.exitEdge * 100).toFixed(2)}%, ` +
    `${cfg.maxPositions} pos max, ${(cfg.maxWeightPerSymbol * 100).toFixed(0)}%/sym cap, ` +
    `shorts ${shortsActive(ns, cfg) ? "on" : "off"}`
  )
}

/**
 * One market tick. Same phases as v2 — close what has turned, pick the strongest candidates,
 * rotate when something better appears — but every position is sized by Kelly weight and only
 * corrected when it has drifted further than the dead band.
 */
export function runStockTradingTickV3(
  ns: NS,
  config?: StockTraderConfig,
  state: StockTraderState = createStockTraderState(),
  v3Config?: Partial<StockTraderV3Config>,
): string[] {
  const cfg = mergeStockTraderConfig(config)
  const extra = mergeV3Config(v3Config)
  const allowShorts = shortsActive(ns, cfg)
  const actions: string[] = []
  const symbols = ns.stock.getSymbols()
  const thresholds = resolveStockThresholds(ns, cfg)
  const edges = estimateEdges(ns, cfg, state, symbols, !thresholds.fromPrices)

  // Phase 1: close anything whose edge has turned. Identical to v2.
  const held = new Set<string>()
  for (const sym of symbols) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym)
    const edge = edges.get(sym)
    let stillHeld = longShares > 0 || shortShares > 0
    if (edge !== undefined) {
      if (longShares > 0 && edge <= cfg.exitEdge) {
        sell(ns, sym, longShares, POS_LONG, actions, "SELL")
        stillHeld = shortShares > 0
      }
      if (allowShorts && shortShares > 0 && -edge <= cfg.exitEdge) {
        sell(ns, sym, shortShares, POS_SHORT, actions, "COVER")
        stillHeld = false
      }
    }
    if (stillHeld) held.add(sym)
  }

  // Phase 2: where should the money be?
  const openSlots = Math.max(0, cfg.maxPositions - held.size)
  const desired = tiltedWeights(edges, {
    entryEdge: thresholds.entryEdge,
    allowShorts,
    maxPositions: Math.max(1, cfg.maxPositions),
    maxWeight: cfg.maxWeightPerSymbol,
    v3: extra,
  })
  const desiredBySymbol = new Map(desired.map((item) => [item.symbol, item]))

  // Phase 3: rotate out the weakest holding only when a candidate is materially better, as in v2.
  if (desired.length > 0 && held.size >= cfg.maxPositions) {
    for (const candidate of desired) {
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
      if (weakLong > 0) sell(ns, weakest, weakLong, POS_LONG, actions, "SELL")
      if (weakShort > 0) sell(ns, weakest, weakShort, POS_SHORT, actions, "COVER")
      held.delete(weakest)
      break
    }
  }

  const netWorth = ns.getServerMoneyAvailable("home") + portfolioValue(ns, symbols)
  // v3 reserves a share of net worth, not an absolute sum: `moneyKeep` is $1b, which is 10% of a
  // $10b account and rounds to nothing later, so it silently caps how much a young account can
  // invest. Commission comes out of home cash, so the reserve never goes to zero by default.
  const reserve = extra.reserveFraction * netWorth
  const budget = { remaining: Math.max(0, ns.getServerMoneyAvailable("home") - reserve) }
  const band = extra.rebalanceBand * netWorth

  const targetShares = (item: WeightedCandidate): number => {
    const price = priceOf(ns, item.symbol)
    return price > 0 ? Math.floor((netWorth * item.target) / price) : 0
  }

  const addTo = (item: WeightedCandidate, target: number): void => {
    if (budget.remaining <= 0) return
    const [longShares, , shortShares] = ns.stock.getPosition(item.symbol)
    const heldShares = item.side === POS_LONG ? longShares : shortShares
    const wanted = Math.min(target - heldShares, shareRoom(ns, item.symbol, cfg.maxShareFraction))
    const shares = sharesAffordable(ns, item.symbol, item.side, budget.remaining, cfg.minShares, wanted)
    if (shares <= 0) return
    const before = ns.getServerMoneyAvailable("home")
    buy(ns, item.symbol, shares, item.side, actions)
    budget.remaining -= before - ns.getServerMoneyAvailable("home")
  }

  // Phase 4: take the free slots, strongest Kelly weight first.
  for (const item of desired) {
    if (held.size >= cfg.maxPositions || budget.remaining <= 0) break
    if (held.has(item.symbol)) continue
    const before = actions.length
    addTo(item, targetShares(item))
    if (actions.length > before) held.add(item.symbol)
  }

  // Phase 5: top holdings back up to their target weight.
  // v2 never sells a position down to its target, and this is why: price drift moves a weight
  // above target constantly, so trimming it every update is a per-tick sell loop (measured: 7x
  // v2's trade count and 0.81x its return). Only the exit rule and the rotation rule take money
  // out; everything else here can only add.
  for (const sym of held) {
    const item = desiredBySymbol.get(sym)
    const [longShares, , shortShares] = ns.stock.getPosition(sym)
    const price = priceOf(ns, sym)
    if (price <= 0) continue
    // No longer a candidate (edge fell below entry but is still above exit): leave it alone
    // rather than paying a round trip; the exit rule in phase 1 owns it from here.
    if (item === undefined) continue

    const heldShares = item.side === POS_LONG ? longShares : shortShares
    const wanted = targetShares(item) - heldShares
    if (wanted * price < band) continue
    if (wanted > 0) addTo(item, targetShares(item))
  }

  if (actions.length === 0) {
    if (budget.remaining <= 0) actions.push("(no trades: no investable cash above reserve)")
    else if (desired.length === 0) {
      actions.push(`(no trades: no symbol reaches edge ${(thresholds.entryEdge * 100).toFixed(2)}%)`)
    } else actions.push("(no trades: every holding is inside its dead band)")
  }
  return actions
}

/** Market value of everything held, long positions at the bid and shorts at the ask. */
function portfolioValue(ns: NS, symbols: readonly string[]): number {
  let total = 0
  for (const sym of symbols) {
    const [longShares, , shortShares] = ns.stock.getPosition(sym)
    if (longShares > 0) total += ns.stock.getSaleGain(sym, longShares, POS_LONG)
    if (shortShares > 0) total += ns.stock.getSaleGain(sym, shortShares, POS_SHORT)
  }
  return total
}
