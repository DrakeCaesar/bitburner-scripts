import { CityName, NS } from "@ns"
import { FARMLAND_CITIES, FARMLAND_DIVISION, FARMLAND_INDUSTRY, OFFICE_FUND_BUFFER } from "@/libraries/corporation/farmland.js"

function tryCorpAction(action: () => void): string | null {
  try {
    action()
    return null
  } catch (err) {
    return String(err)
  }
}

function formatMoney(ns: NS, value: number): string {
  return `$${ns.format.number(value)}`
}

function fundsForNewOffice(ns: NS): number {
  return ns.corporation.getConstants().officeInitialCost + OFFICE_FUND_BUFFER
}

function fundsForNewWarehouse(ns: NS): number {
  return ns.corporation.getConstants().warehouseInitialCost + OFFICE_FUND_BUFFER
}

function canAffordNewBranch(ns: NS, city: CityName): boolean {
  const corp = ns.corporation
  const funds = corp.getCorporation().funds
  const division = corp.getDivision(FARMLAND_DIVISION)
  const needsOffice = !division.cities.includes(city)
  const needsWarehouse = !corp.hasWarehouse(FARMLAND_DIVISION, city)

  if (needsOffice && funds < fundsForNewOffice(ns)) return false
  if (needsWarehouse && funds < fundsForNewWarehouse(ns)) return false
  return true
}

/**
 * Create Farmland and open each configured city (office + warehouse) when affordable.
 * One action per call so the main loop can tick between purchases.
 */
export function ensureFarmlandDivision(ns: NS): string[] {
  const corp = ns.corporation
  const lines: string[] = []

  if (!corp.hasCorporation()) return lines

  const info = corp.getCorporation()

  if (!info.divisions.includes(FARMLAND_DIVISION)) {
    const industry = corp.getIndustryData(FARMLAND_INDUSTRY)
    if (info.funds < industry.startingCost) {
      lines.push(
        `Waiting for funds to create ${FARMLAND_DIVISION} (need ${formatMoney(ns, industry.startingCost)})`
      )
      return lines
    }
    const err = tryCorpAction(() => corp.expandIndustry(FARMLAND_INDUSTRY, FARMLAND_DIVISION))
    if (err) {
      lines.push(`Farmland: ${err}`)
      return lines
    }
    lines.push(`Created division ${FARMLAND_DIVISION} (${FARMLAND_INDUSTRY})`)
    return lines
  }

  const division = corp.getDivision(FARMLAND_DIVISION)

  for (const city of FARMLAND_CITIES) {
    if (!division.cities.includes(city)) {
      if (!canAffordNewBranch(ns, city)) {
        lines.push(
          `Waiting for funds to open ${FARMLAND_DIVISION}/${city} ` +
            `(need ${formatMoney(ns, fundsForNewOffice(ns))} for office)`
        )
        return lines
      }
      const err = tryCorpAction(() => corp.expandCity(FARMLAND_DIVISION, city))
      if (err) {
        lines.push(`Farmland/${city} office: ${err}`)
        return lines
      }
      lines.push(`Opened office: ${FARMLAND_DIVISION} @ ${city}`)
      return lines
    }

    if (!corp.hasWarehouse(FARMLAND_DIVISION, city)) {
      if (!canAffordNewBranch(ns, city)) {
        lines.push(
          `Waiting for funds for ${FARMLAND_DIVISION}/${city} warehouse ` +
            `(need ${formatMoney(ns, fundsForNewWarehouse(ns))})`
        )
        return lines
      }
      const err = tryCorpAction(() => corp.purchaseWarehouse(FARMLAND_DIVISION, city))
      if (err) {
        lines.push(`Farmland warehouse/${city}: ${err}`)
        return lines
      }
      lines.push(`Purchased warehouse: ${FARMLAND_DIVISION} @ ${city}`)
      return lines
    }
  }

  return lines
}
