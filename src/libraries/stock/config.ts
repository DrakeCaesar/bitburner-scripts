export interface StockTraderConfig {
  /** Cash left on home; not used for new purchases. */
  moneyKeep: number
  /** Max fraction of getMaxShares() per symbol (limits market impact). */
  maxShareFraction: number
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
  maxShareFraction: 1,
  minShares: 50,
  longBuyForecast: 0.6,
  longSellForecast: 0.5,
  shortBuyForecast: 0.35,
  shortSellForecast: 0.5,
  maxVolatility: 0.05,
  enableShorts: true,
}
