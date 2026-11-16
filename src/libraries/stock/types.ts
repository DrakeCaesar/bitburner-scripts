/** TIX API PositionType: Long = "L", Short = "S". */
export type StockPositionSide = "L" | "S"

export interface StockSymbolSnapshot {
  symbol: string
  price: number
  askPrice: number
  bidPrice: number
  forecast: number
  volatility: number
  /** Expected move per market update: (2 * forecast - 1) * volatility. NaN while unknown. */
  edge: number
  /** True when the edge was estimated from price history because there is no 4S data. */
  edgeFromPrices: boolean
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
