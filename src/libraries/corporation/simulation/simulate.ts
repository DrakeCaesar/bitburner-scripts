import { CityName } from "@ns"
import { cloneSnapshot } from "@/libraries/corporation/simulation/math.js"
import { simulateProductionStage } from "@/libraries/corporation/simulation/stages/production.js"
import { simulatePurchaseStage } from "@/libraries/corporation/simulation/stages/purchase.js"
import { simulateSaleStage } from "@/libraries/corporation/simulation/stages/sale.js"
import { simulateStartStage } from "@/libraries/corporation/simulation/stages/start.js"
import type { CorporationSnapshot, CorpStage, SimContext } from "@/libraries/corporation/simulation/types.js"

function getOffice(division: CorporationSnapshot["divisions"][0], city: CityName) {
  return division.offices.find((o) => o.city === city)
}

function getWarehouse(division: CorporationSnapshot["divisions"][0], city: CityName) {
  return division.warehouses.find((w) => w.city === city)
}

/** Apply one corp state transition to a cloned snapshot. */
export function simulateStage(
  snapshot: CorporationSnapshot,
  stage: CorpStage,
  ctx: SimContext
): CorporationSnapshot {
  const next = cloneSnapshot(snapshot)

  for (const division of next.divisions) {
    if (stage === "START") {
      simulateStartStage(division, ctx)
      continue
    }

    for (const city of division.cities) {
      const warehouse = getWarehouse(division, city)
      if (!warehouse) continue
      const office = getOffice(division, city)

      switch (stage) {
        case "PURCHASE":
          simulatePurchaseStage(division, warehouse, ctx)
          break
        case "PRODUCTION":
          simulateProductionStage(division, warehouse, office, ctx)
          break
        case "SALE":
          simulateSaleStage(division, warehouse, office, ctx)
          break
        case "EXPORT":
          break
        default:
          break
      }
    }
  }

  return next
}
