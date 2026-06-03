import type { CityName, CorpEmployeePosition } from "@ns"
import {
  calculateMarkupMultiplier,
  getAdvertisingFactors,
  getBusinessFactor,
  getMarketFactor,
  getMaterialMarkupLimit,
  getOfficeProductivity,
  parseSellPrice,
} from "./math.js"
import type { SimContext } from "./types.js"

/** Inlined here — importing `estimateMaterialMaxSellPerSecond` from math.js breaks viteburner module init. */
function maxMaterialSellPerSecond(
  quality: number,
  baseMarkup: number,
  marketPrice: number,
  demand: number,
  competition: number,
  desiredSellPrice: string | number,
  employeeProductionByJob: Record<string, number>,
  awareness: number,
  popularity: number,
  ctx: SimContext
): number {
  const markupLimit = getMaterialMarkupLimit(quality, baseMarkup)
  const sCost = parseSellPrice(desiredSellPrice, marketPrice, false, false, markupLimit)
  if (sCost == null) return 0

  const businessFactor = getBusinessFactor(employeeProductionByJob)
  const advertisingFactor = getAdvertisingFactors(awareness, popularity, ctx.industryAdvertisingFactor)[0]
  return (
    (quality + 0.001) *
    getMarketFactor(demand, competition) *
    calculateMarkupMultiplier(sCost, marketPrice, markupLimit) *
    businessFactor *
    ctx.corpSalesMult *
    advertisingFactor *
    ctx.divisionSalesMult
  )
}

const PRODUCTION_JOBS = ["Operations", "Engineer", "Management"] as const

export type ProductionJob = (typeof PRODUCTION_JOBS)[number]

export interface OfficeJobCounts {
  Operations: number
  Engineer: number
  Management: number
  Business: number
  "Research & Development": number
  Intern: number
}

/** Per-employee productivity (matches OfficeSpace: jobs × prodMult × morale × energy × 1e-4). */
export interface PerEmployeeRates {
  Operations: number
  Engineer: number
  Management: number
  Business: number
  "Research & Development": number
}

export interface OfficeJobOptimizeInput {
  numEmployees: number
  employeeJobs: Record<string, number>
  employeeProductionByJob: Record<string, number>
}

export interface FarmlandProductProfitInput {
  name: string
  marketPrice: number
  quality: number
  baseMarkup: number
  demand: number
  competition: number
  desiredSellAmount: string | number
  desiredSellPrice: string | number
}

/** Live warehouse + division data for one-cycle profit estimate. */
export interface FarmlandProfitContext {
  sim: SimContext
  secondsPerMarketCycle: number
  productionMult: number
  awareness: number
  popularity: number
  products: FarmlandProductProfitInput[]
  /** Industry requiredMaterials ratios (e.g. Water 0.5, Chemicals 0.2). */
  inputRatios: Array<{ material: string; ratio: number; marketPrice: number }>
}

export interface OfficeJobOptimizeResult {
  counts: OfficeJobCounts
  productionScore: number
  businessFactor: number
  /** Estimated profit for one market cycle (revenue − input purchases). */
  estimatedCycleProfit: number
  combinedScore: number
  /** Present when `exhaustiveSearch` ranked candidates via multi-cycle warehouse sim. */
  simMultiCycleScore?: number
}

function internCount(numEmployees: number): number {
  if (numEmployees >= 9) return Math.floor(numEmployees / 9)
  if (numEmployees > 5) return 1
  return 0
}

function rateForJob(input: OfficeJobOptimizeInput, job: string): number {
  const count = input.employeeJobs[job] ?? 0
  const prod = input.employeeProductionByJob[job] ?? 0
  if (count > 0) return prod / count

  let sum = 0
  let heads = 0
  const jobs = ["Operations", "Engineer", "Management", "Business", "Research & Development"]
  for (const name of jobs) {
    const c = input.employeeJobs[name] ?? 0
    const p = input.employeeProductionByJob[name] ?? 0
    if (c > 0) {
      sum += p / c
      heads++
    }
  }
  return heads > 0 ? sum / heads : 0
}

