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
  /** Per-second cap from limitMaterialProduction (first produced material in game). */
  productionLimit: number | null
  /** Last cycle sell rate (/s); used to detect production-limited sales. */
  actualSellAmount?: number
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
  /** Live office totals (includes corp/industry employee mults). */
  liveEmployeeProductionByJob?: Record<string, number>
  /** Job layout when live production was sampled. */
  baselineJobCounts?: OfficeJobCounts
  /** Max |productionAmount|/s across produced materials (anchors to game UI). */
  observedProductionPerSecond?: number
  /** Division lastCycleRevenue ($/s) — game sales rate. */
  observedDivisionRevenuePerSecond?: number
  /** Division lastCycleExpenses ($/s) — salary + buys + other. */
  observedDivisionExpensePerSecond?: number
  /** Sum of input material buyAmount×price ($/s) at snapshot time. */
  observedMaterialExpensePerSecond?: number
  /** lastCycleExpenses − material buys; payroll share of $/s. */
  observedSalaryPerSecond?: number
  /** Staff count when division $/s rates were sampled. */
  baselineEmployees?: number
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

/** Input purchase $/s at `prodPerSec` (requiredMaterials × market price). */
export function estimateInputCostPerSecond(prodPerSec: number, ctx: FarmlandProfitContext): number {
  let cost = 0
  for (const input of ctx.inputRatios) {
    cost += input.ratio * prodPerSec * input.marketPrice
  }
  return cost
}

/**
 * Scale formula economics to match division last-cycle $/s at current staff,
 * then scale production and payroll with headcount / job layout.
 */
export function applyDivisionEconomicsCalibration(
  numEmployees: number,
  counts: OfficeJobCounts,
  rates: PerEmployeeRates,
  ctx: FarmlandProfitContext,
  formulaGrossProfit: number,
  formulaSalaryPerCycle: number
): { grossProfit: number; salaryPerCycle: number; netProfit: number } {
  const spc = ctx.secondsPerMarketCycle
  const baselineN = ctx.baselineEmployees ?? numEmployees
  const baselineCounts = ctx.baselineJobCounts

  if (
    !baselineCounts ||
    !ctx.observedProductionPerSecond ||
    ctx.observedDivisionRevenuePerSecond == null ||
    ctx.observedSalaryPerSecond == null
  ) {
    return {
      grossProfit: formulaGrossProfit,
      salaryPerCycle: formulaSalaryPerCycle,
      netProfit: formulaGrossProfit - formulaSalaryPerCycle,
    }
  }

  const hypoProd = estimateMaterialProductionPerSecond(counts, rates, ctx)
  const baseProd = estimateMaterialProductionPerSecond(baselineCounts, rates, ctx)
  const prodScale = baseProd > 0 ? hypoProd / baseProd : numEmployees / Math.max(1, baselineN)

  const baseInputPerSec = estimateInputCostPerSecond(ctx.observedProductionPerSecond, ctx)
  const baseGrossPerSec = ctx.observedDivisionRevenuePerSecond - baseInputPerSec
  const hypoGrossPerSec = baseGrossPerSec * prodScale
  const grossProfit = hypoGrossPerSec * spc

  const salaryPerCycle =
    ctx.observedSalaryPerSecond * spc * (numEmployees / Math.max(1, baselineN))

  return {
    grossProfit,
    salaryPerCycle,
    netProfit: grossProfit - salaryPerCycle,
  }
}

