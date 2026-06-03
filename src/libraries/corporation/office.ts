import { CityName, CorpMaterialName, NS, type Office } from "@ns"
import { FARMLAND_DIVISION } from "./display.js"
import { buildSimContext } from "./simulation/context.js"
import { inferDemandFromSellRate } from "./simulation/math.js"
import { captureCorporationSnapshot } from "./simulation/snapshot.js"
import {
  asCorpMaterialList,
  buildOptimizeResultFromSimBest,
  countsMatchCurrent,
  enumerateHeadcountEconomics,
  evaluateHeadcountEconomics,
  extractPerEmployeeRates,
  findOptimalHeadcount,
  formatHeadcountEconomics,
  headcountEconomicsToTableRow,
  formatJobCounts,
  MAX_OFFICE_EMPLOYEES_FOR_OPTIMIZE,
  optimizeMaterialJobCounts,
  type FarmlandProfitContext,
  type OfficeJobCounts,
  type OfficeJobOptimizeInput,
  type OfficeSalaryInput,
} from "./simulation/officeJobs.js"

export const OFFICE_FUND_BUFFER = 5e6
/** Cap hiring / office size / job optimizer search (brute force grows with headcount). */
export const MAX_OFFICE_EMPLOYEES = MAX_OFFICE_EMPLOYEES_FOR_OPTIMIZE
/**
 * false: constrained job search, rank by 1-cycle profit formula.
 * true: every job split, rank by multi-cycle warehouse sim (see EXHAUSTIVE_OFFICE_JOB_SIM_CYCLES).
 */
export const USE_EXHAUSTIVE_OFFICE_JOB_SEARCH = false
export const EXHAUSTIVE_OFFICE_JOB_SIM_CYCLES = 5

export interface HeadcountPlanTable {
  city: CityName
  officeSize: number
  currentEmployees: number
  optimalEmployees: number
  rows: string[][]
}

/** Per-city headcount sweep for the dashboard (1..office size). */
export function buildFarmlandHeadcountPlanTables(ns: NS): HeadcountPlanTable[] {
  const corp = ns.corporation
  if (!corp.hasCorporation()) return []

  const info = corp.getCorporation()
  if (!info.divisions.includes(FARMLAND_DIVISION)) return []

  const tables: HeadcountPlanTable[] = []

  for (const city of corp.getDivision(FARMLAND_DIVISION).cities) {
    try {
      corp.getOffice(FARMLAND_DIVISION, city)
    } catch {
      continue
    }

    const profitContext = buildFarmlandProfitContext(ns, FARMLAND_DIVISION, city)
    if (!profitContext) continue

    const office = corp.getOffice(FARMLAND_DIVISION, city)
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
      city,
      officeSize: office.size,
      currentEmployees: office.numEmployees,
      optimalEmployees,
      rows: economics.map((econ) =>
        headcountEconomicsToTableRow(econ, office.numEmployees, optimalEmployees)
      ),
    })
  }

  return tables
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

      products.push({
        name,
        marketPrice: mat.marketPrice,
        quality: mat.quality,
        baseMarkup: data.baseMarkup,
        demand,
        competition,
        desiredSellAmount: mat.desiredSellAmount,
        desiredSellPrice: mat.desiredSellPrice,
      })
    } catch {
      // material missing
    }
  }

  const inputRatios: FarmlandProfitContext["inputRatios"] = []
  for (const [material, ratio] of Object.entries(industry.requiredMaterials ?? {})) {
    if (!ratio) continue
    try {
      const mat = corp.getMaterial(divisionName, city, material as CorpMaterialName)
      inputRatios.push({ material, ratio, marketPrice: mat.marketPrice })
    } catch {
      const data = corp.getMaterialData(material as CorpMaterialName)
      inputRatios.push({ material, ratio, marketPrice: data.baseCost })
    }
  }

  return {
    sim,
    secondsPerMarketCycle: spc,
    productionMult: division.productionMult,
    awareness: division.awareness,
    popularity: division.popularity,
    products,
    inputRatios,
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
    optimal = optimizeMaterialJobCounts(n, rates, { profitContext: profitContext ?? undefined })
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
  const corp = ns.corporation
  const office = corp.getOffice(divisionName, city)
  if (office.numEmployees < office.size || office.size >= MAX_OFFICE_EMPLOYEES) return

  const increase = Math.min(OFFICE_SIZE_INCREASE, MAX_OFFICE_EMPLOYEES - office.size)
  if (increase <= 0) return

  const upgradeCost = corp.getOfficeSizeUpgradeCost(divisionName, city, increase)
  if (funds <= upgradeCost + OFFICE_FUND_BUFFER) return

  const targetSize = office.size + increase

  if (profitContext && jobInput) {
    const rates = extractPerEmployeeRates(jobInput)
    const salaryBase = officeSalaryInput(office)
    const currentEcon = evaluateHeadcountEconomics(office.numEmployees, rates, profitContext, salaryBase)
    const optimal = findOptimalHeadcount(targetSize, office.numEmployees, rates, profitContext, salaryBase)

    if (!optimal || !currentEcon) return

    if (optimal.targetHeadcount <= office.size) {
      lines.push(
        `${divisionName}/${city}: skip office +${increase} (optimal ${optimal.targetHeadcount}/${office.size} staff, ` +
          `net $${(optimal.economics.netProfit / 1e3).toFixed(1)}k/cyc)`
      )
      return
    }

    if (optimal.economics.netProfit <= currentEcon.netProfit + MIN_NET_PROFIT_GAIN_PER_CYCLE) {
      lines.push(
        `${divisionName}/${city}: skip office +${increase} (net $${(currentEcon.netProfit / 1e3).toFixed(1)}k→` +
          `$${(optimal.economics.netProfit / 1e3).toFixed(1)}k at ${optimal.targetHeadcount} staff)`
      )
      return
    }

    lines.push(
      `${divisionName}/${city}: plan ${optimal.targetHeadcount} staff (size ${targetSize}) — ` +
        `${formatHeadcountEconomics(optimal.economics)}`
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

  if (
    office.numEmployees < office.size &&
    office.numEmployees < MAX_OFFICE_EMPLOYEES &&
    funds > OFFICE_FUND_BUFFER
  ) {
    let allowHire = office.numEmployees === 0
    let optimalStaff = office.size

    if (profitContext) {
      const rates = extractPerEmployeeRates(jobInput)
      const salaryBase = officeSalaryInput(office)
      const optimal = findOptimalHeadcount(office.size, office.numEmployees, rates, profitContext, salaryBase)

      if (optimal) {
        optimalStaff = optimal.targetHeadcount
        allowHire = office.numEmployees < optimalStaff
        if (!allowHire && office.numEmployees < office.size) {
          lines.push(
            `${divisionName}/${city}: staff ${office.numEmployees}/${office.size} ` +
              `(optimal ${optimalStaff}, net $${(optimal.economics.netProfit / 1e3).toFixed(1)}k/cyc) — not hiring`
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
