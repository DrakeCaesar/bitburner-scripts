import "@ns"

declare module "@ns" {
  interface StockMarketConstants {
    StockMarketCommission: number
    msPerStockUpdate: number
  }

  /** Long = "L", Short = "S" */
  type StockPositionType = "L" | "S"

  interface StockAPI {
    getSymbols(): string[]
    getPrice(sym: string): number
    getAskPrice(sym: string): number
    getBidPrice(sym: string): number
    getForecast(sym: string): number
    getVolatility(sym: string): number
    getMaxShares(sym: string): number
    getPosition(sym: string): [number, number, number, number]
    getPurchaseCost(sym: string, shares: number, positionType: StockPositionType): number
    getSaleGain(sym: string, shares: number, positionType: StockPositionType): number
    getConstants(): StockMarketConstants
    hasTixApiAccess(): boolean
    has4SDataTixApi(): boolean
    buyStock(sym: string, shares: number): number
    sellStock(sym: string, shares: number): void
    buyShort(sym: string, shares: number): number
    sellShort(sym: string, shares: number): void
    nextUpdate(): Promise<number>
  }

  interface NS {
    readonly stock: StockAPI
  }
}