/** Best job split at `numEmployees` with gross profit minus projected salary. */
export function evaluateHeadcountEconomics(
  numEmployees: number,
  rates: PerEmployeeRates,
  profitCtx: FarmlandProfitContext,
  salaryOffice: OfficeSalaryInput
): HeadcountEconomics | null {
  if (numEmployees <= 0) return null

  const optimal = optimizeMaterialJobCounts(numEmployees, rates, {
    profitContext: profitCtx,
    salaryOffice,
  })
  if (!optimal) return null

  const formulaSalary = estimateOfficeSalaryPerCycle(
    { ...salaryOffice, numEmployees },
    profitCtx.sim.employeeSalaryMultiplier,
    profitCtx.sim.marketCycles
  )

  const calibrated = applyDivisionEconomicsCalibration(
    numEmployees,
    optimal.counts,
    rates,
    profitCtx,
    optimal.estimatedCycleProfit,
    formulaSalary
  )

  return {
    numEmployees,
    counts: optimal.counts,
    grossProfit: calibrated.grossProfit,
    salaryPerCycle: calibrated.salaryPerCycle,
    netProfit: calibrated.netProfit,
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

/** Game UI reports $/s; economics are computed per market cycle. */
export function economicsPerSecond(econ: HeadcountEconomics, secondsPerMarketCycle: number): {
  gross: number
  salary: number
  net: number
} {
  const spc = Math.max(1, secondsPerMarketCycle)
  return {
    gross: econ.grossProfit / spc,
    salary: econ.salaryPerCycle / spc,
    net: econ.netProfit / spc,
  }
}

function productionCapPerSecond(ctx: FarmlandProfitContext): number | null {
  const first = ctx.products[0]
  if (!first || first.productionLimit == null) return null
  return first.productionLimit
}

const PRODUCTION_JOBS_FOR_SCALE = [
  "Operations",
  "Engineer",
  "Management",
  "Business",
  "Research & Development",
] as const

/** Map getOffice().employeeJobs to OfficeJobCounts. */
export function officeJobCountsFromEmployeeJobs(
  employeeJobs: Record<string, number | undefined>
): OfficeJobCounts {
  return {
    Operations: employeeJobs.Operations ?? 0,
    Engineer: employeeJobs.Engineer ?? 0,
    Management: employeeJobs.Management ?? 0,
    Business: employeeJobs.Business ?? 0,
    "Research & Development": employeeJobs["Research & Development"] ?? 0,
    Intern: employeeJobs.Intern ?? 0,
  }
}

/**
 * Baseline job layout for production scaling.
 * If assignments show 0 Ops/Eng but live production still has those roles (pending START),
 * infer a sane split from employeeProductionByJob shares.
 */
export function baselineJobCountsFromOffice(
  numEmployees: number,
  employeeJobs: Record<string, number | undefined>,
  liveProd: Record<string, number>
): OfficeJobCounts {
  const jobs = officeJobCountsFromEmployeeJobs(employeeJobs)
  const prodOps = liveProd.Operations ?? 0
  const prodEng = liveProd.Engineer ?? 0
  const prodMgmt = liveProd.Management ?? 0
  const prodTotal = prodOps + prodEng + prodMgmt

  if (prodTotal <= 0 || jobs.Operations + jobs.Engineer > 0) {
    return jobs
  }

  const productionSlots =
    numEmployees - jobs.Intern - jobs.Business - jobs["Research & Development"]
  if (productionSlots < 1) {
    return jobs
  }

  let ops = Math.max(1, Math.round((prodOps / prodTotal) * productionSlots))
  let eng = Math.max(0, Math.round((prodEng / prodTotal) * productionSlots))
  if (productionSlots >= 2 && eng === 0 && prodEng > 0) {
    eng = 1
  }
  ops = Math.min(ops, productionSlots)
  eng = Math.min(eng, Math.max(0, productionSlots - ops))
  const mgmt = Math.max(0, productionSlots - ops - eng)

  return {
    ...jobs,
    Operations: ops,
    Engineer: eng,
    Management: mgmt,
  }
}

/** Scale live per-job production to a hypothetical job split (linear per role). */
export function scaleEmployeeProductionByJob(
  live: Record<string, number>,
  baseline: OfficeJobCounts,
  target: OfficeJobCounts
): Record<string, number> {
  const out: Record<string, number> = {
    Operations: 0,
    Engineer: 0,
    Management: 0,
    Business: 0,
    "Research & Development": 0,
    Intern: 0,
    Unassigned: 0,
    total: 0,
  }

  for (const job of PRODUCTION_JOBS_FOR_SCALE) {
    const baseCount = baseline[job]
    const targetCount = target[job]
    const liveProd = live[job] ?? 0
    out[job] = baseCount > 0 ? (liveProd / baseCount) * targetCount : 0
    out.total += out[job]
  }

  return out
}

function resolveEmployeeProductionByJob(
  counts: OfficeJobCounts,
  rates: PerEmployeeRates,
  ctx: FarmlandProfitContext
): Record<string, number> {
  if (!ctx.liveEmployeeProductionByJob || !ctx.baselineJobCounts) {
    return buildEmployeeProductionByJob(counts, rates)
  }

  const scaled = scaleEmployeeProductionByJob(
    ctx.liveEmployeeProductionByJob,
    ctx.baselineJobCounts,
    counts
  )
  const rebuilt = buildEmployeeProductionByJob(counts, rates)

  for (const job of PRODUCTION_JOBS_FOR_SCALE) {
    const baseCount = ctx.baselineJobCounts[job]
    const targetCount = counts[job]
    if (baseCount <= 0 && targetCount > 0) {
      scaled[job] = rebuilt[job]
    }
  }

  scaled.total =
    scaled.Operations +
    scaled.Engineer +
    scaled.Management +
    scaled.Business +
    scaled["Research & Development"]
  return scaled
}

/** Material units/s after division mults, optional limit, and live-production calibration. */
export function estimateMaterialProductionPerSecond(
  counts: OfficeJobCounts,
  rates: PerEmployeeRates,
  ctx: FarmlandProfitContext
): number {
  const employeeProductionByJob = resolveEmployeeProductionByJob(counts, rates, ctx)
  let prodPerSec =
    getOfficeProductivity(employeeProductionByJob) *
    ctx.productionMult *
    ctx.sim.corpProductionMult *
    ctx.sim.divisionResearchProductionMult

  const cap = productionCapPerSecond(ctx)
  if (cap != null) prodPerSec = Math.min(prodPerSec, cap)

  const observed = ctx.observedProductionPerSecond
  if (
    observed != null &&
    observed > 0 &&
    ctx.liveEmployeeProductionByJob &&
    ctx.baselineJobCounts
  ) {
    const baselineProdByJob = scaleEmployeeProductionByJob(
      ctx.liveEmployeeProductionByJob,
      ctx.baselineJobCounts,
      ctx.baselineJobCounts
    )
    let baselinePerSec =
      getOfficeProductivity(baselineProdByJob) *
      ctx.productionMult *
      ctx.sim.corpProductionMult *
      ctx.sim.divisionResearchProductionMult
    if (cap != null) baselinePerSec = Math.min(baselinePerSec, cap)
    if (baselinePerSec > 0) prodPerSec = observed * (prodPerSec / baselinePerSec)
  }

  return prodPerSec
}

/** One dashboard row; ★ = best net, ◀ = current headcount. Values are $/s. */
export function headcountEconomicsToTableRow(
  econ: HeadcountEconomics,
  currentEmployees: number,
  optimalEmployees: number,
  secondsPerMarketCycle: number
): string[] {
  const perSec = economicsPerSecond(econ, secondsPerMarketCycle)
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
    formatMoneyK(perSec.gross),
    formatMoneyK(perSec.salary),
    formatMoneyK(perSec.net),
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
  const employeeProductionByJob = resolveEmployeeProductionByJob(counts, rates, ctx)
  const prodPerSec = estimateMaterialProductionPerSecond(counts, rates, ctx)
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
    let soldPerCycle = Math.min(prodPerCycle, maxSell * spc)
    const prodPerSec = prodPerCycle / spc
    if (
      product.actualSellAmount != null &&
      product.actualSellAmount > 0 &&
      product.actualSellAmount >= prodPerSec * 0.95
    ) {
      soldPerCycle = prodPerCycle
    }
    const markupLimit = getMaterialMarkupLimit(product.quality, product.baseMarkup)
    const sellPrice =
      parseSellPrice(product.desiredSellPrice, product.marketPrice, false, false, markupLimit) ??
      product.marketPrice
    revenue += soldPerCycle * sellPrice
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
  const employeeProductionByJob = profitCtx
    ? resolveEmployeeProductionByJob(counts, rates, profitCtx)
    : buildEmployeeProductionByJob(counts, rates)
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

    const minOps = 1
    const minEng = productionSlots >= 2 ? 1 : 0

    for (let ops = minOps; ops <= productionSlots - minEng; ops++) {
      for (let engr = minEng; engr <= productionSlots - ops; engr++) {
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
  rankOptions: {
    numEmployees: number
    salaryOffice?: OfficeSalaryInput
  },
  combinedScoreFor: (counts: OfficeJobCounts, formulaProfit: number) => { score: number; simScore?: number }
): OfficeJobOptimizeResult | null {
  let best: OfficeJobOptimizeResult | null = null

  for (const counts of candidates) {
    const scored = scoreCounts(counts, rates, profitCtx)
    let rankProfit = scored.estimatedCycleProfit
    if (profitCtx && rankOptions.salaryOffice) {
      const formulaSalary = estimateOfficeSalaryPerCycle(
        { ...rankOptions.salaryOffice, numEmployees: rankOptions.numEmployees },
        profitCtx.sim.employeeSalaryMultiplier,
        profitCtx.sim.marketCycles
      )
      rankProfit = applyDivisionEconomicsCalibration(
        rankOptions.numEmployees,
        counts,
        rates,
        profitCtx,
        scored.estimatedCycleProfit,
        formulaSalary
      ).netProfit
    }
    const ranked = combinedScoreFor(counts, rankProfit)
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
    salaryOffice?: OfficeSalaryInput
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
    { numEmployees, salaryOffice: options?.salaryOffice },
    (_counts, rankScore) => ({ score: rankScore })
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

export function formatHeadcountEconomics(econ: HeadcountEconomics, secondsPerMarketCycle: number): string {
  const perSec = economicsPerSecond(econ, secondsPerMarketCycle)
  return (
    `${formatJobCounts(econ.counts, econ.grossProfit)} ` +
    `sal=$${(perSec.salary / 1e3).toFixed(1)}k/s net=$${(perSec.net / 1e3).toFixed(1)}k/s`
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