export function extractPerEmployeeRates(input: OfficeJobOptimizeInput): PerEmployeeRates {
  return {
    Operations: rateForJob(input, "Operations"),
    Engineer: rateForJob(input, "Engineer"),
    Management: rateForJob(input, "Management"),
    Business: rateForJob(input, "Business"),
    "Research & Development": rateForJob(input, "Research & Development"),
  }
}

export function buildEmployeeProductionByJob(
  counts: OfficeJobCounts,
  rates: PerEmployeeRates
): Record<string, number> {
  return {
    Operations: counts.Operations * rates.Operations,
    Engineer: counts.Engineer * rates.Engineer,
    Management: counts.Management * rates.Management,
    Business: counts.Business * rates.Business,
    "Research & Development": counts["Research & Development"] * rates["Research & Development"],
    Intern: 0,
    Unassigned: 0,
    total: 0,
  }
}

/**
 * One market cycle: sell revenue (Plants + Food, capped by sales) minus input buys.
 * Salary is unchanged for fixed headcount, so it is omitted from the comparison.
 */
export function estimateFarmlandCycleProfit(
  counts: OfficeJobCounts,
  rates: PerEmployeeRates,
  ctx: FarmlandProfitContext
): number {
  const employeeProductionByJob = buildEmployeeProductionByJob(counts, rates)
  const prodPerSec =
    getOfficeProductivity(employeeProductionByJob) *
    ctx.productionMult *
    ctx.sim.corpProductionMult *
    ctx.sim.divisionResearchProductionMult

  const spc = ctx.secondsPerMarketCycle
  const prodPerCycle = prodPerSec * spc

  let revenue = 0
  for (const product of ctx.products) {
    const maxSell = maxMaterialSellPerSecond(
      product.quality,
      product.baseMarkup,
      product.marketPrice,
      product.demand,
      product.competition,
      product.desiredSellPrice,
      employeeProductionByJob,
      ctx.awareness,
      ctx.popularity,
      ctx.sim
    )
    const soldPerCycle = Math.min(prodPerCycle, maxSell * spc)
    revenue += soldPerCycle * product.marketPrice
  }

  let inputCost = 0
  for (const input of ctx.inputRatios) {
    inputCost += input.ratio * prodPerCycle * input.marketPrice
  }

  return revenue - inputCost
}

function scoreCounts(
  counts: OfficeJobCounts,
  rates: PerEmployeeRates,
  profitCtx: FarmlandProfitContext | undefined
): Omit<OfficeJobOptimizeResult, "counts"> {
  const employeeProductionByJob = buildEmployeeProductionByJob(counts, rates)
  const productionScore = getOfficeProductivity(employeeProductionByJob)
  const businessFactor = getBusinessFactor(employeeProductionByJob)

  const estimatedCycleProfit = profitCtx
    ? estimateFarmlandCycleProfit(counts, rates, profitCtx)
    : productionScore

  return {
    productionScore,
    businessFactor,
    estimatedCycleProfit,
    combinedScore: estimatedCycleProfit,
  }
}

/** Keep in sync with office.ts MAX_OFFICE_EMPLOYEES. */
export const MAX_OFFICE_EMPLOYEES_FOR_OPTIMIZE = 24

const MAX_BUSINESS_SEARCH = 8
function* enumerateConstrainedJobCounts(
  numEmployees: number,
  intern: number,
  reserveRnD: number
): Generator<OfficeJobCounts> {
  const maxBusiness = Math.min(MAX_BUSINESS_SEARCH, Math.max(1, numEmployees - intern - reserveRnD))

  for (let business = 1; business <= maxBusiness; business++) {
    const productionSlots = numEmployees - intern - business - reserveRnD
    if (productionSlots < 1) continue

    for (let ops = 0; ops <= productionSlots; ops++) {
      for (let engr = 0; engr <= productionSlots - ops; engr++) {
        const mgmt = productionSlots - ops - engr
        yield {
          Operations: ops,
          Engineer: engr,
          Management: mgmt,
          Business: business,
          "Research & Development": reserveRnD,
          Intern: intern,
        }
      }
    }
  }
}

