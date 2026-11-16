/**
 * Local Bitburner stock market model for benchmarks (bench/stock/stockTraderBench.ts).
 *
 * Hand-ported from ../bitburner-src (branch: stable):
 *  - src/StockMarket/Stock.ts
 *  - src/StockMarket/StockMarket.ts            (init, stockMarketCycle, processStockPrices)
 *  - src/StockMarket/StockMarketHelpers.ts     (transaction cost/gain, forecast influence)
 *  - src/StockMarket/BuyingAndSelling.tsx      (buy/sell/short/cover)
 *  - src/StockMarket/data/Constants.ts
 *  - src/StockMarket/data/InitStockMetadata.ts
 *  - src/NetscriptFunctions/StockMarket.ts     (API surface + return values)
 *
 * Intentional deviations:
 *  - Seeded RNG (mulberry32) instead of Math.random, so runs are reproducible.
 *  - One updatePrices() call is one 6s stock update. The real-time guard
 *    (msPerStockUpdateMin) and offline catch-up are not modelled.
 *  - No limit/stop orders, no Darknet volatility promotions (multiplier = 1),
 *    no hacking/company-work forecast influence.
 */

export const MS_PER_STOCK_UPDATE = 6e3
export const TICKS_PER_CYCLE = 75
export const STOCK_MARKET_COMMISSION = 100e3
export const FORECAST_CHANGE_PER_PRICE_MOVEMENT = 0.006

export type PositionSide = "L" | "S"
export type Rng = () => number

/** Deterministic PRNG. Same seed -> identical market. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomIntInclusive(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1) + min)
}

export interface SimStockMetadata {
  name: string
  symbol: string
  b: boolean
  /** Initial price range (integer draw), as in InitStockMetadata. */
  price: readonly [number, number]
  marketCap: number
  /** Volatility range in percent (game divides by 100). */
  mv: readonly [number, number]
  otlkMag: number
  /** Spread range in percent*10 (game divides by 10). */
  spread: readonly [number, number]
  /** Shares transacted for one price movement. */
  shareTx: readonly [number, number]
}

