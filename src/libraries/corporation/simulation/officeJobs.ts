import type { CityName, CorpEmployeePosition, CorpIndustryData, CorpMaterialName } from "@ns"
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

/** Netscript / clone may expose producedMaterials as a non-array object. */
export function asCorpMaterialList(produced: CorpIndustryData["producedMaterials"]): CorpMaterialName[] {
  if (produced == null) return []
  if (Array.isArray(produced)) return [...produced]
  return Object.values(produced as Record<string, CorpMaterialName>)
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

/** Office fields used for salary (matches OfficeSpace.process). */
export interface OfficeSalaryInput {
  numEmployees: number
  avgIntelligence: number
  avgCharisma: number
  avgCreativity: number
  avgEfficiency: number
  totalExperience: number
}

/** Expected stats for hireRandomEmployee (game rolls 50–100). */
const EXPECTED_NEW_HIRE_STAT = 75
const EXPECTED_NEW_HIRE_EXP = 75

/** Per market cycle, paid on START (OfficeSpace.process). */
export function estimateOfficeSalaryPerCycle(
  office: OfficeSalaryInput,
  employeeSalaryMultiplier: number,
  marketCycles = 1
): number {
  const n = office.numEmployees
  if (n <= 0) return 0
  const statSum =
    office.avgIntelligence +
    office.avgCharisma +
    office.totalExperience / n +
    office.avgCreativity +
    office.avgEfficiency
  return employeeSalaryMultiplier * marketCycles * n * statSum
}

/** Blend in `hires` random recruits (same update rules as hireRandomEmployee). */
export function projectOfficeAfterHires(office: OfficeSalaryInput, hires: number): OfficeSalaryInput {
  if (hires <= 0) return { ...office }
  let o = { ...office }
  for (let h = 0; h < hires; h++) {
    const n0 = o.numEmployees
    const n1 = n0 + 1
    o = {
      numEmployees: n1,
      avgIntelligence: (o.avgIntelligence * n0 + EXPECTED_NEW_HIRE_STAT) / n1,
      avgCharisma: (o.avgCharisma * n0 + EXPECTED_NEW_HIRE_STAT) / n1,
      avgCreativity: (o.avgCreativity * n0 + EXPECTED_NEW_HIRE_STAT) / n1,
      avgEfficiency: (o.avgEfficiency * n0 + EXPECTED_NEW_HIRE_STAT) / n1,
      totalExperience: o.totalExperience + EXPECTED_NEW_HIRE_EXP,
    }
  }
  return o
}

export interface HeadcountEconomics {
  numEmployees: number
  counts: OfficeJobCounts
  grossProfit: number
  salaryPerCycle: number
  netProfit: number
}

/** Best job split at `numEmployees` with gross profit minus projected salary. */
export function evaluateHeadcountEconomics(
  numEmployees: number,
  rates: PerEmployeeRates,
  profitCtx: FarmlandProfitContext,
  salaryOffice: OfficeSalaryInput
): HeadcountEconomics | null {
  if (numEmployees <= 0) return null

  const optimal = optimizeMaterialJobCounts(numEmployees, rates, { profitContext: profitCtx })
  if (!optimal) return null

  const salaryPerCycle = estimateOfficeSalaryPerCycle(
    { ...salaryOffice, numEmployees },
    profitCtx.sim.employeeSalaryMultiplier,
    profitCtx.sim.marketCycles
  )

  return {
    numEmployees,
    counts: optimal.counts,
    grossProfit: optimal.estimatedCycleProfit,
    salaryPerCycle,
    netProfit: optimal.estimatedCycleProfit - salaryPerCycle,
  }
}

export interface OptimalHeadcountResult {
  targetHeadcount: number
  economics: HeadcountEconomics
}

/** Net profit / job split for each headcount 1..officeCapacity. */
export function enumerateHeadcountEconomics(
  officeCapacity: number,
  currentEmployees: number,
  rates: PerEmployeeRates,
  profitCtx: FarmlandProfitContext,
  salaryAtCurrent: OfficeSalaryInput
): HeadcountEconomics[] {
  const out: HeadcountEconomics[] = []
  const maxN = Math.min(Math.max(1, officeCapacity), MAX_OFFICE_EMPLOYEES_FOR_OPTIMIZE)

  for (let n = 1; n <= maxN; n++) {
    const hiresNeeded = Math.max(0, n - currentEmployees)
    const salaryOffice = projectOfficeAfterHires(salaryAtCurrent, hiresNeeded)
    const econ = evaluateHeadcountEconomics(n, rates, profitCtx, salaryOffice)
    if (econ) out.push(econ)
  }

  return out
}

/**
 * Best staff level from 1..officeCapacity (job split + salary per n).
 * Does not model layoffs — callers should not hire past `targetHeadcount`.
 */
export function findOptimalHeadcount(
  officeCapacity: number,
  currentEmployees: number,
  rates: PerEmployeeRates,
  profitCtx: FarmlandProfitContext,
  salaryAtCurrent: OfficeSalaryInput
): OptimalHeadcountResult | null {
  const all = enumerateHeadcountEconomics(
    officeCapacity,
    currentEmployees,
    rates,
    profitCtx,
    salaryAtCurrent
  )
  if (all.length === 0) return null

  let best = all[0]
  for (const econ of all) {
    if (econ.netProfit > best.netProfit) best = econ
  }
  return { targetHeadcount: best.numEmployees, economics: best }
}

function formatMoneyK(value: number): string {
  return `$${(value / 1e3).toFixed(1)}k`
}

/** One dashboard row; ★ = best net, ◀ = current headcount. */
export function headcountEconomicsToTableRow(
  econ: HeadcountEconomics,
  currentEmployees: number,
  optimalEmployees: number
): string[] {
  const c = econ.counts
  const marks: string[] = []
  if (econ.numEmployees === optimalEmployees) marks.push("★")
  if (econ.numEmployees === currentEmployees) marks.push("◀")

  return [
    String(econ.numEmployees),
    String(c.Operations),
    String(c.Engineer),
    String(c.Business),
    String(c.Management),
    String(c["Research & Development"]),
    String(c.Intern),
    formatMoneyK(econ.grossProfit),
    formatMoneyK(econ.salaryPerCycle),
    formatMoneyK(econ.netProfit),
    marks.join(""),
  ]
}

/**
 * One market cycle: sell revenue (Plants + Food, capped by sales) minus input buys.
 * Does not include salary — use evaluateHeadcountEconomics for net.
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

/** Generators are not reliably iterable in the game runtime — return a plain array. */
function listConstrainedJobCounts(numEmployees: number, intern: number, reserveRnD: number): OfficeJobCounts[] {
  const out: OfficeJobCounts[] = []
  const maxBusiness = Math.min(MAX_BUSINESS_SEARCH, Math.max(1, numEmployees - intern - reserveRnD))

  for (let business = 1; business <= maxBusiness; business++) {
    const productionSlots = numEmployees - intern - business - reserveRnD
    if (productionSlots < 1) continue

    for (let ops = 0; ops <= productionSlots; ops++) {
      for (let engr = 0; engr <= productionSlots - ops; engr++) {
        const mgmt = productionSlots - ops - engr
        out.push({
          Operations: ops,
          Engineer: engr,
          Management: mgmt,
          Business: business,
          "Research & Development": reserveRnD,
          Intern: intern,
        })
      }
    }
  }
  return out
}

function pickBestJobCounts(
  candidates: OfficeJobCounts[],
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
    listConstrainedJobCounts(numEmployees, intern, reserveRnD),
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

export function formatHeadcountEconomics(econ: HeadcountEconomics): string {
  return (
    `${formatJobCounts(econ.counts, econ.grossProfit)} ` +
    `sal=$${(econ.salaryPerCycle / 1e3).toFixed(1)}k net=$${(econ.netProfit / 1e3).toFixed(1)}k/cyc`
  )
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
