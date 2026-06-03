import { CityName, CorpIndustryName, NS } from "@ns"
import { OFFICE_FUND_BUFFER } from "@/libraries/corporation/farmland.js"

export interface DivisionBranchConfig {
  divisionName: string
  industry: CorpIndustryName
  cities: readonly CityName[]
  /** When false, expansion waits and logs `waitMessage`. */
  canStart?: (ns: NS) => boolean
  waitMessage?: string
}

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

function canAffordCityStep(
  ns: NS,
  divisionName: string,
  city: CityName,
  needsOffice: boolean,
  needsWarehouse: boolean
): boolean {
  const funds = ns.corporation.getCorporation().funds
  if (needsOffice && funds < fundsForNewOffice(ns)) return false
  if (needsWarehouse && funds < fundsForNewWarehouse(ns)) return false
  return true
}

/**
 * Create a division and open each configured city (office + warehouse) when affordable.
 * One action per call so the main loop can tick between purchases.
 */
export function ensureDivisionBranch(ns: NS, config: DivisionBranchConfig): string[] {
  const corp = ns.corporation
  const lines: string[] = []
  const { divisionName, industry, cities } = config

  if (!corp.hasCorporation()) return lines

  if (config.canStart && !config.canStart(ns)) {
    if (config.waitMessage) lines.push(config.waitMessage)
    return lines
  }

  const info = corp.getCorporation()

  if (!info.divisions.includes(divisionName)) {
    const industryData = corp.getIndustryData(industry)
    if (info.funds < industryData.startingCost) {
      lines.push(
        `Waiting for funds to create ${divisionName} (need ${formatMoney(ns, industryData.startingCost)})`
      )
      return lines
    }
    const err = tryCorpAction(() => corp.expandIndustry(industry, divisionName))
    if (err) {
      lines.push(`${divisionName}: ${err}`)
      return lines
    }
    lines.push(`Created division ${divisionName} (${industry})`)
    return lines
  }

  const division = corp.getDivision(divisionName)

  for (const city of cities) {
    const needsOffice = !division.cities.includes(city)
    const needsWarehouse = !corp.hasWarehouse(divisionName, city)

    if (needsOffice) {
      if (!canAffordCityStep(ns, divisionName, city, true, false)) {
        lines.push(
          `Waiting for funds to open ${divisionName}/${city} ` +
            `(need ${formatMoney(ns, fundsForNewOffice(ns))} for office)`
        )
        return lines
      }
      const err = tryCorpAction(() => corp.expandCity(divisionName, city))
      if (err) {
        lines.push(`${divisionName}/${city} office: ${err}`)
        return lines
      }
      lines.push(`Opened office: ${divisionName} @ ${city}`)
      return lines
    }

    if (needsWarehouse) {
      if (!canAffordCityStep(ns, divisionName, city, false, true)) {
        lines.push(
          `Waiting for funds for ${divisionName}/${city} warehouse ` +
            `(need ${formatMoney(ns, fundsForNewWarehouse(ns))})`
        )
        return lines
      }
      const err = tryCorpAction(() => corp.purchaseWarehouse(divisionName, city))
      if (err) {
        lines.push(`${divisionName} warehouse/${city}: ${err}`)
        return lines
      }
      lines.push(`Purchased warehouse: ${divisionName} @ ${city}`)
      return lines
    }
  }

  return lines
}