/** InitStockMetadata, in StockSymbol order (the order ns.stock.getSymbols() returns). */
export const INIT_STOCK_METADATA: readonly SimStockMetadata[] = [
  { name: "ECorp", symbol: "ECP", b: true, price: [17e3, 28e3], marketCap: 2.4e12, mv: [40, 50], otlkMag: 19, spread: [1, 5], shareTx: [30e3, 90e3] },
  { name: "MegaCorp", symbol: "MGCP", b: true, price: [24e3, 34e3], marketCap: 2.4e12, mv: [40, 50], otlkMag: 19, spread: [1, 5], shareTx: [30e3, 90e3] },
  { name: "Blade Industries", symbol: "BLD", b: true, price: [12e3, 25e3], marketCap: 1.6e12, mv: [70, 80], otlkMag: 13, spread: [1, 6], shareTx: [30e3, 90e3] },
  { name: "Clarke Incorporated", symbol: "CLRK", b: true, price: [10e3, 25e3], marketCap: 1.5e12, mv: [65, 75], otlkMag: 12, spread: [1, 5], shareTx: [30e3, 90e3] },
  { name: "OmniTek Incorporated", symbol: "OMTK", b: true, price: [32e3, 43e3], marketCap: 1.8e12, mv: [60, 70], otlkMag: 12, spread: [1, 6], shareTx: [30e3, 90e3] },
  { name: "Four Sigma", symbol: "FSIG", b: true, price: [50e3, 80e3], marketCap: 2e12, mv: [100, 110], otlkMag: 17, spread: [1, 10], shareTx: [30e3, 90e3] },
  { name: "KuaiGong International", symbol: "KGI", b: true, price: [16e3, 28e3], marketCap: 1.9e12, mv: [75, 85], otlkMag: 10, spread: [1, 7], shareTx: [30e3, 90e3] },
  { name: "Fulcrum Technologies", symbol: "FLCM", b: true, price: [29e3, 36e3], marketCap: 2e12, mv: [120, 130], otlkMag: 16, spread: [1, 10], shareTx: [30e3, 90e3] },
  { name: "Storm Technologies", symbol: "STM", b: true, price: [20e3, 25e3], marketCap: 1.2e12, mv: [80, 90], otlkMag: 7, spread: [2, 10], shareTx: [36e3, 108e3] },
  { name: "DefComm", symbol: "DCOMM", b: true, price: [6e3, 19e3], marketCap: 900e9, mv: [60, 70], otlkMag: 10, spread: [2, 10], shareTx: [36e3, 108e3] },
  { name: "Helios Labs", symbol: "HLS", b: true, price: [10e3, 18e3], marketCap: 825e9, mv: [55, 65], otlkMag: 9, spread: [2, 10], shareTx: [36e3, 108e3] },
  { name: "VitaLife", symbol: "VITA", b: true, price: [8e3, 14e3], marketCap: 1e12, mv: [70, 80], otlkMag: 7, spread: [2, 10], shareTx: [36e3, 108e3] },
  { name: "Icarus Microsystems", symbol: "ICRS", b: true, price: [12e3, 24e3], marketCap: 800e9, mv: [60, 70], otlkMag: 7.5, spread: [3, 10], shareTx: [36e3, 108e3] },
  { name: "Universal Energy", symbol: "UNV", b: true, price: [16e3, 29e3], marketCap: 900e9, mv: [50, 60], otlkMag: 10, spread: [2, 10], shareTx: [36e3, 108e3] },
  { name: "AeroCorp", symbol: "AERO", b: true, price: [8e3, 17e3], marketCap: 640e9, mv: [55, 65], otlkMag: 6, spread: [3, 10], shareTx: [42e3, 126e3] },
  { name: "Omnia Cybersystems", symbol: "OMN", b: true, price: [6e3, 15e3], marketCap: 600e9, mv: [65, 75], otlkMag: 4.5, spread: [4, 11], shareTx: [42e3, 126e3] },
  { name: "Solaris Space Systems", symbol: "SLRS", b: true, price: [14e3, 28e3], marketCap: 705e9, mv: [70, 80], otlkMag: 8.5, spread: [4, 12], shareTx: [42e3, 126e3] },
  { name: "Global Pharmaceuticals", symbol: "GPH", b: true, price: [12e3, 30e3], marketCap: 695e9, mv: [55, 65], otlkMag: 10.5, spread: [4, 10], shareTx: [42e3, 126e3] },
  { name: "Nova Medical", symbol: "NVMD", b: true, price: [15e3, 27e3], marketCap: 600e9, mv: [70, 80], otlkMag: 5, spread: [4, 11], shareTx: [42e3, 126e3] },
  { name: "Watchdog Security", symbol: "WDS", b: true, price: [4e3, 8.5e3], marketCap: 450e9, mv: [240, 260], otlkMag: 1.5, spread: [5, 12], shareTx: [12e3, 54e3] },
  { name: "LexoCorp", symbol: "LXO", b: true, price: [4.5e3, 8e3], marketCap: 300e9, mv: [115, 135], otlkMag: 6, spread: [5, 12], shareTx: [36e3, 108e3] },
  { name: "Rho Construction", symbol: "RHOC", b: true, price: [2e3, 7e3], marketCap: 180e9, mv: [50, 70], otlkMag: 1, spread: [3, 10], shareTx: [60e3, 126e3] },
  { name: "Alpha Enterprises", symbol: "APHE", b: true, price: [4e3, 8.5e3], marketCap: 240e9, mv: [175, 205], otlkMag: 10, spread: [5, 16], shareTx: [30e3, 90e3] },
  { name: "SysCore Securities", symbol: "SYSC", b: true, price: [3e3, 8e3], marketCap: 200e9, mv: [150, 170], otlkMag: 3, spread: [5, 12], shareTx: [15e3, 90e3] },
  { name: "CompuTek", symbol: "CTK", b: true, price: [1e3, 6e3], marketCap: 185e9, mv: [80, 100], otlkMag: 4, spread: [4, 12], shareTx: [60e3, 126e3] },
  { name: "NetLink Technologies", symbol: "NTLK", b: true, price: [1e3, 5e3], marketCap: 58e9, mv: [200, 400], otlkMag: 1, spread: [5, 20], shareTx: [18e3, 54e3] },
  { name: "Omega Software", symbol: "OMGA", b: true, price: [1e3, 8e3], marketCap: 60e9, mv: [90, 110], otlkMag: 0.5, spread: [4, 13], shareTx: [30e3, 90e3] },
  { name: "FoodNStuff", symbol: "FNS", b: false, price: [500, 4.5e3], marketCap: 45e9, mv: [70, 80], otlkMag: 1, spread: [6, 10], shareTx: [60e3, 180e3] },
  { name: "Joe's Guns", symbol: "JGN", b: true, price: [250, 1.5e3], marketCap: 42e9, mv: [200, 350], otlkMag: 1, spread: [6, 14], shareTx: [15e3, 52e3] },
  { name: "Sigma Cosmetics", symbol: "SGC", b: true, price: [1.5e3, 3.5e3], marketCap: 30e9, mv: [100, 275], otlkMag: 0, spread: [6, 14], shareTx: [20e3, 70e3] },
  { name: "Catalyst Ventures", symbol: "CTYS", b: true, price: [250, 1.5e3], marketCap: 100e9, mv: [120, 175], otlkMag: 13.5, spread: [5, 14], shareTx: [24e3, 72e3] },
  { name: "Microdyne Technologies", symbol: "MDYN", b: true, price: [15e3, 30e3], marketCap: 360e9, mv: [70, 80], otlkMag: 8, spread: [3, 10], shareTx: [90e3, 216e3] },
  { name: "Titan Laboratories", symbol: "TITN", b: true, price: [12e3, 24e3], marketCap: 420e9, mv: [50, 70], otlkMag: 11, spread: [2, 10], shareTx: [90e3, 216e3] },
]

