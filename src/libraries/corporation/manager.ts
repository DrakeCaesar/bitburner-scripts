import {
  CityName,
  CorpIndustryData,
  CorpIndustryName,
  CorpMaterialName,
  CorpUnlockName,
  NS,
} from "@ns"
import { maintainOfficeStaff, OFFICE_FUND_BUFFER } from "./office.js"
import { sellDivisionProduce } from "./operations.js"

import {
  CORP_NAME,
  FARMLAND_DIVISION as START_DIVISION,
  FARMLAND_INDUSTRY as START_INDUSTRY,
  FARMLAND_START_CITY as START_CITY,
} from "./constants.js"

const SMART_SUPPLY: CorpUnlockName = "Smart Supply"
const ADVERT_FUND_BUFFER = 2e7

/** Create dracorp on start when affordable and none exists yet. */
export function ensureCorporationCreated(ns: NS): string[] {
  const corp = ns.corporation
  const lines: string[] = []
  const reset = ns.getResetInfo()

  if (reset.bitNodeOptions.disableCorporation) {
    lines.push("Corporation disabled on this BitNode.")
    return lines
  }

  const selfCheck = corp.canCreateCorporation(true)
  if (selfCheck === "Success") {
    corp.createCorporation(CORP_NAME, true)
    lines.push(`Created ${CORP_NAME} (self-funded).`)
    return lines
  }

  if (reset.currentNode === 3) {
    const seedCheck = corp.canCreateCorporation(false)
    if (seedCheck === "Success") {
      corp.createCorporation(CORP_NAME, false)
      lines.push(`Created ${CORP_NAME} (government seed money).`)
      return lines
    }
    lines.push(`Cannot create corp (seed): ${seedCheck}`)
    return lines
  }

  lines.push(`Waiting to self-fund corporation: ${selfCheck}`)
  return lines
}

/** Status lines for the tail window (no automation — manual play for now). */
export function getCorporationStatus(ns: NS): string[] {
  const corp = ns.corporation
  const lines: string[] = []

  if (!corp.hasCorporation()) {
    lines.push(...ensureCorporationCreated(ns))
    return lines
  }

  const info = corp.getCorporation()
  lines.push(`${info.name} | funds ${ns.format.number(info.funds)} | val ${ns.format.number(info.valuation)}`)

  for (const divisionName of info.divisions) {
    const division = corp.getDivision(divisionName)
    lines.push(
      `${divisionName} (${division.industry}) | awareness ${division.awareness.toFixed(1)} | popularity ${division.popularity.toFixed(1)}`
    )
  }

  return lines
}

/** One tick of full corp automation. Returns log lines for the tail window. */
export function maintainCorporation(ns: NS): string[] {
  const corp = ns.corporation
  const lines: string[] = []

  if (!corp.hasCorporation()) {
    lines.push(...ensureCorporationCreated(ns))
    return lines
  }

  const info = corp.getCorporation()
  lines.push(`${info.name} | funds ${ns.format.number(info.funds)} | val ${ns.format.number(info.valuation)}`)

  tryPurchaseUnlock(ns, SMART_SUPPLY, lines)

  if (info.divisions.length === 0) {
    corp.expandIndustry(START_INDUSTRY, START_DIVISION)
    lines.push(`Created division ${START_DIVISION} (${START_INDUSTRY})`)
    return lines
  }

  for (const divisionName of info.divisions) {
    const division = corp.getDivision(divisionName)
    const industry = corp.getIndustryData(division.industry)
    lines.push(`${divisionName} (${division.industry}) | awareness ${division.awareness.toFixed(1)} | popularity ${division.popularity.toFixed(1)}`)

    for (const city of division.cities) {
      maintainOffice(ns, divisionName, city, info.funds, lines)
      maintainWarehouse(ns, divisionName, city, industry, lines)
    }

    maintainAdvertising(ns, divisionName, info.funds, lines)
  }

  return lines
}

function tryPurchaseUnlock(ns: NS, unlock: CorpUnlockName, lines: string[]): void {
  const corp = ns.corporation
  if (corp.hasUnlock(unlock)) return

  const cost = corp.getUnlockCost(unlock)
  if (corp.getCorporation().funds < cost) return

  corp.purchaseUnlock(unlock)
  lines.push(`Purchased unlock: ${unlock}`)
}

function maintainOffice(
  ns: NS,
  divisionName: string,
  city: CityName,
  funds: number,
  lines: string[]
): void {
  const corp = ns.corporation

  maintainOfficeStaff(ns, divisionName, city, funds, lines)

  const office = corp.getOffice(divisionName, city)
  const upgradeCost = corp.getOfficeSizeUpgradeCost(divisionName, city, 3)
  if (office.numEmployees >= office.size && funds > upgradeCost + OFFICE_FUND_BUFFER) {
    corp.upgradeOfficeSize(divisionName, city, 3)
    const updated = corp.getOffice(divisionName, city)
    lines.push(`${divisionName}/${city}: office +3 (size ${updated.size})`)
  }
}

function maintainWarehouse(
  ns: NS,
  divisionName: string,
  city: CityName,
  industry: CorpIndustryData,
  lines: string[]
): void {
  const corp = ns.corporation
  if (!corp.hasWarehouse(divisionName, city)) return

  if (corp.hasUnlock(SMART_SUPPLY)) {
    corp.setSmartSupply(divisionName, city, true)
    for (const materialName of Object.keys(industry.requiredMaterials ?? {}) as CorpMaterialName[]) {
      corp.setSmartSupplyOption(divisionName, city, materialName, "leftovers")
    }
  }

  sellDivisionProduce(ns, divisionName, city, industry, lines)

  for (const materialName of industry.producedMaterials ?? []) {
    const name = materialName as CorpMaterialName
    try {
      corp.getMaterial(divisionName, city, name)
    } catch {
      continue
    }
    corp.setMaterialMarketTA1(divisionName, city, name, true)
    corp.setMaterialMarketTA2(divisionName, city, name, true)
  }
}

function maintainAdvertising(ns: NS, divisionName: string, funds: number, lines: string[]): void {
  const corp = ns.corporation
  const cost = corp.getHireAdVertCost(divisionName)
  if (funds < cost + ADVERT_FUND_BUFFER) return

  corp.hireAdVert(divisionName)
  lines.push(`${divisionName}: advertising campaign`)
}
