import { CityName, CorpMaterialName, NS } from "@ns"
import { buildSimContext } from "./simulation/context.js"
import { inferDemandFromSellRate } from "./simulation/math.js"
import { captureCorporationSnapshot } from "./simulation/snapshot.js"
import {
  buildOptimizeResultFromSimBest,
  countsMatchCurrent,
  extractPerEmployeeRates,
  formatJobCounts,
  MAX_OFFICE_EMPLOYEES_FOR_OPTIMIZE,
  optimizeMaterialJobCounts,
  type FarmlandProfitContext,
  type OfficeJobCounts,
  type OfficeJobOptimizeInput,
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
const OFFICE_SIZE_INCREASE = 3

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
    producedMaterials: [...(industry.producedMaterials ?? [])] as CorpMaterialName[],
    researchFactor: industry.scienceFactor ?? 0.1,
    aiCoreFactor: industry.aiCoreFactor ?? 0.05,
    advertisingFactor: industry.advertisingFactor ?? 0.04,
    cities: [...division.cities],
    offices: [],
    warehouses: [],
  }

  const products: FarmlandProfitContext["products"] = []
  for (const materialName of industry.producedMaterials ?? []) {
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
  lines: string[]
): void {
  const corp = ns.corporation
  const office = corp.getOffice(divisionName, city)
  if (office.numEmployees < office.size || office.size >= MAX_OFFICE_EMPLOYEES) return

  const increase = Math.min(OFFICE_SIZE_INCREASE, MAX_OFFICE_EMPLOYEES - office.size)
  if (increase <= 0) return

  const upgradeCost = corp.getOfficeSizeUpgradeCost(divisionName, city, increase)
  if (funds <= upgradeCost + OFFICE_FUND_BUFFER) return

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

  if (
    office.numEmployees < office.size &&
    office.numEmployees < MAX_OFFICE_EMPLOYEES &&
    funds > OFFICE_FUND_BUFFER
  ) {
    try {
      if (corp.hireEmployee(divisionName, city)) {
        const updated = corp.getOffice(divisionName, city)
        lines.push(
          `${divisionName}/${city}: hired (${updated.numEmployees}/${Math.min(updated.size, MAX_OFFICE_EMPLOYEES)})`
        )
      }
    } catch (err) {
      lines.push(`${divisionName}/${city}: hire failed: ${String(err)}`)
    }
  }

  tryUpgradeOfficeSize(ns, divisionName, city, funds, lines)

  // Rebalance only when the upcoming tick is START so assignments take effect on that same nextUpdate().
  if (corp.getCorporation().nextState === "START") {
    const jobLine = await balanceJobs(ns, divisionName, city)
    if (jobLine) {
      lines.push(`${divisionName}/${city}: jobs ${jobLine}`)
    }
  }
}