export class SimStock {
  readonly name: string
  readonly symbol: string
  readonly mv: number
  readonly spreadPerc: number
  readonly shareTxForMovement: number
  readonly totalShares: number
  readonly maxShares: number
  readonly cap: number

  b: boolean
  otlkMag: number
  otlkMagForecast: number
  price: number
  lastPrice: number
  playerShares = 0
  playerAvgPx = 0
  playerShortShares = 0
  playerAvgShortPx = 0
  shareTxUntilMovement: number

  private readonly rng: Rng

  constructor(meta: SimStockMetadata, rng: Rng) {
    this.rng = rng
    this.name = meta.name
    this.symbol = meta.symbol
    this.b = meta.b
    this.otlkMag = meta.otlkMag

    this.price = randomIntInclusive(rng, meta.price[0], meta.price[1])
    this.lastPrice = this.price
    this.mv = randomIntInclusive(rng, meta.mv[0], meta.mv[1]) / 100
    this.cap = randomIntInclusive(rng, this.price * 1e3, this.price * 25e3)
    this.spreadPerc = randomIntInclusive(rng, meta.spread[0], meta.spread[1]) / 10
    this.shareTxForMovement = randomIntInclusive(rng, meta.shareTx[0], meta.shareTx[1])
    this.shareTxUntilMovement = this.shareTxForMovement

    this.totalShares = Math.round(meta.marketCap / this.price / 1e5) * 1e5
    this.maxShares = Math.round((this.totalShares * 0.2) / 1e5) * 1e5

    this.otlkMagForecast = this.getAbsoluteForecast()
  }

