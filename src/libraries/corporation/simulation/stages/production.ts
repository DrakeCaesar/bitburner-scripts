import { CorpMaterialName } from "@ns"
import type { DivisionSnapshot, MaterialSnapshot, OfficeSnapshot, SimContext, WarehouseSnapshot } from "../types.js"
import { getOfficeProductivity } from "../math.js"
import { recomputeWarehouseSizeUsed } from "../snapshot.js"

/** PRODUCTION: consume inputs and produce Plants (material industries). */
export function simulateProductionStage(
  division: DivisionSnapshot,
  warehouse: WarehouseSnapshot,
  office: OfficeSnapshot | undefined,
  ctx: SimContext
): void {
  if (!office || division.producedMaterials.length === 0) return

  const { secondsPerMarketCycle: spc, marketCycles: mc } = ctx
  const producedName = division.producedMaterials[0]
  const produced = warehouse.materials[producedName]
  if (!produced) return

  const productivity =
    getOfficeProductivity(office.employeeProductionByJob) *
    division.productionMult *
    ctx.corpProductionMult *
    ctx.divisionResearchProductionMult

  let prod =
    produced.productionLimit == null ? productivity : Math.min(productivity, produced.productionLimit)
  prod *= spc * mc

  let totalMatSize = 0
  for (const name of division.producedMaterials) {
    const m = warehouse.materials[name]
    if (m) totalMatSize += m.size
  }
  for (const [reqName, reqQty] of Object.entries(division.requiredMaterials)) {
    const m = warehouse.materials[reqName as CorpMaterialName]
    if (m && reqQty) totalMatSize -= m.size * reqQty
  }
  if (totalMatSize > 0) {
    const maxAmt = Math.floor((warehouse.size - warehouse.sizeUsed) / totalMatSize)
    prod = Math.min(maxAmt, prod)
  }
  if (prod < 0) prod = 0

  let producableFrac = 1
  for (const [reqName, reqQty] of Object.entries(division.requiredMaterials)) {
    if (!reqQty) continue
    const reqMat = warehouse.materials[reqName as CorpMaterialName]
    if (!reqMat) {
      producableFrac = 0
      break
    }
    const req = reqQty * prod
    if (reqMat.stored < req) {
      producableFrac = Math.min(producableFrac, reqMat.stored / req)
    }
  }
  if (producableFrac <= 0) {
    producableFrac = 0
    prod = 0
  }

  if (producableFrac > 0 && prod > 0) {
    const reqEntries = Object.entries(division.requiredMaterials).filter(([, q]) => q && q > 0)
    let avgQlt = 0
    const divider = reqEntries.length || 1

    for (const [reqName, reqQty] of reqEntries) {
      const reqMat = warehouse.materials[reqName as CorpMaterialName] as MaterialSnapshot
      const needed = reqQty! * prod * producableFrac
      reqMat.stored = Math.max(0, reqMat.stored - needed)
      reqMat.productionAmount = -(needed / (spc * mc))
      avgQlt += reqMat.quality / divider
    }
    avgQlt = Math.max(avgQlt, 1)

    const engr = office.employeeProductionByJob.Engineer ?? 0
    const ai = warehouse.materials["AI Cores"]?.stored ?? 0
    let tempQlt =
      engr / 90 +
      Math.pow(division.researchPoints, division.researchFactor) +
      Math.pow(Math.max(0, ai), division.aiCoreFactor) / 10e3
    const logQlt = Math.max(Math.pow(tempQlt, 0.5), 1)
    tempQlt = Math.min(tempQlt, avgQlt * logQlt)

    for (const name of division.producedMaterials) {
      const out = warehouse.materials[name]
      if (!out) continue
      const made = prod * producableFrac
      out.quality = Math.max(1, (out.quality * out.stored + tempQlt * made) / (out.stored + made))
      out.averagePrice = (out.averagePrice * out.stored + out.marketPrice * made) / (out.stored + made)
      out.stored += made
      out.productionAmount = made / (spc * mc)
    }
  } else {
    for (const reqName of Object.keys(division.requiredMaterials)) {
      const reqMat = warehouse.materials[reqName as CorpMaterialName]
      if (reqMat) reqMat.productionAmount = 0
    }
  }

  recomputeWarehouseSizeUsed(warehouse)
}
