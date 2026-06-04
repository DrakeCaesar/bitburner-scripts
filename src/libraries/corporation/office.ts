import { CityName, CorpMaterialName, NS, type Office } from "@ns"
import { FARMLAND_DIVISION, OFFICE_FUND_BUFFER } from "@/libraries/corporation/farmland.js"
import { buildSimContext } from "@/libraries/corporation/simulation/context.js"
import { inferDemandFromSellRate } from "@/libraries/corporation/simulation/math.js"
import { captureCorporationSnapshot } from "@/libraries/corporation/simulation/snapshot.js"
import {
  asCorpMaterialList,
  buildEmployeeProductionByJob,
  buildOptimizeResultFromSimBest,
  countsMatchCurrent,
  economicsPerSecond,
  enumerateHeadcountEconomics,
  evaluateHeadcountEconomics,
  extractPerEmployeeRates,
  findOptimalHeadcount,
  formatHeadcountEconomics,
  headcountEconomicsToTableRow,
  baselineJobCountsFromOffice,
  officeJobCountsFromEmployeeJobs,
  formatJobCounts,
  MAX_OFFICE_EMPLOYEES_FOR_OPTIMIZE,
  optimizeMaterialJobCounts,
  type FarmlandProfitContext,
  type OfficeJobCounts,
  type OfficeJobOptimizeInput,
  type OfficeSalaryInput,
  type PerEmployeeRates,
} from "@/libraries/corporation/simulation/officeJobs.js"
import {
  cityIsDevelopingProduct,
  divisionIsDevelopingProduct,
  estimateDevelopmentEtaSeconds,
  estimateDevelopmentProgressPerCycle,
  formatDevelopmentEta,
  getProductDevelopmentStatuses,
  jobCountsForProductDevelopment,
  PRODUCT_DEVELOPMENT_TARGET_STAFF,
} from "@/libraries/corporation/productDevelopment.js"

/** Cap hiring / office size / job optimizer search (brute force grows with headcount). */
export const MAX_OFFICE_EMPLOYEES = MAX_OFFICE_EMPLOYEES_FOR_OPTIMIZE
/**
 * false: constrained job search, rank by 1-cycle profit formula.
 * true: every job split, rank by multi-cycle warehouse sim (see EXHAUSTIVE_OFFICE_JOB_SIM_CYCLES).
 */
export const USE_EXHAUSTIVE_OFFICE_JOB_SEARCH = false
export const EXHAUSTIVE_OFFICE_JOB_SIM_CYCLES = 5

/** When false, increase office size manually in the game (hiring still runs up to current size). */
export const AUTO_UPGRADE_OFFICE_SIZE = false

export interface HeadcountPlanTable {
  divisionName: string
  city: CityName
  officeSize: number
  currentEmployees: number
  optimalEmployees: number
  /** Game `lastCycleRevenue - lastCycleExpenses` for the division ($/s). */
  gameProfitPerSec: number
  secondsPerMarketCycle: number
  /** Product R&D plan (not profit optimizer). */
  mode?: "development"
  /** e.g. "Smoke 42%" for table title */
  devProgressLabel?: string
  rows: string[][]
}

function devHeadcountPlanRow(
  n: number,
  counts: OfficeJobCounts,
  rates: PerEmployeeRates,
  progressPercent: number,
  secondsPerMarketCycle: number,
  mark: string,
  liveProductionByJob?: Record<string, number>
): string[] {
  const prodByJob = liveProductionByJob ?? buildEmployeeProductionByJob(counts, rates)
  const progPerCycle = estimateDevelopmentProgressPerCycle(prodByJob, 1)
  const etaSec = estimateDevelopmentEtaSeconds(progressPercent, progPerCycle, secondsPerMarketCycle)
  return [
    String(n),
    String(counts.Operations),
    String(counts.Engineer),
    String(counts.Business),
    String(counts.Management),
    String(counts["Research & Development"]),
    String(counts.Intern),
    "—",
    "—",
    `~${progPerCycle.toFixed(2)}%/c`,
    formatDevelopmentEta(etaSec),
    mark,
  ]
}

