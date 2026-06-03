export interface StockTraderConfig {
  /** Cash left on home; not used for new purchases. */
  moneyKeep: number
  /** Max fraction of getMaxShares() held per symbol (limits market impact). */
  maxShareFraction: number
  /** Max fraction of portfolio net worth in one symbol before trimming. */
  portfolioFractionPerSymbol: number
  /** When trimming overweight longs, sell at most this fraction of held shares per tick. */
  trimFractionPerTick: number
  /** Max fraction of investable budget spent on one symbol per tick. */
  budgetFractionPerSymbol: number
  /** Skip trades smaller than this (commission is $100k per txn). */
  minShares: number
  longBuyForecast: number
  longSellForecast: number
  shortBuyForecast: number
  shortSellForecast: number
  maxVolatility: number
  enableShorts: boolean
}

export const DEFAULT_STOCK_TRADER_CONFIG: StockTraderConfig = {
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
    maxShareFraction: finiteOrDefault(merged.maxShareFraction, d.maxShareFraction),
    portfolioFractionPerSymbol: finiteOrDefault(merged.portfolioFractionPerSymbol, d.portfolioFractionPerSymbol),
    trimFractionPerTick: finiteOrDefault(merged.trimFractionPerTick, d.trimFractionPerTick),
    budgetFractionPerSymbol: finiteOrDefault(merged.budgetFractionPerSymbol, d.budgetFractionPerSymbol),
    minShares: finiteOrDefault(merged.minShares, d.minShares),
    longBuyForecast: finiteOrDefault(merged.longBuyForecast, d.longBuyForecast),
    longSellForecast: finiteOrDefault(merged.longSellForecast, d.longSellForecast),
    shortBuyForecast: finiteOrDefault(merged.shortBuyForecast, d.shortBuyForecast),
    shortSellForecast: finiteOrDefault(merged.shortSellForecast, d.shortSellForecast),
    maxVolatility: finiteOrDefault(merged.maxVolatility, d.maxVolatility),
    enableShorts: merged.enableShorts ?? d.enableShorts,
  }
}
