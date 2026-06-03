import type { DivisionSnapshot, MaterialSnapshot, OfficeSnapshot, SimContext, WarehouseSnapshot } from "@/libraries/corporation/simulation/types.js"
import {
  calculateMarkupMultiplier,
  getAdvertisingFactors,
  getBusinessFactor,
  getMarketFactor,
  getMaterialMarkupLimit,
  inferDemandFromSellRate,
  parseSellAmount,
  parseSellPrice,
} from "@/libraries/corporation/simulation/math.js"
import { recomputeWarehouseSizeUsed } from "@/libraries/corporation/simulation/snapshot.js"

/** SALE: sell materials (MAX @ MP, no Market-TA). */
export function simulateSaleStage(
  division: DivisionSnapshot,
  warehouse: WarehouseSnapshot,
  office: OfficeSnapshot | undefined,
  ctx: SimContext
): void {
  if (!office) return

  const { secondsPerMarketCycle: spc, marketCycles: mc } = ctx
  const businessFactor = getBusinessFactor(office.employeeProductionByJob)
  const advertisingFactor = getAdvertisingFactors(
    division.awareness,
    division.popularity,
    ctx.industryAdvertisingFactor
  )[0]

  for (const mat of Object.values(warehouse.materials)) {
    if (!mat) continue
    if (!division.producedMaterials.includes(mat.name)) continue

    simulateMaterialSale(mat, division, office, businessFactor, advertisingFactor, ctx, spc, mc)
  }

  recomputeWarehouseSizeUsed(warehouse)
}

function simulateMaterialSale(
  mat: MaterialSnapshot,
  division: DivisionSnapshot,
  office: OfficeSnapshot,
  businessFactor: number,
  advertisingFactor: number,
  ctx: SimContext,
  spc: number,
  mc: number
): void {
  if (mat.desiredSellAmount === 0) {
    mat.actualSellAmount = 0
    return
  }
  if (typeof mat.desiredSellPrice === "number" && mat.desiredSellPrice < 0) {
    mat.actualSellAmount = 0
    return
  }

  const markupLimit = getMaterialMarkupLimit(mat.quality, mat.baseMarkup)
  const sCost = parseSellPrice(mat.desiredSellPrice, mat.marketPrice, mat.marketTa1, mat.marketTa2, markupLimit)
  if (sCost == null) {
    mat.actualSellAmount = 0
    return
  }

  let demand = mat.demand
  let competition = mat.competition
  if (!mat.marketStatsKnown) {
    const inferred = inferDemandFromSellRate(mat, division, office, ctx, competition, spc, mc)
    if (inferred != null) demand = inferred
  }

  const qualityFactor = mat.quality + 0.001
  const marketFactor = getMarketFactor(demand, competition)
  const markupMultiplier = calculateMarkupMultiplier(sCost, mat.marketPrice, markupLimit)

  let sellAmt = parseSellAmount(mat.desiredSellAmount, mat.stored, mat.productionAmount, spc, mc)
  const maxSellPerCycle =
    qualityFactor *
    marketFactor *
    markupMultiplier *
    businessFactor *
    ctx.corpSalesMult *
    advertisingFactor *
    ctx.divisionSalesMult

  sellAmt = Math.min(maxSellPerCycle, sellAmt)
  sellAmt = sellAmt * spc * mc
  sellAmt = Math.min(mat.stored, sellAmt)

  if (sellAmt > 0 && sCost >= 0) {
    mat.stored -= sellAmt
    mat.actualSellAmount = sellAmt / (spc * mc)
  } else {
    mat.actualSellAmount = 0
  }
}