function pickBestJobCounts(
  candidates: Iterable<OfficeJobCounts>,
  rates: PerEmployeeRates,
  profitCtx: FarmlandProfitContext | undefined,
  combinedScoreFor: (counts: OfficeJobCounts, formulaProfit: number) => { score: number; simScore?: number }
): OfficeJobOptimizeResult | null {
  let best: OfficeJobOptimizeResult | null = null

  for (const counts of candidates) {
    const scored = scoreCounts(counts, rates, profitCtx)
    const ranked = combinedScoreFor(counts, scored.estimatedCycleProfit)
    const candidate: OfficeJobOptimizeResult = {
      counts,
      ...scored,
      combinedScore: ranked.score,
      simMultiCycleScore: ranked.simScore,
    }
    if (!best || candidate.combinedScore > best.combinedScore) {
      best = candidate
    }
  }

  return best
}

/** Constrained search ranked by 1-cycle profit formula (`estimateFarmlandCycleProfit`). */
export function optimizeMaterialJobCounts(
  numEmployees: number,
  rates: PerEmployeeRates,
  options?: {
    profitContext?: FarmlandProfitContext
    maxEmployees?: number
    reserveRnD?: number
  }
): OfficeJobOptimizeResult | null {
  const maxEmployees = options?.maxEmployees ?? MAX_OFFICE_EMPLOYEES_FOR_OPTIMIZE
  numEmployees = Math.min(numEmployees, maxEmployees)
  if (numEmployees <= 0) return null

  const profitCtx = options?.profitContext
  const intern = internCount(numEmployees)
  const reserveRnD = options?.reserveRnD ?? 0

  return pickBestJobCounts(
    enumerateConstrainedJobCounts(numEmployees, intern, reserveRnD),
    rates,
    profitCtx,
    (_counts, formulaProfit) => ({ score: formulaProfit })
  )
}

/** Wrap exhaustive sim winner with formula metrics for logging. */
export function buildOptimizeResultFromSimBest(
  counts: OfficeJobCounts,
  rates: PerEmployeeRates,
  profitCtx: FarmlandProfitContext | undefined,
  simScore: number
): OfficeJobOptimizeResult {
  const scored = scoreCounts(counts, rates, profitCtx)
  return {
    counts,
    ...scored,
    combinedScore: simScore,
    simMultiCycleScore: simScore,
  }
}

export function formatJobCounts(
  counts: OfficeJobCounts,
  estimatedCycleProfit?: number,
  simMultiCycleScore?: number,
  simCycles?: number
): string {
  const parts: string[] = []
  const order: CorpEmployeePosition[] = [
    "Operations",
    "Engineer",
    "Business",
    "Management",
    "Research & Development",
    "Intern",
  ]
  for (const job of order) {
    const n = counts[job as keyof OfficeJobCounts]
    if (n > 0) parts.push(`${job.slice(0, 3)}:${n}`)
  }
  if (estimatedCycleProfit != null && Number.isFinite(estimatedCycleProfit)) {
    parts.push(`~$${(estimatedCycleProfit / 1e3).toFixed(1)}k/cyc`)
  }
  if (simMultiCycleScore != null && Number.isFinite(simMultiCycleScore)) {
    const label = simCycles != null ? `sim${simCycles}` : "sim"
    parts.push(`${label}=$${(simMultiCycleScore / 1e3).toFixed(1)}k`)
  }
  return parts.join(" ")
}

export function countsMatchCurrent(counts: OfficeJobCounts, employeeJobs: { [key: string]: number | undefined }): boolean {
  return (
    (employeeJobs.Operations ?? 0) === counts.Operations &&
    (employeeJobs.Engineer ?? 0) === counts.Engineer &&
    (employeeJobs.Management ?? 0) === counts.Management &&
    (employeeJobs.Business ?? 0) === counts.Business &&
    (employeeJobs["Research & Development"] ?? 0) === counts["Research & Development"] &&
    (employeeJobs.Intern ?? 0) === counts.Intern
  )
}
