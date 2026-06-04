import { NS } from "@ns"
import { mergeStockTraderConfig, type StockTraderConfig } from "@/libraries/stock/config.js"

export type StockTraderMode = "trade" | "liquidate"

const LIQUIDATE_ALIASES = new Set(["liquidate", "sell", "sellall", "exit", "close"])

export interface StockTraderRunOptions {
  mode: StockTraderMode
  config: StockTraderConfig
}

function isLiquidateArg(value: string): boolean {
  return LIQUIDATE_ALIASES.has(value.toLowerCase())
}

/**
 * Args:
 * - `liquidate` | `sell` | `sellall` | `exit` | `close` — sell all positions, then exit
 * - otherwise: `[moneyKeep]` `[enableShorts 0|1]` for normal trading
 */
export function parseStockTraderArgs(ns: NS): StockTraderRunOptions {
  const first = String(ns.args[0] ?? "").trim()
  if (first !== "" && isLiquidateArg(first)) {
    return { mode: "liquidate", config: mergeStockTraderConfig({}) }
  }

  const overrides: Partial<StockTraderConfig> = {}
  if (first !== "") {
    const keep = Number(first)
    if (Number.isFinite(keep) && keep >= 0) overrides.moneyKeep = keep
  }
  if (ns.args.length > 1 && ns.args[1] !== "") {
    const shorts = Number(ns.args[1])
    if (shorts === 0) overrides.enableShorts = false
    if (shorts === 1) overrides.enableShorts = true
  }
  return { mode: "trade", config: mergeStockTraderConfig(overrides) }
}
