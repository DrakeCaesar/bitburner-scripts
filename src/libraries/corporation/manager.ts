import {
  CityName,
  CorpEmployeePosition,
  CorpIndustryData,
  CorpIndustryName,
  CorpMaterialName,
  CorpUnlockName,
  NS,
} from "@ns"

const CORP_NAME = "Dracorp"
const START_INDUSTRY: CorpIndustryName = "Agriculture"
const START_DIVISION = "Agriculture"
const START_CITY: CityName = "Sector-12"

const CORE_JOBS: Exclude<CorpEmployeePosition, "Unassigned">[] = [
  "Operations",
  "Engineer",
  "Business",
  "Management",
  "Research & Development",
]

const SMART_SUPPLY: CorpUnlockName = "Smart Supply"
const OFFICE_FUND_BUFFER = 5e6
const ADVERT_FUND_BUFFER = 2e7

/** One tick of corp automation. Returns log lines for the tail window. */
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

function ensureCorporationCreated(ns: NS): string[] {
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
  const office = corp.getOffice(divisionName, city)

  if (office.numEmployees < office.maxEmployees && funds > OFFICE_FUND_BUFFER) {
    if (corp.hireEmployee(divisionName, city)) {
      lines.push(`${divisionName}/${city}: hired (${office.numEmployees + 1}/${office.maxEmployees})`)
    }
  }

  const upgradeCost = corp.getOfficeSizeUpgradeCost(divisionName, city, 3)
  if (office.numEmployees >= office.maxEmployees && funds > upgradeCost + OFFICE_FUND_BUFFER) {
    corp.upgradeOfficeSize(divisionName, city, 3)
    lines.push(`${divisionName}/${city}: office +3 (${office.maxEmployees} → ${office.maxEmployees + 3})`)
  }

  balanceJobs(ns, divisionName, city)

  if (office.avgMorale < 50 || office.avgEnergy < 50) {
    corp.buyTea(divisionName, city)
  }
}

function balanceJobs(ns: NS, divisionName: string, city: CityName): void {
  const corp = ns.corporation
  const office = corp.getOffice(divisionName, city)
  const n = office.numEmployees
  if (n === 0) return

  const internTarget = n >= 9 ? Math.floor(n / 9) : n > 5 ? 1 : 0
  let remaining = n - internTarget
  const targets: Record<Exclude<CorpEmployeePosition, "Unassigned">, number> = {
    Operations: 0,
    Engineer: 0,
    Business: 0,
    Management: 0,
    "Research & Development": 0,
    Intern: internTarget,
  }

  for (const job of CORE_JOBS) {
    if (remaining <= 0) break
    targets[job] = 1
    remaining--
  }
  targets.Operations += remaining

  for (const job of CORE_JOBS) {
    corp.setJobAssignment(divisionName, city, job, targets[job])
  }
  corp.setJobAssignment(divisionName, city, "Intern", targets.Intern)
}

function maintainWarehouse(
  ns: NS,
  divisionName: string,
  city: CityName,
  industry: CorpIndustryData,
  _lines: string[]
): void {
  const corp = ns.corporation
  if (!corp.hasWarehouse(divisionName, city)) return

  if (corp.hasUnlock(SMART_SUPPLY)) {
    corp.setSmartSupply(divisionName, city, true)
    for (const materialName of Object.keys(industry.requiredMaterials ?? {}) as CorpMaterialName[]) {
      corp.setSmartSupplyOption(divisionName, city, materialName, "leftovers")
    }
  }

  for (const materialName of industry.producedMaterials ?? []) {
    const name = materialName as CorpMaterialName
    try {
      corp.getMaterial(divisionName, city, name)
    } catch {
      continue
    }
    corp.sellMaterial(divisionName, city, name, "MAX", "MP")
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
