import { NS } from "@ns"
import type { SimContext } from "./types.js"

const ABC_SALES_BOTS = "ABC SalesBots"
const ABC_SALES_BENEFIT = 0.01

/** Load timing constants and multipliers for stage simulation. */
export function buildSimContext(ns: NS, industryAdvertisingFactor = 0.04): SimContext {
  const constants = ns.corporation.getConstants()
  const corp = ns.corporation

  let corpSalesMult = 1
  if (corp.hasCorporation()) {
    try {
      const level = corp.getUpgradeLevel(ABC_SALES_BOTS)
      corpSalesMult = 1 + level * ABC_SALES_BENEFIT
    } catch {
      // upgrade API unavailable
    }
  }

  return {
    secondsPerMarketCycle: constants.secondsPerMarketCycle,
    marketCycles: 1,
    corpProductionMult: 1,
    divisionResearchProductionMult: 1,
    divisionSalesMult: 1,
    corpSalesMult,
    advertisingFactor: industryAdvertisingFactor,
    industryAdvertisingFactor,
  }
}
