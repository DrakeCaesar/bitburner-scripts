import { CorpMaterialName, CorpUnlockName, NS } from "@ns"
import { FARMLAND_DIVISION } from "@/libraries/corporation/farmland.js"
import { TOBACCO_DIVISION, TOBACCO_START_CITY } from "@/libraries/corporation/tobacco.js"

const EXPORT_UNLOCK: CorpUnlockName = "Export"
const PLANTS_EXPORT_MATERIAL: CorpMaterialName = "Plants"
/** Match Tobacco import need to Farmland Plants production rate. */
const PLANTS_EXPORT_AMOUNT = "IPROD"

let plantsExportRouteConfigured = false

/**
 * Route Farmland Plants to Tobacco when Export is unlocked.
 * No-op without the unlock or before both warehouses exist in the start city.
 */
export function ensurePlantsExportToTobacco(ns: NS): string[] {
  if (plantsExportRouteConfigured) return []
  const corp = ns.corporation
  const lines: string[] = []

  if (!corp.hasCorporation() || !corp.hasUnlock(EXPORT_UNLOCK)) return lines

  const info = corp.getCorporation()
  if (!info.divisions.includes(FARMLAND_DIVISION) || !info.divisions.includes(TOBACCO_DIVISION)) {
    return lines
  }

  if (
    !corp.hasWarehouse(FARMLAND_DIVISION, TOBACCO_START_CITY) ||
    !corp.hasWarehouse(TOBACCO_DIVISION, TOBACCO_START_CITY)
  ) {
    return lines
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
    plantsExportRouteConfigured = true
    lines.push(
      `${FARMLAND_DIVISION} -> ${TOBACCO_DIVISION}/${TOBACCO_START_CITY}: ` +
        `export ${PLANTS_EXPORT_MATERIAL} ${PLANTS_EXPORT_AMOUNT}`
    )
  } catch (err) {
    const msg = String(err)
    if (msg.includes("already")) {
      plantsExportRouteConfigured = true
    } else {
      lines.push(`Plants export: ${msg}`)
    }
  }

  return lines
}
