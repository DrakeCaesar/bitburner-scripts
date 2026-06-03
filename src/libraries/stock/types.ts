/** TIX API PositionType: Long = "L", Short = "S". */
export type StockPositionSide = "L" | "S"

export interface StockSymbolSnapshot {
  symbol: string
  price: number
  askPrice: number
  bidPrice: number
  forecast: number
  volatility: number
  maxShares: number
  longShares: number
  avgLongPrice: number
  shortShares: number
  avgShortPrice: number
  longUnrealized: number
  shortUnrealized: number
  /** Plain-language action hint for the UI. */
  signal: string
}

export interface StockTraderSnapshot {
  symbols: StockSymbolSnapshot[]
  homeCash: number
  moneyKeep: number
  investableCash: number
  portfolioValue: number
  totalNetWorth: number
  sessionStartNetWorth: number
  sessionProfit: number
  commission: number
  tickCount: number
  lastTickActions: string[]
  configSummary: string
}