  /** Absolute forecast as a fraction: 0 = certain to fall, 1 = certain to rise. */
  getForecast(): number {
    return this.getAbsoluteForecast() / 100
  }

  /** Volatility as ns.stock.getVolatility() reports it: stock.mv / 100. */
  getVolatility(): number {
    return this.mv / 100
  }

  changeForecastForecast(newff: number): void {
    this.otlkMagForecast = Math.min(100, Math.max(0, newff))
  }

  changePrice(newPrice: number): void {
    this.lastPrice = this.price
    this.price = newPrice
  }

  cycleForecast(changeAmt = 0.1): void {
    if (this.rng() < this.getForecastIncreaseChance()) {
      if (this.b) this.otlkMag += changeAmt
      else this.otlkMag -= changeAmt
    } else if (this.b) {
      this.otlkMag -= changeAmt
    } else {
      this.otlkMag += changeAmt
    }

    this.otlkMag = Math.min(this.otlkMag, 50)
    if (this.otlkMag < 0) {
      this.otlkMag *= -1
      this.b = !this.b
    }
  }

  cycleForecastForecast(changeAmt = 0.1): void {
    if (this.rng() < 0.5) this.changeForecastForecast(this.otlkMagForecast + changeAmt)
    else this.changeForecastForecast(this.otlkMagForecast - changeAmt)
  }

  flipForecastForecast(): void {
    this.otlkMagForecast = 100 - this.otlkMagForecast
  }

  getAbsoluteForecast(): number {
    return this.b ? 50 + this.otlkMag : 50 - this.otlkMag
  }

  getAskPrice(): number {
    return this.price * (1 + this.spreadPerc / 100)
  }

  getBidPrice(): number {
    return this.price * (1 - this.spreadPerc / 100)
  }

  getForecastIncreaseChance(): number {
    const diff = this.otlkMagForecast - this.getAbsoluteForecast()
    return (50 + Math.min(Math.max(diff, -45), 45)) / 100
  }

  influenceForecast(change: number): void {
    if (this.otlkMag > 5) this.otlkMag = Math.max(5, this.otlkMag - change)
  }

  influenceForecastForecast(change: number): void {
    if (this.otlkMagForecast > 50) this.otlkMagForecast = Math.max(50, this.otlkMagForecast - change)
    else if (this.otlkMagForecast < 50) this.otlkMagForecast = Math.min(50, this.otlkMagForecast + change)
  }

  /** Total long + short shares held (the game caps this at maxShares). */
  get totalHeldShares(): number {
    return this.playerShares + this.playerShortShares
  }
}

/** Total cost of buying `shares` (long: ask price, short: bid price) including commission. */
export function getBuyTransactionCost(stock: SimStock, shares: number, side: PositionSide): number {
  shares = Math.min(shares, stock.maxShares)
  return side === "L"
    ? shares * stock.getAskPrice() + STOCK_MARKET_COMMISSION
    : shares * stock.getBidPrice() + STOCK_MARKET_COMMISSION
}

/** Total cash returned by selling/closing `shares`, after commission. */
export function getSellTransactionGain(stock: SimStock, shares: number, side: PositionSide): number {
  shares = Math.min(shares, stock.maxShares)
  if (side === "L") return shares * stock.getBidPrice() - STOCK_MARKET_COMMISSION
  const origCost = shares * stock.playerAvgShortPx
  const profit = (stock.playerAvgShortPx - stock.getAskPrice()) * shares - STOCK_MARKET_COMMISSION
  return origCost + profit
}