/** Per-city headcount sweep for the dashboard (1..office size). */
export function buildDivisionHeadcountPlanTables(ns: NS, divisionName: string): HeadcountPlanTable[] {
  const corp = ns.corporation
  if (!corp.hasCorporation()) return []

  const info = corp.getCorporation()
  if (!info.divisions.includes(divisionName)) return []

  const tables: HeadcountPlanTable[] = []
  const division = corp.getDivision(divisionName)
  const gameProfitPerSec = division.lastCycleRevenue - division.lastCycleExpenses

  for (const city of division.cities) {
    try {
      corp.getOffice(divisionName, city)
    } catch {
      continue
    }

    const office = corp.getOffice(divisionName, city)

    if (cityIsDevelopingProduct(ns, divisionName, city)) {
      const devStatuses = getProductDevelopmentStatuses(ns, divisionName).filter((d) => d.city === city)
      const devLabel = devStatuses.map((d) => `${d.name} ${d.progress.toFixed(0)}%`).join(", ")
      const progressPercent =
        devStatuses.length > 0 ? Math.min(...devStatuses.map((d) => d.progress)) : 0
      const jobInput: OfficeJobOptimizeInput = {
        numEmployees: office.numEmployees,
        employeeJobs: { ...office.employeeJobs },
        employeeProductionByJob: { ...office.employeeProductionByJob },
      }
      const rates = extractPerEmployeeRates(jobInput)
      const currentN = office.numEmployees
      const targetN = PRODUCT_DEVELOPMENT_TARGET_STAFF
      const currentCounts = jobCountsForProductDevelopment(currentN, rates)
      const targetCounts = jobCountsForProductDevelopment(targetN, rates)
      const spc = corp.getConstants().secondsPerMarketCycle
      const rows = [
        devHeadcountPlanRow(
          currentN,
          currentCounts,
          rates,
          progressPercent,
          spc,
          "now",
          office.employeeProductionByJob
        ),
      ]
      if (currentN !== targetN) {
        rows.push(devHeadcountPlanRow(targetN, targetCounts, rates, progressPercent, spc, "goal"))
      } else if (
        !countsMatchCurrent(targetCounts, office.employeeJobs) ||
        estimateDevelopmentProgressPerCycle(office.employeeProductionByJob, 1) <
          estimateDevelopmentProgressPerCycle(buildEmployeeProductionByJob(targetCounts, rates), 1) - 1e-9
      ) {
        rows.push(devHeadcountPlanRow(targetN, targetCounts, rates, progressPercent, spc, "goal"))
      }
      tables.push({
        divisionName,
        city,
        officeSize: office.size,
        currentEmployees: office.numEmployees,
        optimalEmployees: PRODUCT_DEVELOPMENT_TARGET_STAFF,
        gameProfitPerSec,
        secondsPerMarketCycle: spc,
        mode: "development",
        devProgressLabel: devLabel,
        rows,
      })
      continue
    }

    const profitContext = buildFarmlandProfitContext(ns, divisionName, city)
    if (!profitContext) continue

    const jobInput: OfficeJobOptimizeInput = {
      numEmployees: office.numEmployees,
      employeeJobs: { ...office.employeeJobs },
      employeeProductionByJob: { ...office.employeeProductionByJob },
    }
    const rates = extractPerEmployeeRates(jobInput)
    const salaryBase = officeSalaryInput(office)

    const economics = enumerateHeadcountEconomics(
      office.size,
      office.numEmployees,
      rates,
      profitContext,
      salaryBase
    )
    const optimal = findOptimalHeadcount(office.size, office.numEmployees, rates, profitContext, salaryBase)
    if (economics.length === 0 || !optimal) continue

    const optimalEmployees = optimal.targetHeadcount

    tables.push({
      divisionName,
      city,
      officeSize: office.size,
      currentEmployees: office.numEmployees,
      optimalEmployees,
      gameProfitPerSec,
      secondsPerMarketCycle: profitContext.secondsPerMarketCycle,
      rows: economics.map((econ) =>
        headcountEconomicsToTableRow(
          econ,
          office.numEmployees,
          optimalEmployees,
          profitContext.secondsPerMarketCycle
        )
      ),
    })
  }

  return tables
}

export function buildFarmlandHeadcountPlanTables(ns: NS): HeadcountPlanTable[] {
  return buildDivisionHeadcountPlanTables(ns, FARMLAND_DIVISION)
}
/** Require projected net/cycle to improve by more than this before hire or size upgrade. */
const MIN_NET_PROFIT_GAIN_PER_CYCLE = 0
const OFFICE_SIZE_INCREASE = 3

/** getOffice() omits skill averages; use recruit midpoint (game rolls 50–100 per stat). */
const SALARY_SKILL_ASSUMPTION = 75

