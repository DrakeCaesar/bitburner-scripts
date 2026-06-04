import { NS } from "@ns"
import { killOtherInstances } from "@/libraries/batchCalculations.js"
import { parseStockTraderArgs } from "@/libraries/stock/args.js"
import { STOCK_LOG_LAYOUT, STOCK_TABS, renderStockTraderDashboard } from "@/libraries/stock/display.js"
import {
  collectTraderSnapshot,
  hasAnyStockPosition,
  hasRequiredStockAccess,
  liquidateAllPositions,
  runStockTradingTick,
} from "@/libraries/stock/trader.js"
import { TabbedScriptLogBuilder, initScriptLogTail } from "@/libraries/scriptLogUi.js"

async function runLiquidateMode(ns: NS): Promise<void> {
  initScriptLogTail(ns, "WSE Liquidate", STOCK_LOG_LAYOUT)
  const tabbedLog = new TabbedScriptLogBuilder(STOCK_TABS, STOCK_LOG_LAYOUT)

  if (!hasAnyStockPosition(ns)) {
    ns.tprint("No stock positions to close.")
    return
  }

  let tickCount = 0
  const symbols = ns.stock.getSymbols()
  const sessionStartNetWorth =
    ns.getServerMoneyAvailable("home") +
    symbols.reduce((sum, sym) => {
      const [long, , short, avgShort] = ns.stock.getPosition(sym)
      const price = ns.stock.getPrice(sym)
      return sum + long * price + (short > 0 ? short * (2 * avgShort - price) : 0)
    }, 0)

  while (true) {
    try {
      const actions = liquidateAllPositions(ns)
      tickCount++

      const snapshot = collectTraderSnapshot(ns, {}, sessionStartNetWorth, tickCount, actions)
      snapshot.configSummary = "LIQUIDATE — sell all longs, cover all shorts, then exit"
      await renderStockTraderDashboard(ns, tabbedLog, snapshot)

      if (!hasAnyStockPosition(ns)) {
        ns.tprint(`Liquidation complete. Home cash: $${ns.format.number(ns.getServerMoneyAvailable("home"))}`)
        return
      }

      await ns.stock.nextUpdate()
    } catch (err) {
      ns.clearLog()
      ns.print(`ERROR: ${String(err)}`)
      return
    }
  }
}

async function runTradeMode(ns: NS): Promise<void> {
  const { config } = parseStockTraderArgs(ns)
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

export async function main(ns: NS): Promise<void> {
  await killOtherInstances(ns)

  if (!hasRequiredStockAccess(ns)) {
    ns.tprint("Need TIX API and 4S Market Data TIX API. Run: run stockTrader.js")
    return
  }

  const { mode } = parseStockTraderArgs(ns)
  if (mode === "liquidate") {
    await runLiquidateMode(ns)
    return
  }

  await runTradeMode(ns)
}
