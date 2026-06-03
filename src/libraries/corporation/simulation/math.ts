/** Mirrors src/utils/calculateEffectWithFactors.ts */
export function calculateEffectWithFactors(n: number, expFac: number, linearFac: number): number {
  return Math.pow(n, expFac) + n / linearFac
}

/** Mirrors src/Corporation/helpers.ts calculateMarkupMultiplier */
export function calculateMarkupMultiplier(sellingPrice: number, marketPrice: number, markupLimit: number): number {
  if (!Number.isFinite(sellingPrice)) return 1
  if (sellingPrice > marketPrice) {
    if (sellingPrice > marketPrice + markupLimit) {
      return Math.pow(markupLimit / (sellingPrice - marketPrice), 2)
    }
    return 1
  }
  if (sellingPrice <= 0) return 1e12
  return marketPrice / sellingPrice
}

/** Material production rate from office job production (Division.getOfficeProductivity). */
export function getOfficeProductivity(employeeProductionByJob: Record<string, number>, forProduct = false): number {
  const opProd = employeeProductionByJob.Operations ?? 0
  const engrProd = employeeProductionByJob.Engineer ?? 0
  const mgmtProd = employeeProductionByJob.Management ?? 0
  const total = opProd + engrProd + mgmtProd
  if (total <= 0) return 0

  const mgmtFactor = 1 + mgmtProd / (1.2 * total)
  const prod = (Math.pow(opProd, 0.4) + Math.pow(engrProd, 0.3)) * mgmtFactor
  const balancingMult = 0.05
  return forProduct ? 0.5 * balancingMult * prod : balancingMult * prod
}

export function getBusinessFactor(employeeProductionByJob: Record<string, number>): number {
  const businessProd = 1 + (employeeProductionByJob.Business ?? 0)
  return calculateEffectWithFactors(businessProd, 0.26, 10e3)
}

export function getAdvertisingFactors(
  awareness: number,
  popularity: number,
  advertisingFactor: number
): [total: number, awarenessFactor: number, popularityFactor: number, ratioFactor: number] {
  const awarenessFac = Math.pow(awareness + 1, advertisingFactor)
  const popularityFac = Math.pow(popularity + 1, advertisingFactor)
  const ratioFac = awareness === 0 ? 0.01 : Math.max((popularity + 0.001) / awareness, 0.01)
  const totalFac = Math.pow(awarenessFac * popularityFac * ratioFac, 0.85)
  return [totalFac, awarenessFac, popularityFac, ratioFac]
}

export function getMarketFactor(demand: number, competition: number): number {
  return Math.max(0.1, (demand * (100 - competition)) / 100)
}

/** Agriculture material markup cap (Material.getMarkupLimit). */
export function getMaterialMarkupLimit(): number {
  return 1
}

export function parseSellAmount(
  desiredSellAmount: string | number,
  stored: number,
  productionAmount: number,
  secondsPerMarketCycle: number,
  marketCycles: number
): number {
  const adjustedQty = stored / (secondsPerMarketCycle * marketCycles)
  let temp = String(desiredSellAmount)
  temp = temp.replace(/MAX/g, adjustedQty.toString())
  temp = temp.replace(/PROD/g, productionAmount.toString())
  temp = temp.replace(/INV/g, stored.toString())
  const sellAmt = Number(eval(temp))
  if (!Number.isFinite(sellAmt) || sellAmt < 0) return 0
  return sellAmt
}

export function parseSellPrice(desiredSellPrice: string | number, marketPrice: number, marketTa1: boolean, marketTa2: boolean): number | null {
  if (marketTa2) return null
  if (marketTa1) return marketPrice + getMaterialMarkupLimit()
  if (desiredSellPrice === "" || desiredSellPrice === 0) return null
  const temp = String(desiredSellPrice).replace(/MP/g, marketPrice.toString())
  const sCost = Number(eval(temp))
  if (!Number.isFinite(sCost)) return null
  return sCost
}

export function warehouseSizeUsed(materials: Partial<Record<string, MaterialSnapshot>>): number {
  let used = 0
  for (const mat of Object.values(materials)) {
    if (mat) used += mat.stored * mat.size
  }
  return used
}

export function cloneSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function numbersClose(a: number, b: number, relTol = 0.02, absTol = 0.5): boolean {
  if (!Number.isFinite(a) && !Number.isFinite(b)) return true
  const diff = Math.abs(a - b)
  if (diff <= absTol) return true
  const scale = Math.max(Math.abs(a), Math.abs(b), 1)
  return diff / scale <= relTol
}