function officeSalaryInput(office: Office): OfficeSalaryInput {
  return {
    numEmployees: office.numEmployees,
    avgIntelligence: SALARY_SKILL_ASSUMPTION,
    avgCharisma: SALARY_SKILL_ASSUMPTION,
    avgCreativity: SALARY_SKILL_ASSUMPTION,
    avgEfficiency: SALARY_SKILL_ASSUMPTION,
    totalExperience: office.totalExperience,
  }
}

function applyJobCounts(ns: NS, divisionName: string, city: CityName, counts: OfficeJobCounts): void {
  const corp = ns.corporation
  // setJobAssignment only moves staff from Unassigned; zero every role first.
  const jobs = [
    "Operations",
    "Engineer",
    "Business",
    "Management",
    "Research & Development",
    "Intern",
  ] as const
  for (const job of jobs) {
    corp.setJobAssignment(divisionName, city, job, 0)
  }
  corp.setJobAssignment(divisionName, city, "Operations", counts.Operations)
  corp.setJobAssignment(divisionName, city, "Engineer", counts.Engineer)
  corp.setJobAssignment(divisionName, city, "Business", counts.Business)
  corp.setJobAssignment(divisionName, city, "Management", counts.Management)
  corp.setJobAssignment(divisionName, city, "Research & Development", counts["Research & Development"])
  corp.setJobAssignment(divisionName, city, "Intern", counts.Intern)
}

export function buildFarmlandProfitContext(ns: NS, divisionName: string, city: CityName): FarmlandProfitContext | null {
  const corp = ns.corporation
  if (!corp.hasWarehouse(divisionName, city)) return null

  const division = corp.getDivision(divisionName)
  const industry = corp.getIndustryData(division.industry)
  const office = corp.getOffice(divisionName, city)
  const sim = buildSimContext(ns, industry.advertisingFactor ?? 0.04)
  const spc = sim.secondsPerMarketCycle

  const officeSnap = {
    city,
    numEmployees: office.numEmployees,
    size: office.size,
    employeeProductionByJob: { ...office.employeeProductionByJob },
    totalExperience: office.totalExperience,
  }

  const divSnap = {
    name: divisionName,
    industry: division.industry,
    awareness: division.awareness,
    popularity: division.popularity,
    productionMult: division.productionMult,
    researchPoints: division.researchPoints,
    lastCycleRevenue: division.lastCycleRevenue,
    lastCycleExpenses: division.lastCycleExpenses,
    thisCycleRevenue: division.thisCycleRevenue,
    thisCycleExpenses: division.thisCycleExpenses,
    requiredMaterials: { ...(industry.requiredMaterials ?? {}) },
    producedMaterials: asCorpMaterialList(industry.producedMaterials),
    researchFactor: industry.scienceFactor ?? 0.1,
    aiCoreFactor: industry.aiCoreFactor ?? 0.05,
    advertisingFactor: industry.advertisingFactor ?? 0.04,
    cities: [...division.cities],
    offices: [],
    warehouses: [],
  }

  const products: FarmlandProfitContext["products"] = []
  let observedProductionPerSecond = 0
  for (const materialName of asCorpMaterialList(industry.producedMaterials)) {
    const name = materialName as CorpMaterialName
    try {
      const mat = corp.getMaterial(divisionName, city, name)
      const data = corp.getMaterialData(name)
      let demand = mat.demand ?? data.demandBase
      const competition = mat.competition ?? data.competitionBase
      const marketStatsKnown = mat.demand != null && mat.competition != null

      if (!marketStatsKnown && mat.actualSellAmount > 0) {
        const inferred = inferDemandFromSellRate(
          {
            name,
            stored: mat.stored,
            quality: mat.quality,
            averagePrice: mat.marketPrice,
            marketPrice: mat.marketPrice,
            buyAmount: mat.buyAmount,
            productionAmount: mat.productionAmount,
            desiredSellAmount: mat.desiredSellAmount,
            desiredSellPrice: mat.desiredSellPrice,
            marketTa1: false,
            marketTa2: false,
            marketStatsKnown: false,
            demand,
            competition,
            baseMarkup: data.baseMarkup,
            actualSellAmount: mat.actualSellAmount,
            size: data.size,
            productionLimit: mat.productionLimit,
          },
          divSnap,
          officeSnap,
          sim,
          competition,
          spc,
          1
        )
        if (inferred != null) demand = inferred
      }

      const prodRate = Math.abs(mat.productionAmount)
      if (prodRate > observedProductionPerSecond) observedProductionPerSecond = prodRate

      products.push({
        name,
        marketPrice: mat.marketPrice,
        quality: mat.quality,
        baseMarkup: data.baseMarkup,
        demand,
        competition,
        desiredSellAmount: mat.desiredSellAmount,
        desiredSellPrice: mat.desiredSellPrice,
        productionLimit: mat.productionLimit,
        actualSellAmount: mat.actualSellAmount,
      })
    } catch {
      // material missing
    }
  }

  for (const productName of division.products) {
    try {
      const product = corp.getProduct(divisionName, city, productName)
      const prodRate = Math.abs(product.productionAmount)
      if (prodRate > observedProductionPerSecond) observedProductionPerSecond = prodRate

      const demand = product.demand ?? 50
      const competition = product.competition ?? 50

      products.push({
        name: productName,
        marketPrice: product.productionCost > 0 ? product.productionCost : 1,
        quality: product.effectiveRating > 0 ? product.effectiveRating : product.rating,
        baseMarkup: 1,
        demand,
        competition,
        desiredSellAmount: product.desiredSellAmount,
        desiredSellPrice: product.desiredSellPrice,
        productionLimit: null,
        actualSellAmount: product.actualSellAmount,
      })
    } catch {
      // product not in this city yet
    }
  }

  const inputRatios: FarmlandProfitContext["inputRatios"] = []
  let observedMaterialExpensePerSecond = 0
  for (const [material, ratio] of Object.entries(industry.requiredMaterials ?? {})) {
    if (!ratio) continue
    try {
      const mat = corp.getMaterial(divisionName, city, material as CorpMaterialName)
      inputRatios.push({ material, ratio, marketPrice: mat.marketPrice })
      observedMaterialExpensePerSecond += mat.buyAmount * mat.marketPrice
    } catch {
      const data = corp.getMaterialData(material as CorpMaterialName)
      inputRatios.push({ material, ratio, marketPrice: data.baseCost })
    }
  }

  const observedDivisionRevenuePerSecond = division.lastCycleRevenue
  const observedDivisionExpensePerSecond = division.lastCycleExpenses
  const observedSalaryPerSecond = Math.max(
    0,
    observedDivisionExpensePerSecond - observedMaterialExpensePerSecond
  )

  return {
    sim,
    secondsPerMarketCycle: spc,
    productionMult: division.productionMult,
    awareness: division.awareness,
    popularity: division.popularity,
    products,
    inputRatios,
    liveEmployeeProductionByJob: { ...office.employeeProductionByJob },
    baselineJobCounts: baselineJobCountsFromOffice(
      office.numEmployees,
      office.employeeJobs,
      office.employeeProductionByJob
    ),
    observedProductionPerSecond:
      observedProductionPerSecond > 0 ? observedProductionPerSecond : undefined,
    observedDivisionRevenuePerSecond,
    observedDivisionExpensePerSecond,
    observedMaterialExpensePerSecond,
    observedSalaryPerSecond,
    baselineEmployees: office.numEmployees,
  }
}

