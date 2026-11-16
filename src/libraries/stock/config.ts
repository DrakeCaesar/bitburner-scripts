/**
 * The strategy trades on *edge*: the expected price move per market update,
 *
 *   edge = (2 * forecast - 1) * volatility
 *
 * With 4S data the forecast is the probability that the next update is an up move
 * (`chc = (50 + otlkMag) / 100` in the game's processStockPrices), so `2 * forecast - 1` is the
 * sign bias of the move and `volatility` is its size. Their product is the per-update expected
 * return, which is what the entry threshold and the candidate ranking compare against.
 */
export interface StockTraderConfig {
  /** Cash left on home; not used for new purchases. */
  moneyKeep: number
  /** Minimum |edge| required to open a position. */
  entryEdge: number
  /** Close a position once its |edge| falls to this (0 = when the expected move turns negative). */
  exitEdge: number
  /** Entry threshold used instead of entryEdge when there is no 4S data. */
  no4sEntryEdge: number
  /** Rotation margin used instead of rotateMargin when there is no 4S data. */
  no4sRotateMargin: number
  /** Maximum number of symbols held at the same time. */
  maxPositions: number
  /** Cap on one symbol's share of net worth (only binds when few candidates qualify). */
  maxWeightPerSymbol: number
  /** Fraction of getMaxShares() we allow ourselves to hold (limits our market impact). */
  maxShareFraction: number
  /** Swap the weakest holding for a candidate when its edge is this many times larger. */
  rotateMargin: number
  /** Updates of price history averaged to estimate the edge when there is no 4S data. */
  historyTicks: number
  /** Skip orders smaller than this (commission is $100k per transaction). */
  minShares: number
  enableShorts: boolean
}

export const DEFAULT_STOCK_TRADER_CONFIG: StockTraderConfig = {
  moneyKeep: 1e9,
  entryEdge: 0.0025,
  exitEdge: 0,
  // Without 4S the edge is estimated from price history: it correlates ~0.55 with the real edge,
  // so a higher bar is needed to clear the same cost, and swapping positions on that estimate
  // mostly trades noise. Measured on the model (15 seeds, 3000 updates, $10b):
  // entryEdge 0.004 + no rotation 555% mean return, versus 50% at the 4S defaults.
  no4sEntryEdge: 0.004,
  no4sRotateMargin: 100,
  maxPositions: 4,
  maxWeightPerSymbol: 0.34,
  maxShareFraction: 1,
  rotateMargin: 1.5,
  historyTicks: 40,
  minShares: 50,
  enableShorts: true,
}

function finiteOrDefault(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** Merge partial config and fill any missing/stale fields from defaults. */
export function mergeStockTraderConfig(partial?: Partial<StockTraderConfig>): StockTraderConfig {
  const d = DEFAULT_STOCK_TRADER_CONFIG
  const merged = { ...d, ...partial }
  return {
    moneyKeep: finiteOrDefault(merged.moneyKeep, d.moneyKeep),
    entryEdge: finiteOrDefault(merged.entryEdge, d.entryEdge),
    exitEdge: finiteOrDefault(merged.exitEdge, d.exitEdge),
    no4sEntryEdge: finiteOrDefault(merged.no4sEntryEdge, d.no4sEntryEdge),
    no4sRotateMargin: finiteOrDefault(merged.no4sRotateMargin, d.no4sRotateMargin),
    maxPositions: Math.max(1, Math.round(finiteOrDefault(merged.maxPositions, d.maxPositions))),
    maxWeightPerSymbol: finiteOrDefault(merged.maxWeightPerSymbol, d.maxWeightPerSymbol),
    maxShareFraction: finiteOrDefault(merged.maxShareFraction, d.maxShareFraction),
    rotateMargin: finiteOrDefault(merged.rotateMargin, d.rotateMargin),
    historyTicks: Math.max(3, Math.round(finiteOrDefault(merged.historyTicks, d.historyTicks))),
    minShares: Math.max(0, Math.round(finiteOrDefault(merged.minShares, d.minShares))),
    enableShorts: merged.enableShorts ?? d.enableShorts,
  }
}
