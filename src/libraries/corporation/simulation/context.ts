import { NS } from "@ns"
import type { SimContext } from "./types.js"

/** Load timing constants and multipliers for stage simulation. */
export function buildSimContext(ns: NS, divisionAdvertisingFactor = 0.1): SimContext {
  const constants = ns.corporation.getConstants()
  const mults = ns.getBitNodeMultipliers() as Record<string, number | undefined>

  const corpProductionMult =
    mults.CorporationIndustryProductionMult ??
    mults.corporationIndustryProductionMult ??
    mults.CorporationProductionMult ??
    1

  const corpSalesMult =
    mults.CorporationSalesMult ?? mults.corporationSalesMult ?? mults.CorporationSalesMult ?? 1

  return {
    secondsPerMarketCycle: constants.secondsPerMarketCycle,
    marketCycles: 1,
    corpProductionMult,
    divisionResearchProductionMult: 1,
    divisionSalesMult: 1,
    corpSalesMult,
    advertisingFactor: divisionAdvertisingFactor,
    industryAdvertisingFactor: divisionAdvertisingFactor,
  }
}
