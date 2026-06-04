import { CityName, CorpMaterialName, CorpUnlockName, NS } from "@ns"
import { FARMLAND_DIVISION } from "@/libraries/corporation/farmland.js"
import { TOBACCO_DIVISION } from "@/libraries/corporation/tobacco.js"

const EXPORT_UNLOCK: CorpUnlockName = "Export"
const WAREHOUSE_API_UNLOCK: CorpUnlockName = "Warehouse API"
const PLANTS_EXPORT_MATERIAL: CorpMaterialName = "Plants"
/** Target fill at Tobacco warehouse (0.5 = leave half the warehouse free for other stock). */
const PLANTS_IMPORT_WAREHOUSE_FILL = 0.5

type MaterialExportRoute = { division: string; city: string; amount: string }

function plantsExports(mat: { exports?: MaterialExportRoute[] }): MaterialExportRoute[] {
  return mat.exports ?? []
}

/** Cities where both divisions have warehouses (same-city Plants routes). */
function listPlantsExportCities(ns: NS): CityName[] {
  const corp = ns.corporation
  const farmland = corp.getDivision(FARMLAND_DIVISION)
  const tobaccoCities = new Set(corp.getDivision(TOBACCO_DIVISION).cities)
  const cities: CityName[] = []

  for (const city of farmland.cities) {
    if (!tobaccoCities.has(city)) continue
    if (!corp.hasWarehouse(FARMLAND_DIVISION, city)) continue
    if (!corp.hasWarehouse(TOBACCO_DIVISION, city)) continue
    cities.push(city)
  }

  return cities
}

/**
 * Export amount expression (no min/max — game only allows + - * / and MAX/EPROD/IPROD/IINV/EINV).
 * (CAP-IINV)/cycle targets half the Tobacco warehouse; negative values export nothing.
 * Source stored and production still cap actual flow.
 */
function computePlantsExportAmount(ns: NS, city: CityName): string | null {
  const corp = ns.corporation
  if (!corp.hasWarehouse(TOBACCO_DIVISION, city)) return null

  const warehouse = corp.getWarehouse(TOBACCO_DIVISION, city)
  const plantSize = corp.getMaterialData(PLANTS_EXPORT_MATERIAL).size
  if (plantSize <= 0) return null

  const halfCapUnits = (warehouse.size * PLANTS_IMPORT_WAREHOUSE_FILL) / plantSize
  const spc = corp.getConstants().secondsPerMarketCycle
  const cap = halfCapUnits.toFixed(2)
  const cycle = spc.toFixed(4)
  return `(${cap}-IINV)/${cycle}`
}

function isPlantsExportToTobacco(
  exports: MaterialExportRoute[],
  city: CityName,
  expectedAmount: string
): boolean {
  return exports.some(
    (e) => e.division === TOBACCO_DIVISION && e.city === city && e.amount === expectedAmount
  )
}

function tryPurchaseUnlock(ns: NS, unlock: CorpUnlockName, lines: string[]): boolean {
  const corp = ns.corporation
  if (corp.hasUnlock(unlock)) return true

  const cost = corp.getUnlockCost(unlock)
  const funds = corp.getCorporation().funds
  if (funds < cost) {
    lines.push(`Plants export: need ${unlock} ($${ns.format.number(cost)}, have $${ns.format.number(funds)})`)
    return false
  }

  try {
    corp.purchaseUnlock(unlock)
    lines.push(`Purchased unlock: ${unlock}`)
    return true
  } catch (err) {
    lines.push(`Plants export: could not buy ${unlock}: ${String(err)}`)
    return false
  }
}

function ensurePlantsExportForCity(ns: NS, city: CityName, lines: string[]): void {
  const corp = ns.corporation

  let plantsMat
  try {
    plantsMat = corp.getMaterial(FARMLAND_DIVISION, city, PLANTS_EXPORT_MATERIAL)
  } catch (err) {
    lines.push(
      `Plants export: no ${PLANTS_EXPORT_MATERIAL} on ${FARMLAND_DIVISION}/${city} (${String(err)})`
    )
    return
  }

  const exportAmount = computePlantsExportAmount(ns, city)
  if (!exportAmount) {
    lines.push(`Plants export: could not compute half-warehouse cap for ${TOBACCO_DIVISION}/${city}`)
    return
  }

  const exports = plantsExports(plantsMat)
  if (isPlantsExportToTobacco(exports, city, exportAmount)) return

  const stale = exports.some((e) => e.division === TOBACCO_DIVISION && e.city === city)
  if (stale) {
    try {
      corp.cancelExportMaterial(
        FARMLAND_DIVISION,
        city,
        TOBACCO_DIVISION,
        city,
        PLANTS_EXPORT_MATERIAL
      )
      lines.push(`${FARMLAND_DIVISION}/${city} -> ${TOBACCO_DIVISION}/${city}: removed old Plants export`)
    } catch (err) {
      lines.push(`Plants export ${city}: cancel old route failed: ${String(err)}`)
    }
  }

  try {
    corp.exportMaterial(
      FARMLAND_DIVISION,
      city,
      TOBACCO_DIVISION,
      city,
      PLANTS_EXPORT_MATERIAL,
      exportAmount
    )
  } catch (err) {
    lines.push(`Plants export ${city} failed: ${String(err)}`)
    return
  }

  try {
    const after = corp.getMaterial(FARMLAND_DIVISION, city, PLANTS_EXPORT_MATERIAL)
    if (isPlantsExportToTobacco(plantsExports(after), city, exportAmount)) {
      lines.push(
        `${FARMLAND_DIVISION}/${city} -> ${TOBACCO_DIVISION}/${city}: ` +
          `export ${PLANTS_EXPORT_MATERIAL} ${exportAmount} (cap ${PLANTS_IMPORT_WAREHOUSE_FILL * 100}% WH)`
      )
    } else {
      const desc = plantsExports(after)
        .map((e) => `${e.division}/${e.city} ${e.amount}`)
        .join(", ")
      lines.push(
        `Plants export ${city}: exportMaterial ran but route missing` + (desc ? ` (${desc})` : "")
      )
    }
  } catch (err) {
    lines.push(`Plants export ${city}: could not verify route: ${String(err)}`)
  }
}

/**
 * Route Farmland Plants to Tobacco (same city) when Export is unlocked.
 * Caps imports at half the Tobacco warehouse per city (IINV = Plants stored there).
 */
export function ensurePlantsExportToTobacco(ns: NS): string[] {
  const corp = ns.corporation
  const lines: string[] = []

  if (!corp.hasCorporation()) return lines

  if (!tryPurchaseUnlock(ns, WAREHOUSE_API_UNLOCK, lines)) return lines
  if (!tryPurchaseUnlock(ns, EXPORT_UNLOCK, lines)) return lines

  const info = corp.getCorporation()
  if (!info.divisions.includes(FARMLAND_DIVISION)) {
    lines.push(`Plants export: waiting for ${FARMLAND_DIVISION} division`)
    return lines
  }
  if (!info.divisions.includes(TOBACCO_DIVISION)) {
    lines.push(`Plants export: waiting for ${TOBACCO_DIVISION} division`)
    return lines
  }

  const cities = listPlantsExportCities(ns)
  if (cities.length === 0) {
    lines.push(
      `Plants export: no city with both ${FARMLAND_DIVISION} and ${TOBACCO_DIVISION} warehouses`
    )
    return lines
  }

  for (const city of cities) {
    ensurePlantsExportForCity(ns, city, lines)
  }

  return lines
}
