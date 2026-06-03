import type { DivisionSnapshot, MaterialSnapshot, OfficeSnapshot, SimContext, WarehouseSnapshot } from "../types.js"
import {
  calculateMarkupMultiplier,
  getAdvertisingFactors,
  getBusinessFactor,
  getMarketFactor,
  getMaterialMarkupLimit,
  parseSellAmount,
  parseSellPrice,
} from "../math.js"
import { recomputeWarehouseSizeUsed } from "../snapshot.js"

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

    simulateMaterialSale(mat, division, businessFactor, advertisingFactor, ctx, spc, mc)
  }

  recomputeWarehouseSizeUsed(warehouse)
}

function simulateMaterialSale(
  mat: MaterialSnapshot,
  division: DivisionSnapshot,
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

  const sCost = parseSellPrice(mat.desiredSellPrice, mat.marketPrice, mat.marketTa1, mat.marketTa2)
  if (sCost == null) {
    mat.actualSellAmount = 0
    return
  }

  const markupLimit = getMaterialMarkupLimit()
  const qualityFactor = mat.quality + 0.001
  const marketFactor = getMarketFactor(mat.demand, mat.competition)
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
