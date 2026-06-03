import { NS } from "@ns"
import type { SimContext } from "@/libraries/corporation/simulation/types.js"

const ABC_SALES_BOTS = "ABC SalesBots"
const ABC_SALES_BENEFIT = 0.01
const SMART_FACTORIES = "Smart Factories"
/** Matches CorpUpgrades SmartFactories.benefit (additive per level, base value 1). */
const SMART_FACTORIES_BENEFIT = 0.03

/** Corporation.getProductionMultiplier() from Smart Factories levels. */
export function getCorpProductionMultiplier(ns: NS): number {
  const corp = ns.corporation
  if (!corp.hasCorporation()) return 1
  try {
    return 1 + corp.getUpgradeLevel(SMART_FACTORIES) * SMART_FACTORIES_BENEFIT
  } catch {
    return 1
  }
}

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
    corpProductionMult: getCorpProductionMultiplier(ns),
    divisionResearchProductionMult: 1,
    divisionSalesMult: 1,
    corpSalesMult,
    advertisingFactor: industryAdvertisingFactor,
    industryAdvertisingFactor,
    employeeSalaryMultiplier: constants.employeeSalaryMultiplier ?? 1,
  }
}
