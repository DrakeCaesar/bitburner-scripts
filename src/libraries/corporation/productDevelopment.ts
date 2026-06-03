import { CityName, NS } from "@ns"
import {
  buildEmployeeProductionByJob,
  enumerateConstrainedJobCounts,
  type OfficeJobCounts,
  type PerEmployeeRates,
} from "@/libraries/corporation/simulation/officeJobs.js"

/** Staff target while any product has developmentProgress < 100. */
export const PRODUCT_DEVELOPMENT_TARGET_STAFF = 9

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

/** Brute-force job split that maximizes simulated development progress per market cycle. */
export function findFastestDevelopmentJobCounts(
  numEmployees: number,
  rates: PerEmployeeRates
): OfficeJobCounts | null {
  if (numEmployees <= 0) return null

  const candidates = enumerateConstrainedJobCounts(numEmployees, 0)
  let best: OfficeJobCounts | null = null
  let bestProgress = -1

  for (const counts of candidates) {
    const prodByJob = buildEmployeeProductionByJob(counts, rates)
    const progress = estimateDevelopmentProgressPerCycle(prodByJob, 1)
    if (progress > bestProgress) {
      bestProgress = progress
      best = counts
    }
  }

  return best
}

export function jobCountsForProductDevelopment(
  numEmployees: number,
  rates: PerEmployeeRates
): OfficeJobCounts {
  return (
    findFastestDevelopmentJobCounts(numEmployees, rates) ?? {
      Operations: Math.min(1, numEmployees),
      Engineer: 0,
      Management: 0,
      Business: Math.min(1, numEmployees),
      "Research & Development": 0,
      Intern: 0,
    }
  )
}
