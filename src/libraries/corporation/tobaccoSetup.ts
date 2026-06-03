import { NS } from "@ns"
import { OFFICE_FUND_BUFFER } from "@/libraries/corporation/farmland.js"
import { FARMLAND_DIVISION } from "@/libraries/corporation/farmland.js"
import { ensureDivisionBranch, type DivisionBranchConfig } from "@/libraries/corporation/divisionBranch.js"
import {
  TOBACCO_CITIES,
  TOBACCO_DESIGN_INVEST,
  TOBACCO_DIVISION,
  TOBACCO_INDUSTRY,
  TOBACCO_MARKETING_INVEST,
  TOBACCO_PRODUCT_NAME,
  TOBACCO_START_CITY,
} from "@/libraries/corporation/tobacco.js"

const TOBACCO_BRANCH: DivisionBranchConfig = {
  divisionName: TOBACCO_DIVISION,
  industry: TOBACCO_INDUSTRY,
  cities: TOBACCO_CITIES,
  canStart: (ns) => ns.corporation.hasWarehouse(FARMLAND_DIVISION, TOBACCO_START_CITY),
  waitMessage: `Waiting for ${FARMLAND_DIVISION} warehouse @ ${TOBACCO_START_CITY} before ${TOBACCO_DIVISION}`,
}

function tryCorpAction(action: () => void): string | null {
  try {
    action()
    return null
  } catch (err) {
    return String(err)
  }
}

function ensureFirstProduct(ns: NS): string[] {
  const corp = ns.corporation
  const lines: string[] = []

  if (!corp.getCorporation().divisions.includes(TOBACCO_DIVISION)) return lines

  try {
    corp.getOffice(TOBACCO_DIVISION, TOBACCO_START_CITY)
  } catch {
    return lines
  }

  if (!corp.hasWarehouse(TOBACCO_DIVISION, TOBACCO_START_CITY)) return lines

  const division = corp.getDivision(TOBACCO_DIVISION)
  if (division.products.length > 0) return lines

  const productCost = TOBACCO_DESIGN_INVEST + TOBACCO_MARKETING_INVEST
  const funds = corp.getCorporation().funds
  if (funds < productCost + OFFICE_FUND_BUFFER) {
    lines.push(
      `Waiting for funds to develop ${TOBACCO_PRODUCT_NAME} ` +
        `(need $${ns.format.number(productCost)} + buffer)`
    )
    return lines
  }

  const err = tryCorpAction(() =>
    corp.makeProduct(
      TOBACCO_DIVISION,
      TOBACCO_START_CITY,
      TOBACCO_PRODUCT_NAME,
      TOBACCO_DESIGN_INVEST,
      TOBACCO_MARKETING_INVEST
    )
  )
  if (err) {
    lines.push(`${TOBACCO_DIVISION} product: ${err}`)
    return lines
  }

  lines.push(
    `Developing ${TOBACCO_PRODUCT_NAME} @ ${TOBACCO_START_CITY} ` +
      `(design $${ns.format.number(TOBACCO_DESIGN_INVEST)}, ` +
      `marketing $${ns.format.number(TOBACCO_MARKETING_INVEST)})`
  )
  return lines
}

/** Create Tobacco and open Sector-12 (office + warehouse + first product). */
export function ensureTobaccoDivision(ns: NS): string[] {
  const branchLines = ensureDivisionBranch(ns, TOBACCO_BRANCH)
  if (branchLines.length > 0) return branchLines
  return ensureFirstProduct(ns)
}
