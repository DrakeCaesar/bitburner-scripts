import { CityName, CorpMaterialName, NS } from "@ns"
import { computeInputBuyRate, getInputConsumptionPerSec, supplyTier } from "@/libraries/corporation/supplies.js"
import { TOBACCO_DIVISION } from "@/libraries/corporation/tobacco.js"

const PLANTS: CorpMaterialName = "Plants"

function tryBuyMaterial(
  ns: NS,
  divisionName: string,
  city: CityName,
  materialName: CorpMaterialName,
  buyPerSec: number
): string | null {
  try {
    ns.corporation.buyMaterial(divisionName, city, materialName, buyPerSec)
    return null
  } catch (err) {
    return String(err)
  }
}

/** Buy Plants on the market when Export is not available (manual rate, no Smart Supply). */
export function manageTobaccoPlantsSupply(ns: NS): string[] {
  const corp = ns.corporation
  const lines: string[] = []

  if (!corp.hasCorporation() || corp.hasUnlock("Export")) return lines
  if (!corp.getCorporation().divisions.includes(TOBACCO_DIVISION)) return lines

  const division = corp.getDivision(TOBACCO_DIVISION)
  const industry = corp.getIndustryData(division.industry)
  if (industry.requiredMaterials?.[PLANTS] == null) return lines

  for (const city of division.cities) {
    if (!corp.hasWarehouse(TOBACCO_DIVISION, city)) continue

    const warehouse = corp.getWarehouse(TOBACCO_DIVISION, city)
    if (warehouse.smartSupplyEnabled) {
      try {
        corp.setSmartSupply(TOBACCO_DIVISION, city, false)
        lines.push(`${TOBACCO_DIVISION}/${city}: Smart Supply off (manual Plants buys)`)
      } catch (err) {
        lines.push(`${TOBACCO_DIVISION}/${city}: Smart Supply: ${String(err)}`)
      }
    }

    let stored = 0
    let currentBuy = 0
    try {
      const mat = corp.getMaterial(TOBACCO_DIVISION, city, PLANTS)
      stored = mat.stored
      currentBuy = mat.buyAmount
    } catch {
      continue
    }

    const consumptionPerSec = getInputConsumptionPerSec(ns, TOBACCO_DIVISION, city, PLANTS, industry)
    const buyPerSec = computeInputBuyRate(stored, consumptionPerSec)
    const tier = supplyTier(stored)

    if (Math.abs(currentBuy - buyPerSec) > 0.01) {
      const err = tryBuyMaterial(ns, TOBACCO_DIVISION, city, PLANTS, buyPerSec)
      if (err) {
        lines.push(`${TOBACCO_DIVISION}/${city}/${PLANTS}: ${err}`)
      } else {
        lines.push(
          `${TOBACCO_DIVISION}/${city}/${PLANTS}: buy ${buyPerSec.toFixed(2)}/s ` +
            `(use ${consumptionPerSec.toFixed(2)}/s, tier ${tier})`
        )
      }
    }
  }

  return lines
}