/**
 * Assign jobs to maximize estimated cycle profit (sim production + sale formulas).
 * `setJobAssignment` only updates `employeeNextJobs`; the game applies them at the
 * beginning of the next START stage (start of a new market cycle), not on PURCHASE/PRODUCTION/SALE.
 */
export async function balanceJobs(ns: NS, divisionName: string, city: CityName): Promise<string | null> {
  const corp = ns.corporation
  const office = corp.getOffice(divisionName, city)
  if (office.numEmployees > MAX_OFFICE_EMPLOYEES) return null
  const n = office.numEmployees
  if (n === 0) return null

  const input: OfficeJobOptimizeInput = {
    numEmployees: n,
    employeeJobs: { ...office.employeeJobs },
    employeeProductionByJob: { ...office.employeeProductionByJob },
  }

  const rates = extractPerEmployeeRates(input)

  if (cityIsDevelopingProduct(ns, divisionName, city)) {
    const devCounts = jobCountsForProductDevelopment(n, rates)
    if (countsMatchCurrent(devCounts, office.employeeJobs)) return null
    applyJobCounts(ns, divisionName, city, devCounts)
    const prodByJob = buildEmployeeProductionByJob(devCounts, rates)
    const progPerCycle = estimateDevelopmentProgressPerCycle(prodByJob, 1)
    return `${formatJobCounts(devCounts, 0, undefined, undefined)} ~${progPerCycle.toFixed(2)}%/cycle`
  }
  const profitContext = buildFarmlandProfitContext(ns, divisionName, city)
  const simSnapshot = USE_EXHAUSTIVE_OFFICE_JOB_SEARCH
    ? captureCorporationSnapshot(ns, divisionName)
    : null

  let optimal = null
  if (USE_EXHAUSTIVE_OFFICE_JOB_SEARCH && simSnapshot && profitContext) {
    const { findBestJobCountsBySimCycles } = await import("./simulation/officeJobsSim.js")
    const simBest = findBestJobCountsBySimCycles(
      simSnapshot,
      profitContext.sim,
      divisionName,
      city,
      n,
      rates,
      EXHAUSTIVE_OFFICE_JOB_SIM_CYCLES
    )
    if (simBest) {
      optimal = buildOptimizeResultFromSimBest(simBest.counts, rates, profitContext, simBest.score)
    }
  } else {
    optimal = optimizeMaterialJobCounts(n, rates, {
      profitContext: profitContext ?? undefined,
      salaryOffice: officeSalaryInput(office),
    })
  }
  if (!optimal) return null

  if (countsMatchCurrent(optimal.counts, office.employeeJobs)) {
    return null
  }

  applyJobCounts(ns, divisionName, city, optimal.counts)
  return formatJobCounts(
    optimal.counts,
    optimal.estimatedCycleProfit,
    optimal.simMultiCycleScore,
    USE_EXHAUSTIVE_OFFICE_JOB_SEARCH ? EXHAUSTIVE_OFFICE_JOB_SIM_CYCLES : undefined
  )
}

