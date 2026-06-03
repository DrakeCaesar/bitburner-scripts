import { CityName, CorpIndustryData, CorpMaterialName, NS } from "@ns"
import { FARMLAND_DIVISION } from "./display.js"
import { asCorpMaterialList } from "./simulation/officeJobs.js"
import { maintainOfficeStaff, OFFICE_FUND_BUFFER } from "./office.js"

const SELL_AMOUNT = "MAX"
const SELL_PRICE = "MP"

function isSellConfigured(amount: string | number, price: string | number): boolean {
  return String(amount) === SELL_AMOUNT && String(price) === SELL_PRICE
}

/** Sell all produced materials at market price (no Smart Supply). */
export function sellDivisionProduce(
  ns: NS,
  divisionName: string,
  city: CityName,
  industry: CorpIndustryData,
  lines: string[]
): void {
  const corp = ns.corporation
  if (!corp.hasWarehouse(divisionName, city)) return

  for (const materialName of asCorpMaterialList(industry.producedMaterials)) {
    const name = materialName as CorpMaterialName
    try {
      const mat = corp.getMaterial(divisionName, city, name)
      const already = isSellConfigured(mat.desiredSellAmount, mat.desiredSellPrice)
      corp.sellMaterial(divisionName, city, name, SELL_AMOUNT, SELL_PRICE)
      if (!already) {
        lines.push(`${divisionName}/${city}/${name}: sell ${SELL_AMOUNT} @ ${SELL_PRICE}`)
      }
    } catch {
      // material not in warehouse yet
    }
  }
}

/** Staff offices and configure produce sales for Farmland. */
export async function manageFarmlandOperations(ns: NS): Promise<string[]> {
  const corp = ns.corporation
  const lines: string[] = []

  if (!corp.hasCorporation()) return lines

  const info = corp.getCorporation()
  if (!info.divisions.includes(FARMLAND_DIVISION)) return lines

  const division = corp.getDivision(FARMLAND_DIVISION)
  const industry = corp.getIndustryData(division.industry)

  for (const city of division.cities) {
    try {
      corp.getOffice(FARMLAND_DIVISION, city)
    } catch {
      continue
    }

    await maintainOfficeStaff(ns, FARMLAND_DIVISION, city, info.funds, lines)
    sellDivisionProduce(ns, FARMLAND_DIVISION, city, industry, lines)
  }

  if (info.funds <= OFFICE_FUND_BUFFER && division.cities.length > 0) {
    const staffed = division.cities.some((city) => {
      try {
        return corp.getOffice(FARMLAND_DIVISION, city).numEmployees > 0
      } catch {
        return false
      }
    })
    if (!staffed) {
      lines.push(`Waiting for funds > ${OFFICE_FUND_BUFFER / 1e6}M before hiring`)
    }
  }

  return lines
}