/** Trading moves forecast towards 50 in proportion to shares traded. */
export function processTransactionForecastMovement(stock: SimStock, requestedShares: number): void {
  const shares = Math.min(requestedShares, stock.maxShares)
  if (Number.isNaN(shares) || shares <= 0) return

  const firstShares = stock.shareTxUntilMovement
  if (shares <= firstShares) {
    stock.shareTxUntilMovement -= shares
    if (stock.shareTxUntilMovement <= 0) {
      stock.shareTxUntilMovement = stock.shareTxForMovement
      stock.influenceForecast(FORECAST_CHANGE_PER_PRICE_MOVEMENT)
      stock.influenceForecastForecast(FORECAST_CHANGE_PER_PRICE_MOVEMENT * (stock.mv / 100))
    }
    return
  }

  const remainingShares = shares - firstShares
  let numIterations = 1 + Math.ceil(remainingShares / stock.shareTxForMovement)
  stock.shareTxUntilMovement =
    stock.shareTxForMovement - ((shares - stock.shareTxUntilMovement) % stock.shareTxForMovement)
  if (stock.shareTxUntilMovement === stock.shareTxForMovement || stock.shareTxUntilMovement <= 0) {
    ++numIterations
    stock.shareTxUntilMovement = stock.shareTxForMovement
  }

  const forecastChange = FORECAST_CHANGE_PER_PRICE_MOVEMENT * (numIterations - 1)
  stock.influenceForecast(forecastChange)
  stock.influenceForecastForecast(forecastChange * (stock.mv / 100))
}

export interface SimTrade {
  tick: number
  symbol: string
  side: PositionSide
  kind: "buy" | "sell" | "short" | "cover"
  shares: number
  /** Per-share ask price (buy/cover) or bid price (sell/short). */
  price: number
  /** Change in home cash caused by this fill (negative when buying/opening a short). */
  cashDelta: number
  /** Realized P/L vs. average cost basis; 0 for opening trades. */
  realized: number
  forecast: number
}

export interface TradeRequestResult {
  shares: number
  price: number
  cashDelta: number
  realized: number
}

/**
 * Stock market state + player cash. One `updatePrices()` is one 6s stock update.
 * The player's home money is `cash` (what `ns.getServerMoneyAvailable("home")` returns).
 */
export class StockMarketSim {
  readonly rng: Rng
  readonly stocks: SimStock[]
  readonly bySymbol = new Map<string, SimStock>()
  readonly trades: SimTrade[] = []

  cash: number
  tick = 0
  ticksUntilCycle: number

  constructor(options: { seed: number; cash: number; rng?: Rng }) {
    this.rng = options.rng ?? mulberry32(options.seed)
    this.cash = options.cash
    this.stocks = INIT_STOCK_METADATA.map((meta) => new SimStock(meta, this.rng))
    for (const stock of this.stocks) this.bySymbol.set(stock.symbol, stock)
    this.ticksUntilCycle = randomIntInclusive(this.rng, 1, TICKS_PER_CYCLE)
  }

  getSymbols(): string[] {
    return this.stocks.map((stock) => stock.symbol)
  }

  getStock(symbol: string): SimStock {
    const stock = this.bySymbol.get(symbol)
    if (!stock) throw new Error(`Invalid stock symbol: '${symbol}'`)
    return stock
  }

  private stockMarketCycle(): void {
    for (const stock of this.stocks) {
      if (this.rng() < 0.45) {
        stock.b = !stock.b
        stock.flipForecastForecast()
      }
      this.ticksUntilCycle = TICKS_PER_CYCLE
    }
  }

  /** One 6s stock update (processStockPrices after its cycle accounting). */
  updatePrices(): void {
    this.tick++
    this.ticksUntilCycle--
    if (this.ticksUntilCycle <= 0) this.stockMarketCycle()

    const v = this.rng()
    for (const stock of this.stocks) {
      const volatility = stock.mv
      let av = (v * volatility) / 100
      if (Number.isNaN(av)) av = 0.02

      let chc = 50
      if (stock.b) chc = (chc + stock.otlkMag) / 100
      else chc = (chc - stock.otlkMag) / 100
      if (stock.price >= stock.cap) {
        chc = 0.1
        stock.b = false
      }
      if (Number.isNaN(chc)) chc = 0.5

      const c = this.rng()
      if (c < chc) stock.changePrice(stock.price * (1 + av))
      else stock.changePrice(stock.price / (1 + av))

      let otlkMagChange = stock.otlkMag * av
      if (stock.otlkMag < 5) {
        if (stock.otlkMag <= 1) otlkMagChange = 1
        else otlkMagChange *= 10
      }
      stock.cycleForecast(otlkMagChange)
      stock.cycleForecastForecast(otlkMagChange / 2)

      stock.shareTxUntilMovement = Math.min(stock.shareTxUntilMovement + 10, stock.shareTxForMovement)
    }
  }