function tryUpgradeOfficeSize(
  ns: NS,
  divisionName: string,
  city: CityName,
  funds: number,
  lines: string[],
  profitContext: FarmlandProfitContext | null,
  jobInput: OfficeJobOptimizeInput | null
): void {
  if (!AUTO_UPGRADE_OFFICE_SIZE) return

  const corp = ns.corporation
  const office = corp.getOffice(divisionName, city)
  if (office.numEmployees < office.size || office.size >= MAX_OFFICE_EMPLOYEES) return

  const developingProduct = cityIsDevelopingProduct(ns, divisionName, city)
  const sizeCap = developingProduct
    ? Math.min(PRODUCT_DEVELOPMENT_TARGET_STAFF, MAX_OFFICE_EMPLOYEES)
    : MAX_OFFICE_EMPLOYEES
  if (office.size >= sizeCap) return

  const increase = Math.min(OFFICE_SIZE_INCREASE, sizeCap - office.size)
  if (increase <= 0) return

  const targetSize = office.size + increase

  if (developingProduct) {
    for (let inc = increase; inc >= 1; inc--) {
      const upgradeCost = corp.getOfficeSizeUpgradeCost(divisionName, city, inc)
      if (funds < upgradeCost) {
        if (inc === increase) {
          lines.push(
            `${divisionName}/${city}: waiting for office +${inc} ` +
              `(need $${(upgradeCost / 1e6).toFixed(1)}M, have $${(funds / 1e6).toFixed(1)}M)`
          )
        }
        continue
      }
      const sizeBefore = office.size
      try {
        corp.upgradeOfficeSize(divisionName, city, inc)
        const updated = corp.getOffice(divisionName, city)
        if (updated.size > sizeBefore) {
          lines.push(
            `${divisionName}/${city}: office +${inc} for product dev ` +
              `(size ${updated.size}/${sizeCap}, staff target ${PRODUCT_DEVELOPMENT_TARGET_STAFF})`
          )
        } else {
          lines.push(
            `${divisionName}/${city}: office +${inc} not applied ` +
              `(need $${(upgradeCost / 1e6).toFixed(1)}M, have $${(funds / 1e6).toFixed(1)}M)`
          )
        }
      } catch (err) {
        lines.push(`${divisionName}/${city}: office +${inc} failed: ${String(err)}`)
      }
      return
    }
    return
  }

  const upgradeCost = corp.getOfficeSizeUpgradeCost(divisionName, city, increase)
  if (funds <= upgradeCost + OFFICE_FUND_BUFFER) return

  if (profitContext && jobInput) {
    const rates = extractPerEmployeeRates(jobInput)
    const salaryBase = officeSalaryInput(office)
    const currentEcon = evaluateHeadcountEconomics(office.numEmployees, rates, profitContext, salaryBase)
    const optimal = findOptimalHeadcount(targetSize, office.numEmployees, rates, profitContext, salaryBase)

    if (!optimal || !currentEcon) return

    const spc = profitContext.secondsPerMarketCycle
    const optNet = economicsPerSecond(optimal.economics, spc).net
    const curNet = economicsPerSecond(currentEcon, spc).net

    if (optimal.targetHeadcount <= office.size) {
      lines.push(
        `${divisionName}/${city}: skip office +${increase} (optimal ${optimal.targetHeadcount}/${office.size} staff, ` +
          `net $${(optNet / 1e3).toFixed(1)}k/s)`
      )
      return
    }

    if (
      optimal.economics.netProfit <=
      currentEcon.netProfit + MIN_NET_PROFIT_GAIN_PER_CYCLE * spc
    ) {
      lines.push(
        `${divisionName}/${city}: skip office +${increase} (net $${(curNet / 1e3).toFixed(1)}k/s→` +
          `$${(optNet / 1e3).toFixed(1)}k/s at ${optimal.targetHeadcount} staff)`
      )
      return
    }

    lines.push(
      `${divisionName}/${city}: plan ${optimal.targetHeadcount} staff (size ${targetSize}) — ` +
        `${formatHeadcountEconomics(optimal.economics, spc)}`
    )
  }

  corp.upgradeOfficeSize(divisionName, city, increase)
  const updated = corp.getOffice(divisionName, city)
  lines.push(`${divisionName}/${city}: office +${increase} (size ${updated.size}/${MAX_OFFICE_EMPLOYEES})`)
}

