import { CityName, NS } from "@ns"
import {
  buildEmployeeProductionByJob,
  type OfficeJobCounts,
  type PerEmployeeRates,
} from "@/libraries/corporation/simulation/officeJobs.js"

/** Staff target while any product has developmentProgress < 100. */
export const PRODUCT_DEVELOPMENT_TARGET_STAFF = 12

export interface ProductDevelopmentStatus {
  name: string
  city: CityName
  progress: number
}

/** True when a division product is still being designed (not yet finished in game). */
export function divisionIsDevelopingProduct(ns: NS, divisionName: string): boolean {
  return getProductDevelopmentStatuses(ns, divisionName).length > 0
}

/** True when this city still has a product with developmentProgress < 100. */
export function cityIsDevelopingProduct(ns: NS, divisionName: string, city: CityName): boolean {
  return getProductDevelopmentStatuses(ns, divisionName).some((s) => s.city === city)
}

export function getProductDevelopmentStatuses(ns: NS, divisionName: string): ProductDevelopmentStatus[] {
  const corp = ns.corporation
  const statuses: ProductDevelopmentStatus[] = []

  if (!corp.getCorporation().divisions.includes(divisionName)) return statuses

  const division = corp.getDivision(divisionName)
  for (const productName of division.products) {
    for (const city of division.cities) {
      try {
        const product = corp.getProduct(divisionName, city, productName)
        if (product.developmentProgress < 100) {
          statuses.push({ name: productName, city, progress: product.developmentProgress })
        }
      } catch {
        // product not tracked in this city yet
      }
    }
  }

  return statuses
}

/** Mirrors Product.createProduct — Ops/Eng/Mgmt only; Business does not add dev speed. */
export function estimateDevelopmentProgressPerCycle(
  employeeProductionByJob: Record<string, number>,
  marketCycles = 1
): number {
  const opProd = employeeProductionByJob.Operations ?? 0
  const engrProd = employeeProductionByJob.Engineer ?? 0
  const mgmtProd = employeeProductionByJob.Management ?? 0
  const total = opProd + engrProd + mgmtProd
  if (total <= 0) return 0

  const mgmtFactor = 1 + mgmtProd / (1.2 * total)
  const prodMult = (Math.pow(engrProd, 0.34) + Math.pow(opProd, 0.2)) * mgmtFactor
  return marketCycles * 0.01 * prodMult
}

/** Wall-clock seconds until developmentProgress reaches 100 (linear extrapolation). */
export function estimateDevelopmentEtaSeconds(
  progressPercent: number,
  progressPerCycle: number,
  secondsPerMarketCycle: number
): number | null {
  if (progressPerCycle <= 0) return null
  const remaining = 100 - progressPercent
  if (remaining <= 0) return 0
  return (remaining / progressPerCycle) * secondsPerMarketCycle
}

/** Plain-ASCII ETA for in-game tables. */
export function formatDevelopmentEta(seconds: number | null): string {
  if (seconds == null) return "—"
  if (seconds <= 0) return "done"
  if (seconds < 60) return `~${Math.ceil(seconds)}s`
  if (seconds < 3600) return `~${Math.ceil(seconds / 60)}m`
  if (seconds < 86400) return `~${(seconds / 3600).toFixed(1)}h`
  return `~${(seconds / 86400).toFixed(1)}d`
}

/** Local wall-clock time when linear ETA elapses (browser real time). */
export function formatDevelopmentDoneAt(etaSeconds: number | null): string {
  if (etaSeconds == null || etaSeconds <= 0) return "—"
  const done = new Date(Date.now() + etaSeconds * 1000)
  const h = done.getHours()
  const m = done.getMinutes()
  return `${h}:${String(m).padStart(2, "0")}`
}

/** Matches officeJobs intern rules (1 Business, no R&D while developing). */
function internSlotsForDevelopment(numEmployees: number): number {
  if (numEmployees >= 9) return Math.floor(numEmployees / 9)
  if (numEmployees > 5) return 1
  return 0
}

/**
 * Fast dev job split: 1 Business + required interns, 1 Ops baseline, then greedy hires
 * by marginal development progress (same formula as estimateDevelopmentProgressPerCycle).
 */
export function jobCountsForProductDevelopment(
  numEmployees: number,
  rates: PerEmployeeRates
): OfficeJobCounts {
  const empty: OfficeJobCounts = {
    Operations: 0,
    Engineer: 0,
    Management: 0,
    Business: 0,
    "Research & Development": 0,
    Intern: 0,
  }
  if (numEmployees <= 0) return empty

  const intern = internSlotsForDevelopment(numEmployees)
  const business = 1
  let productionSlots = numEmployees - intern - business
  if (productionSlots < 1) {
    return {
      ...empty,
      Operations: Math.min(1, numEmployees),
      Business: Math.min(1, numEmployees),
      Intern: intern,
    }
  }

  let ops = 1
  let engr = 0
  let mgmt = 0
  productionSlots -= ops

  const toCounts = (): OfficeJobCounts => ({
    Operations: ops,
    Engineer: engr,
    Management: mgmt,
    Business: business,
    "Research & Development": 0,
    Intern: intern,
  })

  while (productionSlots > 0) {
    const base = toCounts()
    const baseProg = estimateDevelopmentProgressPerCycle(buildEmployeeProductionByJob(base, rates), 1)
    let bestJob: "Engineer" | "Management" | "Operations" | null = null
    let bestGain = 0
    for (const job of ["Engineer", "Management", "Operations"] as const) {
      const trial = { ...base, [job]: base[job] + 1 }
      const gain =
        estimateDevelopmentProgressPerCycle(buildEmployeeProductionByJob(trial, rates), 1) - baseProg
      if (gain > bestGain + 1e-12) {
        bestGain = gain
        bestJob = job
      }
    }
    if (!bestJob) break
    if (bestJob === "Engineer") engr++
    else if (bestJob === "Management") mgmt++
    else ops++
    productionSlots--
  }

  return toCounts()
}
