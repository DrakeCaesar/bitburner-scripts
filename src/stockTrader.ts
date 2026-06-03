import { NS } from "@ns"
import { killOtherInstances } from "@/libraries/batchCalculations.js"
import { mergeStockTraderConfig, type StockTraderConfig } from "@/libraries/stock/config.js"
import { STOCK_LOG_LAYOUT, STOCK_TABS, renderStockTraderDashboard } from "@/libraries/stock/display.js"
import {
  collectTraderSnapshot,
  hasRequiredStockAccess,
  runStockTradingTick,
} from "@/libraries/stock/trader.js"
import { TabbedScriptLogBuilder, initScriptLogTail } from "@/libraries/scriptLogUi.js"

/** Optional args: [moneyKeep] [enableShorts 0|1] */
function configFromArgs(ns: NS): StockTraderConfig {
  const overrides: Partial<StockTraderConfig> = {}
  if (ns.args.length > 0 && ns.args[0] !== "") {
    const keep = Number(ns.args[0])
    if (Number.isFinite(keep) && keep >= 0) overrides.moneyKeep = keep
  }
  if (ns.args.length > 1 && ns.args[1] !== "") {
    const shorts = Number(ns.args[1])
    if (shorts === 0) overrides.enableShorts = false
    if (shorts === 1) overrides.enableShorts = true
  }
  return mergeStockTraderConfig(overrides)
}

export async function main(ns: NS): Promise<void> {
  await killOtherInstances(ns)

  if (!hasRequiredStockAccess(ns)) {
    ns.tprint("Need TIX API and 4S Market Data TIX API. Run: run stockTrader.js")
    return
  }

  const config = configFromArgs(ns)
  initScriptLogTail(ns, "WSE Trader", STOCK_LOG_LAYOUT)
  const tabbedLog = new TabbedScriptLogBuilder(STOCK_TABS, STOCK_LOG_LAYOUT)

  let sessionStartNetWorth = 0
  let tickCount = 0

  while (true) {
    try {
      await ns.stock.nextUpdate()

      if (tickCount === 0) {
        const symbols = ns.stock.getSymbols()
        sessionStartNetWorth =
          ns.getServerMoneyAvailable("home") +
          symbols.reduce((sum, sym) => {
            const [long, , short, avgShort] = ns.stock.getPosition(sym)
            const price = ns.stock.getPrice(sym)
            return sum + long * price + (short > 0 ? short * (2 * avgShort - price) : 0)
          }, 0)
      }

      const actions = runStockTradingTick(ns, config)
      tickCount++

      const snapshot = collectTraderSnapshot(ns, config, sessionStartNetWorth, tickCount, actions)
      await renderStockTraderDashboard(ns, tabbedLog, snapshot)
    } catch (err) {
      ns.clearLog()
      ns.print(`ERROR: ${String(err)}`)
      return
    }
  }
}
