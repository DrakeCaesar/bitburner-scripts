import { CityName, CorpIndustryData, CorpMaterialName, NS } from "@ns"
import { FARMLAND_DIVISION } from "./display.js"

/** Inputs for Agriculture (Farmland). */
export const FARMLAND_INPUT_MATERIALS: CorpMaterialName[] = ["Water", "Chemicals"]

const STOCK_LOW = 100
const STOCK_HIGH = 150
const LOW_MULTIPLIER = 1.1
const HOLD_MULTIPLIER = 1.0

export type SupplyTier = "low" | "hold" | "pause"

export interface ManagedSupply {
  city: CityName
  material: CorpMaterialName
  stored: number
  consumptionPerSec: number
  buyPerSec: number
  tier: SupplyTier
}

export function supplyTier(stored: number): SupplyTier {
  if (stored > STOCK_HIGH) return "pause"
  if (stored < STOCK_LOW) return "low"
  return "hold"
}

/** Buy rate from stored inventory and production consumption (units/s). */
export function computeInputBuyRate(stored: number, consumptionPerSec: number): number {
  if (consumptionPerSec <= 0) return 0
  const tier = supplyTier(stored)
  if (tier === "pause") return 0
  if (tier === "low") return consumptionPerSec * LOW_MULTIPLIER
  return consumptionPerSec * HOLD_MULTIPLIER
}

function formatTier(tier: SupplyTier): string {
  if (tier === "low") return `<${STOCK_LOW} (×${LOW_MULTIPLIER})`
  if (tier === "hold") return `${STOCK_LOW}–${STOCK_HIGH} (×${HOLD_MULTIPLIER})`
  return `>${STOCK_HIGH} (off)`
}

/** Consumption per second for an input material (from Plants production rate × industry ratio). */
export function getInputConsumptionPerSec(
  ns: NS,
  divisionName: string,
  city: CityName,
  materialName: CorpMaterialName,
  industry: CorpIndustryData
): number {
  const corp = ns.corporation
  const ratio = industry.requiredMaterials?.[materialName]
  if (ratio == null || ratio <= 0) return 0

  try {
    const mat = corp.getMaterial(divisionName, city, materialName)
    if (mat.productionAmount < 0) {
      return Math.abs(mat.productionAmount)
    }
  } catch {
    // not in warehouse yet
  }

  for (const producedName of industry.producedMaterials ?? []) {
    try {
      const produced = corp.getMaterial(divisionName, city, producedName as CorpMaterialName)
      if (produced.productionAmount > 0) {
        return produced.productionAmount * ratio
      }
    } catch {
      // produced material not tracked yet
    }
  }

  return 0
}

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

/** Set Water/Chemicals buy/s from production consumption and stock tiers; disables Smart Supply. */
export function manageFarmlandSupplies(ns: NS): { lines: string[]; supplies: ManagedSupply[] } {
  const corp = ns.corporation
  const lines: string[] = []
  const supplies: ManagedSupply[] = []

  if (!corp.hasCorporation()) return { lines, supplies }

  const info = corp.getCorporation()
  if (!info.divisions.includes(FARMLAND_DIVISION)) return { lines, supplies }

  const division = corp.getDivision(FARMLAND_DIVISION)
  const industry = corp.getIndustryData(division.industry)

  for (const city of division.cities) {
    if (!corp.hasWarehouse(FARMLAND_DIVISION, city)) continue

    const warehouse = corp.getWarehouse(FARMLAND_DIVISION, city)
    if (warehouse.smartSupplyEnabled) {
      try {
        corp.setSmartSupply(FARMLAND_DIVISION, city, false)
        lines.push(`${city}: Smart Supply off (manual buy rates)`)
      } catch (err) {
        lines.push(`${city}: Smart Supply: ${String(err)}`)
      }
    }

    for (const materialName of FARMLAND_INPUT_MATERIALS) {
      if (industry.requiredMaterials?.[materialName] == null) continue

      let stored = 0
      let currentBuy = 0
      try {
        const mat = corp.getMaterial(FARMLAND_DIVISION, city, materialName)
        stored = mat.stored
        currentBuy = mat.buyAmount
      } catch {
        continue
      }

      const consumptionPerSec = getInputConsumptionPerSec(ns, FARMLAND_DIVISION, city, materialName, industry)
      const buyPerSec = computeInputBuyRate(stored, consumptionPerSec)
      const tier = supplyTier(stored)

      supplies.push({
        city,
        material: materialName,
        stored,
        consumptionPerSec,
        buyPerSec,
        tier,
      })

      if (Math.abs(currentBuy - buyPerSec) > 0.01) {
        const err = tryBuyMaterial(ns, FARMLAND_DIVISION, city, materialName, buyPerSec)
        if (err) {
          lines.push(`${city}/${materialName}: ${err}`)
        } else {
          lines.push(
            `${city}/${materialName}: buy ${buyPerSec.toFixed(2)}/s (use ${consumptionPerSec.toFixed(2)}/s, ${formatTier(tier)})`
          )
        }
      }
    }
  }

  return { lines, supplies }
}