  private pushTrade(trade: SimTrade): void {
    this.trades.push(trade)
  }

  /** Returns the executed per-share price, or 0 when the order is rejected (like ns.stock.buyStock). */
  buyLong(symbol: string, _shares: number): number {
    const stock = this.getStock(symbol)
    const shares = Math.round(_shares)
    if (shares <= 0) return 0
    const totalPrice = getBuyTransactionCost(stock, shares, "L")
    if (this.cash < totalPrice) return 0
    if (shares + stock.totalHeldShares > stock.maxShares) return 0

    const origTotal = stock.playerShares * stock.playerAvgPx
    this.cash -= totalPrice
    const newTotal = origTotal + totalPrice - STOCK_MARKET_COMMISSION
    stock.playerShares = Math.round(stock.playerShares + shares)
    stock.playerAvgPx = newTotal / stock.playerShares
    processTransactionForecastMovement(stock, shares)

    this.pushTrade({
      tick: this.tick,
      symbol,
      side: "L",
      kind: "buy",
      shares,
      price: stock.getAskPrice(),
      cashDelta: -totalPrice,
      realized: 0,
      forecast: stock.getForecast(),
    })
    return stock.getAskPrice()
  }

  /** Returns cash gained per share (bid price), or 0 when nothing was sold. */
  sellLong(symbol: string, _shares: number): number {
    const stock = this.getStock(symbol)
    let shares = Math.round(_shares)
    if (shares <= 0) return 0
    if (shares > stock.playerShares) shares = stock.playerShares
    if (shares === 0) return 0

    const gains = getSellTransactionGain(stock, shares, "L")
    const realized = gains - stock.playerAvgPx * shares
    this.cash += gains
    stock.playerShares = Math.round(stock.playerShares - shares)
    if (stock.playerShares === 0) stock.playerAvgPx = 0
    processTransactionForecastMovement(stock, shares)

    this.pushTrade({
      tick: this.tick,
      symbol,
      side: "L",
      kind: "sell",
      shares,
      price: stock.getBidPrice(),
      cashDelta: gains,
      realized,
      forecast: stock.getForecast(),
    })
    return stock.getBidPrice()
  }

  /** Returns the executed per-share price (bid), or 0 when the order is rejected. */
  openShort(symbol: string, _shares: number): number {
    const stock = this.getStock(symbol)
    const shares = Math.round(_shares)
    if (shares <= 0) return 0
    const totalPrice = getBuyTransactionCost(stock, shares, "S")
    if (this.cash < totalPrice) return 0
    if (shares + stock.totalHeldShares > stock.maxShares) return 0

    const origTotal = stock.playerShortShares * stock.playerAvgShortPx
    this.cash -= totalPrice
    const newTotal = origTotal + totalPrice - STOCK_MARKET_COMMISSION
    stock.playerShortShares = Math.round(stock.playerShortShares + shares)
    stock.playerAvgShortPx = newTotal / stock.playerShortShares
    processTransactionForecastMovement(stock, shares)

    this.pushTrade({
      tick: this.tick,
      symbol,
      side: "S",
      kind: "short",
      shares,
      price: stock.getBidPrice(),
      cashDelta: -totalPrice,
      realized: 0,
      forecast: stock.getForecast(),
    })
    return stock.getBidPrice()
  }

