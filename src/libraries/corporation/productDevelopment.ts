import { CityName, NS } from "@ns"
import type { OfficeJobCounts } from "@/libraries/corporation/simulation/officeJobs.js"

/** Staff target while any product has developmentProgress < 100 (profit optimizer stays near 2). */
export const PRODUCT_DEVELOPMENT_TARGET_STAFF = 8

export interface ProductDevelopmentStatus {
  name: string
  city: CityName
  progress: number
}

/** True when a division product is still being designed (not yet finished in game). */
export function divisionIsDevelopingProduct(ns: NS, divisionName: string): boolean {
  return getProductDevelopmentStatuses(ns, divisionName).length > 0
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

/**
 * Ops + Eng + Mgmt drive development progress each PRODUCTION tick (Eng weighted highest).
 * Business is required by the job search layout but does not add dev speed.
 */
export function jobCountsForProductDevelopment(numEmployees: number): OfficeJobCounts {
  const intern = numEmployees >= 9 ? Math.floor(numEmployees / 9) : numEmployees > 5 ? 1 : 0
  let slots = numEmployees - intern
  const business = Math.min(1, slots)
  slots -= business

  let engr = Math.max(slots > 0 ? 1 : 0, Math.round(slots * 0.45))
  let ops = Math.max(slots - engr > 0 ? 1 : 0, Math.round(slots * 0.4))
  let mgmt = Math.max(0, slots - engr - ops)

  if (engr + ops + mgmt + business + intern > numEmployees) {
    mgmt = Math.max(0, numEmployees - intern - business - engr - ops)
  }

  return {
    Operations: ops,
    Engineer: engr,
    Management: mgmt,
    Business: business,
    "Research & Development": 0,
    Intern: intern,
  }
}
