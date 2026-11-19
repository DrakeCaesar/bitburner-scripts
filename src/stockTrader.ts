import { NS } from "@ns"
import { killOtherInstances } from "@/libraries/batchCalculations.js"
import { parseStockTraderArgs } from "@/libraries/stock/args.js"
import { mergeStockTraderConfig } from "@/libraries/stock/config.js"
import { STOCK_TABS, renderStockTraderDashboard } from "@/libraries/stock/display.js"
import { publishStockInfluence, stockInfluenceFor } from "@/libraries/stock/influence.js"
import {
  collectTraderSnapshot,
  createStockTraderState,
  hasAnyStockPosition,
  hasMarketData,
  hasRequiredStockAccess,
  liquidateAllPositions,
  runStockTradingTick,
} from "@/libraries/stock/trader.js"
import { createTabbedTailLog, openTailLog } from "@/libraries/scriptLogUiLayout.js"

async function runLiquidateMode(ns: NS): Promise<void> {
  openTailLog(ns, "WSE Liquidate")
  const tabbedLog = createTabbedTailLog(STOCK_TABS)

  if (!hasAnyStockPosition(ns)) {
    ns.tprint("No stock positions to close.")
    return
  }
  // Nothing is held after this, so hack/grow workers should stop influencing stocks.
  publishStockInfluence(ns, {})

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

      const snapshot = collectTraderSnapshot(
        ns,
        mergeStockTraderConfig({}),
        sessionStartNetWorth,
        tickCount,
        actions
      )
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
  openTailLog(ns, "WSE Trader")
  const tabbedLog = createTabbedTailLog(STOCK_TABS)
  const state = createStockTraderState()
  // A stale broadcast would keep workers pushing forecasts for positions this script no longer manages.
  ns.atExit(() => publishStockInfluence(ns, {}))

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

      const actions = runStockTradingTick(ns, config, state)
      tickCount++
      // Tell hack/grow workers which company servers to push in our favour (see influence.ts).
      publishStockInfluence(ns, stockInfluenceFor(ns))

      const snapshot = collectTraderSnapshot(ns, config, sessionStartNetWorth, tickCount, actions, state)
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
    ns.tprint("Need TIX API access. Buy it from the WSE (5b) and run: run stockTrader.js")
    return
  }

  if (!hasMarketData(ns)) {
    const config = mergeStockTraderConfig({})
    ns.tprint(
      `No 4S Market Data TIX API: forecasts and volatilities are unavailable, ` +
        `so the edge is estimated from the last ${config.historyTicks} price updates instead. ` +
        `Expect fewer, noisier trades than with 4S.`,
    )
  }

  const { mode } = parseStockTraderArgs(ns)
  if (mode === "liquidate") {
    await runLiquidateMode(ns)
    return
  }

  await runTradeMode(ns)
}