  /** Returns cash gained per share (ask price), or 0 when nothing was covered. */
  closeShort(symbol: string, _shares: number): number {
    const stock = this.getStock(symbol)
    let shares = Math.round(_shares)
    if (shares <= 0) return 0
    if (shares > stock.playerShortShares) shares = stock.playerShortShares
    if (shares === 0) return 0

    const origCost = shares * stock.playerAvgShortPx
    const totalGain = getSellTransactionGain(stock, shares, "S")
    const realized = totalGain - origCost
    this.cash += totalGain
    stock.playerShortShares = Math.round(stock.playerShortShares - shares)
    if (stock.playerShortShares === 0) stock.playerAvgShortPx = 0
    processTransactionForecastMovement(stock, shares)

    this.pushTrade({
      tick: this.tick,
      symbol,
      side: "S",
      kind: "cover",
      shares,
      price: stock.getAskPrice(),
      cashDelta: totalGain,
      realized,
      forecast: stock.getForecast(),
    })
    return stock.getAskPrice()
  }

  getPurchaseCost(symbol: string, shares: number, side: PositionSide): number {
    const rounded = Math.round(shares)
    if (Number.isNaN(rounded) || rounded <= 0) return Infinity
    return getBuyTransactionCost(this.getStock(symbol), rounded, side)
  }

  getSaleGain(symbol: string, shares: number, side: PositionSide): number {
    const rounded = Math.round(shares)
    if (Number.isNaN(rounded) || rounded <= 0) return 0
    return getSellTransactionGain(this.getStock(symbol), rounded, side)
  }

  /** Long positions at market price; shorts marked as (2 * avgShort - price) per share. */
  positionsValue(): number {
    let total = 0
    for (const stock of this.stocks) {
      if (stock.playerShares > 0) total += stock.playerShares * stock.price
      if (stock.playerShortShares > 0) {
        total += stock.playerShortShares * (2 * stock.playerAvgShortPx - stock.price)
      }
    }
    return total
  }

  netWorth(): number {
    return this.cash + this.positionsValue()
  }

  hasAnyPosition(): boolean {
    return this.stocks.some((stock) => stock.playerShares > 0 || stock.playerShortShares > 0)
  }

  /** Cash flow per symbol (negative on opens) plus the current mark, i.e. per-symbol P/L. */
  symbolProfit(symbol: string): { cashFlow: number; mark: number; profit: number; trades: number } {
    let cashFlow = 0
    let trades = 0
    for (const trade of this.trades) {
      if (trade.symbol !== symbol) continue
      cashFlow += trade.cashDelta
      trades++
    }
    const stock = this.getStock(symbol)
    let mark = stock.playerShares * stock.price
    if (stock.playerShortShares > 0) mark += stock.playerShortShares * (2 * stock.playerAvgShortPx - stock.price)
    return { cashFlow, mark, profit: cashFlow + mark, trades }
  }
}

const SUFFIXES = ["", "k", "m", "b", "t", "q", "Q", "s", "S", "o", "n", "e"]

function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value
}

/** ns.format.number approximation (suffixes past 1e3, trimmed trailing zeros). */
export function formatNumber(n: number, fractionalDigits = 3): string {
  if (Number.isNaN(n)) return "NaN"
  if (!Number.isFinite(n)) return n < 0 ? "-Infinity" : "Infinity"
  const abs = Math.abs(n)
  if (abs < 1000) return trimZeros(n.toFixed(fractionalDigits))
  const tier = Math.min(Math.floor(Math.log10(abs) / 3), SUFFIXES.length - 1)
  return `${trimZeros((n / 10 ** (tier * 3)).toFixed(fractionalDigits))}${SUFFIXES[tier]}`
}