/** Hire (one per tick), upgrade when full, rebalance jobs via sim optimizer. */
export async function maintainOfficeStaff(
  ns: NS,
  divisionName: string,
  city: CityName,
  funds: number,
  lines: string[]
): Promise<void> {
  const corp = ns.corporation
  const office = corp.getOffice(divisionName, city)

  const jobInput: OfficeJobOptimizeInput = {
    numEmployees: office.numEmployees,
    employeeJobs: { ...office.employeeJobs },
    employeeProductionByJob: { ...office.employeeProductionByJob },
  }
  const profitContext = buildFarmlandProfitContext(ns, divisionName, city)
  const developingProduct = cityIsDevelopingProduct(ns, divisionName, city)

  if (
    office.numEmployees < office.size &&
    office.numEmployees < MAX_OFFICE_EMPLOYEES &&
    funds > OFFICE_FUND_BUFFER
  ) {
    let allowHire = office.numEmployees === 0
    let optimalStaff = office.size

    if (developingProduct) {
      optimalStaff = Math.min(office.size, PRODUCT_DEVELOPMENT_TARGET_STAFF)
      allowHire = office.numEmployees < optimalStaff
      if (!allowHire && office.numEmployees < office.size) {
        lines.push(
          `${divisionName}/${city}: dev staff ${office.numEmployees}/${office.size} ` +
            `(target ${optimalStaff} for product R&D)`
        )
      }
    } else if (profitContext) {
      const rates = extractPerEmployeeRates(jobInput)
      const salaryBase = officeSalaryInput(office)
      const optimal = findOptimalHeadcount(office.size, office.numEmployees, rates, profitContext, salaryBase)

      if (optimal) {
        optimalStaff = optimal.targetHeadcount
        allowHire = office.numEmployees < optimalStaff
        if (!allowHire && office.numEmployees < office.size) {
          const netPerSec = economicsPerSecond(
            optimal.economics,
            profitContext.secondsPerMarketCycle
          ).net
          lines.push(
            `${divisionName}/${city}: staff ${office.numEmployees}/${office.size} ` +
              `(optimal ${optimalStaff}, net $${(netPerSec / 1e3).toFixed(1)}k/s) — not hiring`
          )
        }
      } else if (!allowHire) {
        allowHire = false
      }
    } else if (!allowHire) {
      allowHire = true
    }

    if (allowHire) {
      try {
        if (corp.hireEmployee(divisionName, city)) {
          const updated = corp.getOffice(divisionName, city)
          lines.push(
            `${divisionName}/${city}: hired (${updated.numEmployees}/${Math.min(updated.size, MAX_OFFICE_EMPLOYEES)}, ` +
              `target ${optimalStaff})`
          )
        }
      } catch (err) {
        lines.push(`${divisionName}/${city}: hire failed: ${String(err)}`)
      }
    }
  }

  tryUpgradeOfficeSize(ns, divisionName, city, funds, lines, profitContext, jobInput)

  // Rebalance only when the upcoming tick is START so assignments take effect on that same nextUpdate().
  if (corp.getCorporation().nextState === "START") {
    const jobLine = await balanceJobs(ns, divisionName, city)
    if (jobLine) {
      lines.push(`${divisionName}/${city}: jobs ${jobLine}`)
    }
  }
}
