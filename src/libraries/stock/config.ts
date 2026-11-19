/**
 * The strategy trades on *edge*: the expected price move per market update,
 *
 *   edge = (2 * forecast - 1) * volatility
 *
 * With 4S data the forecast is the probability that the next update is an up move
 * (`chc = (50 + otlkMag) / 100` in the game's processStockPrices), so `2 * forecast - 1` is the
 * sign bias of the move and `volatility` is its size. Their product is the per-update expected
 * return. See docs/stock-trader.md for how every field below was measured.
 */
export interface StockTraderConfig {
  /** Cash never invested, in dollars. The reserve is the larger of this and `reserveFraction`. */
  moneyKeep: number
  /** Cash never invested, as a share of net worth (pays commissions at any account size). */
  reserveFraction: number
  /** Minimum |edge| for a company to receive money. */
  entryEdge: number
  /** Close a position once its |edge| falls to this (0 = when the expected move turns negative). */
  exitEdge: number
  /** Entry threshold used instead of entryEdge when there is no 4S data. */
  no4sEntryEdge: number
  /** Updates of price history used to estimate edge and volatility when there is no 4S data. */
  historyTicks: number
  /** Without 4S, find the market cycle from prices and track each company's sign across it. */
  no4sCycleAware: boolean
  /** Most companies held at once. The allocation decides how many are worth it below this. */
  maxOpenPositions: number
  /** Most of net worth in one company. */
  maxWeight: number
  /** Fraction of getMaxShares() we allow ourselves to hold. */
  maxShareFraction: number
  /** Smallest share of net worth worth opening a new position for. */
  minNewWeight: number
  /** Investable cash is handed out in this many slices per update. */
  slices: number
  /** A swap must earn back this many of the candidate's round trips over the expected horizon. */
  rotationCostFactor: number
  /** Rotation hurdle used instead of rotationCostFactor when there is no 4S data. */
  no4sRotationCostFactor: number
  /** Scale on the modelled forecast impact of our own trades (0 ignores it). */
  impactScale: number
  /** Entry bar for cash that would otherwise sit idle, as a fraction of the entry bar (1 disables it). */
  idleEntryFraction: number
  /** Extra positions the idle-cash pass may open. */
  idleExtraPositions: number
  /** Minimum outlook (|forecast - 50%| * 100) for the idle-cash pass. */
  idleMinOutlook: number
  /** Weight on the variance drag of log growth in the allocation (0 ignores risk, 1 is log-optimal). */
  varianceScale: number
  /** Skip orders smaller than this (commission is $100k per transaction). */
  minShares: number
  enableShorts: boolean
}

export const DEFAULT_STOCK_TRADER_CONFIG: StockTraderConfig = {
  moneyKeep: 0,
  reserveFraction: 0.001,
  entryEdge: 0.0025,
  exitEdge: 0,
  // Without 4S the edge is an estimate that correlates ~0.55 with the real one, so it needs a
  // higher bar and a much higher rotation hurdle: swapping on two noisy numbers mostly trades noise.
  no4sEntryEdge: 0.003,
  historyTicks: 40,
  no4sCycleAware: true,
  maxOpenPositions: 8,
  maxWeight: 1,
  maxShareFraction: 1,
  minNewWeight: 0.02,
  slices: 40,
  rotationCostFactor: 8,
  no4sRotationCostFactor: 64,
  impactScale: 1,
  idleEntryFraction: 0.6,
  idleExtraPositions: 8,
  idleMinOutlook: 10,
  varianceScale: 1,
  minShares: 50,
  enableShorts: true,
}

function finiteOrDefault(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/** Merge partial config and fill any missing/stale fields from defaults. */
export function mergeStockTraderConfig(partial?: Partial<StockTraderConfig>): StockTraderConfig {
  const d = DEFAULT_STOCK_TRADER_CONFIG
  const merged = { ...d, ...partial }
  return {
    moneyKeep: Math.max(0, finiteOrDefault(merged.moneyKeep, d.moneyKeep)),
    reserveFraction: clamp(finiteOrDefault(merged.reserveFraction, d.reserveFraction), 0, 0.5),
    entryEdge: finiteOrDefault(merged.entryEdge, d.entryEdge),
    exitEdge: finiteOrDefault(merged.exitEdge, d.exitEdge),
    no4sEntryEdge: finiteOrDefault(merged.no4sEntryEdge, d.no4sEntryEdge),
    historyTicks: Math.max(3, Math.round(finiteOrDefault(merged.historyTicks, d.historyTicks))),
    no4sCycleAware: merged.no4sCycleAware ?? d.no4sCycleAware,
    maxOpenPositions: Math.max(1, Math.round(finiteOrDefault(merged.maxOpenPositions, d.maxOpenPositions))),
    maxWeight: clamp(finiteOrDefault(merged.maxWeight, d.maxWeight), 0, 1),
    maxShareFraction: clamp(finiteOrDefault(merged.maxShareFraction, d.maxShareFraction), 0, 1),
    minNewWeight: clamp(finiteOrDefault(merged.minNewWeight, d.minNewWeight), 0, 1),
    slices: Math.max(1, Math.round(finiteOrDefault(merged.slices, d.slices))),
    rotationCostFactor: Math.max(0, finiteOrDefault(merged.rotationCostFactor, d.rotationCostFactor)),
    no4sRotationCostFactor: Math.max(0, finiteOrDefault(merged.no4sRotationCostFactor, d.no4sRotationCostFactor)),
    impactScale: Math.max(0, finiteOrDefault(merged.impactScale, d.impactScale)),
    idleEntryFraction: clamp(finiteOrDefault(merged.idleEntryFraction, d.idleEntryFraction), 0, 1),
    idleExtraPositions: Math.max(0, Math.round(finiteOrDefault(merged.idleExtraPositions, d.idleExtraPositions))),
    idleMinOutlook: Math.max(0, finiteOrDefault(merged.idleMinOutlook, d.idleMinOutlook)),
    varianceScale: Math.max(0, finiteOrDefault(merged.varianceScale, d.varianceScale)),
    minShares: Math.max(0, Math.round(finiteOrDefault(merged.minShares, d.minShares))),
    enableShorts: merged.enableShorts ?? d.enableShorts,
  }
}