/** The subset of NS used by src/libraries/stock/trader.ts. */
export interface StockTraderNsStub {
  args: unknown[]
  stock: {
    getSymbols(): string[]
    getPrice(symbol: string): number
    getAskPrice(symbol: string): number
    getBidPrice(symbol: string): number
    getForecast(symbol: string): number
    getVolatility(symbol: string): number
    getMaxShares(symbol: string): number
    getPosition(symbol: string): [number, number, number, number]
    getPurchaseCost(symbol: string, shares: number, side: PositionSide): number
    getSaleGain(symbol: string, shares: number, side: PositionSide): number
    getConstants(): Record<string, number>
    hasTixApiAccess(): boolean
    has4SDataTixApi(): boolean
    buyStock(symbol: string, shares: number): number
    sellStock(symbol: string, shares: number): number
    buyShort(symbol: string, shares: number): number
    sellShort(symbol: string, shares: number): number
  }
  getServerMoneyAvailable(host: string): number
  getResetInfo(): { currentNode: number; ownedSF: Map<number, number> }
  format: { number: (n: number, fractionalDigits?: number) => string }
}

export interface NsStubOptions {
  bitNode?: number
  ownedSf8?: number
  args?: unknown[]
  /** False models a player without the 4S Market Data TIX API: forecast and volatility throw. */
  marketData?: boolean
}

/** Fake NS backed by the simulation. Cast to NS when calling in-game strategy code. */
export function createNsStub(sim: StockMarketSim, options: NsStubOptions = {}): StockTraderNsStub {
  const bitNode = options.bitNode ?? 8
  const ownedSf8 = options.ownedSf8 ?? 3
  const marketData = options.marketData ?? true
  const requireMarketData = (name: string): void => {
    // The game throws rather than returning a placeholder, so the strategy must never call these.
    if (!marketData) throw new Error(`You don't have 4S Market Data TIX API Access! (${name})`)
  }
  const constants = {
    msPerStockUpdate: MS_PER_STOCK_UPDATE,
    msPerStockUpdateMin: 4e3,
    TicksPerCycle: TICKS_PER_CYCLE,
    WseAccountCost: 200e6,
    TixApiCost: 5e9,
    MarketData4SCost: 1e9,
    MarketDataTixApi4SCost: 25e9,
    StockMarketCommission: STOCK_MARKET_COMMISSION,
  }

  return {
    args: options.args ?? [],
    stock: {
      getSymbols: () => sim.getSymbols(),
      getPrice: (symbol) => sim.getStock(symbol).price,
      getAskPrice: (symbol) => sim.getStock(symbol).getAskPrice(),
      getBidPrice: (symbol) => sim.getStock(symbol).getBidPrice(),
      getForecast: (symbol) => {
        requireMarketData("getForecast")
        return sim.getStock(symbol).getForecast()
      },
      getVolatility: (symbol) => {
        requireMarketData("getVolatility")
        return sim.getStock(symbol).getVolatility()
      },
      getMaxShares: (symbol) => sim.getStock(symbol).maxShares,
      getPosition: (symbol) => {
        const stock = sim.getStock(symbol)
        return [stock.playerShares, stock.playerAvgPx, stock.playerShortShares, stock.playerAvgShortPx]
      },
      getPurchaseCost: (symbol, shares, side) => sim.getPurchaseCost(symbol, shares, side),
      getSaleGain: (symbol, shares, side) => sim.getSaleGain(symbol, shares, side),
      getConstants: () => ({ ...constants }),
      hasTixApiAccess: () => true,
      has4SDataTixApi: () => marketData,
      buyStock: (symbol, shares) => sim.buyLong(symbol, shares),
      sellStock: (symbol, shares) => sim.sellLong(symbol, shares),
      buyShort: (symbol, shares) => sim.openShort(symbol, shares),
      sellShort: (symbol, shares) => sim.closeShort(symbol, shares),
    },
    getServerMoneyAvailable: () => sim.cash,
    getResetInfo: () => ({ currentNode: bitNode, ownedSF: new Map([[8, ownedSf8]]) }),
    format: { number: formatNumber },
  }
}
