import { CorpMaterialName, CorpUnlockName, NS } from "@ns"
import { FARMLAND_DIVISION } from "@/libraries/corporation/farmland.js"
import { TOBACCO_DIVISION, TOBACCO_START_CITY } from "@/libraries/corporation/tobacco.js"

const EXPORT_UNLOCK: CorpUnlockName = "Export"
const WAREHOUSE_API_UNLOCK: CorpUnlockName = "Warehouse API"
const PLANTS_EXPORT_MATERIAL: CorpMaterialName = "Plants"
/**
 * Farmland Plants production rate (units/s). Use EPROD not IPROD: IPROD tracks the
 * importer's productionAmount, which stays 0 while Smoke is still in development.
 */
const PLANTS_EXPORT_AMOUNT = "EPROD"

type MaterialExportRoute = { division: string; city: string; amount: string }

function plantsExports(mat: { exports?: MaterialExportRoute[] }): MaterialExportRoute[] {
  return mat.exports ?? []
}

function isPlantsExportToTobacco(exports: MaterialExportRoute[]): boolean {
  return exports.some(
    (e) =>
      e.division === TOBACCO_DIVISION &&
      e.city === TOBACCO_START_CITY &&
      e.amount === PLANTS_EXPORT_AMOUNT
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

/**
 * Route Farmland Plants to Tobacco when Export is unlocked.
 * Re-applies the route if an older IPROD export was configured (0 flow during product dev).
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

  const farmlandWh = corp.hasWarehouse(FARMLAND_DIVISION, TOBACCO_START_CITY)
  const tobaccoWh = corp.hasWarehouse(TOBACCO_DIVISION, TOBACCO_START_CITY)
  if (!farmlandWh || !tobaccoWh) {
    lines.push(
      `Plants export: need warehouses in ${TOBACCO_START_CITY} ` +
        `(Farmland ${farmlandWh ? "ok" : "missing"}, Tobacco ${tobaccoWh ? "ok" : "missing"})`
    )
    return lines
  }

  let plantsMat
  try {
    plantsMat = corp.getMaterial(FARMLAND_DIVISION, TOBACCO_START_CITY, PLANTS_EXPORT_MATERIAL)
  } catch (err) {
    lines.push(
      `Plants export: no ${PLANTS_EXPORT_MATERIAL} on ${FARMLAND_DIVISION}/${TOBACCO_START_CITY} ` +
        `(${String(err)})`
    )
    return lines
  }

  const exports = plantsExports(plantsMat)
  if (isPlantsExportToTobacco(exports)) return lines

  const stale = exports.some((e) => e.division === TOBACCO_DIVISION && e.city === TOBACCO_START_CITY)
  if (stale) {
    try {
      corp.cancelExportMaterial(
        FARMLAND_DIVISION,
        TOBACCO_START_CITY,
        TOBACCO_DIVISION,
        TOBACCO_START_CITY,
        PLANTS_EXPORT_MATERIAL
      )
      lines.push(
        `${FARMLAND_DIVISION} -> ${TOBACCO_DIVISION}: removed old Plants export (was not ${PLANTS_EXPORT_AMOUNT})`
      )
    } catch (err) {
      lines.push(`Plants export: cancel old route failed: ${String(err)}`)
    }
  }

  try {
    corp.exportMaterial(
      FARMLAND_DIVISION,
      TOBACCO_START_CITY,
      TOBACCO_DIVISION,
      TOBACCO_START_CITY,
      PLANTS_EXPORT_MATERIAL,
      PLANTS_EXPORT_AMOUNT
    )
  } catch (err) {
    lines.push(`Plants export failed: ${String(err)}`)
    return lines
  }

  try {
    const after = corp.getMaterial(FARMLAND_DIVISION, TOBACCO_START_CITY, PLANTS_EXPORT_MATERIAL)
    if (isPlantsExportToTobacco(plantsExports(after))) {
      lines.push(
        `${FARMLAND_DIVISION} -> ${TOBACCO_DIVISION}/${TOBACCO_START_CITY}: ` +
          `export ${PLANTS_EXPORT_MATERIAL} ${PLANTS_EXPORT_AMOUNT}`
      )
    } else {
      const desc = plantsExports(after)
        .map((e) => `${e.division}/${e.city} ${e.amount}`)
        .join(", ")
      lines.push(
        `Plants export: exportMaterial ran but route missing on ${FARMLAND_DIVISION} Plants` +
          (desc ? ` (${desc})` : " (no exports)")
      )
    }
  } catch (err) {
    lines.push(`Plants export: could not verify route: ${String(err)}`)
  }

  return lines
}
