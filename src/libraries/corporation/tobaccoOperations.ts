import { CityName, NS } from "@ns"
import { OFFICE_FUND_BUFFER } from "@/libraries/corporation/farmland.js"
import { maintainOfficeStaff } from "@/libraries/corporation/office.js"
import { TOBACCO_DIVISION } from "@/libraries/corporation/tobacco.js"

const SELL_AMOUNT = "MAX"
const SELL_PRICE = "MP"

function isSellConfigured(amount: string | number, price: string | number): boolean {
  return String(amount) === SELL_AMOUNT && String(price) === SELL_PRICE
}

/** Staff offices and sell all products at market price. */
export async function manageTobaccoOperations(ns: NS): Promise<string[]> {
  const corp = ns.corporation
  const lines: string[] = []

  if (!corp.hasCorporation()) return lines

  const info = corp.getCorporation()
  if (!info.divisions.includes(TOBACCO_DIVISION)) return lines

  const division = corp.getDivision(TOBACCO_DIVISION)

  for (const city of division.cities) {
    try {
      corp.getOffice(TOBACCO_DIVISION, city)
    } catch {
      continue
    }

    if (!corp.hasWarehouse(TOBACCO_DIVISION, city)) continue

    await maintainOfficeStaff(ns, TOBACCO_DIVISION, city, info.funds, lines)

    for (const productName of division.products) {
      try {
        const product = corp.getProduct(TOBACCO_DIVISION, city, productName)
        const already = isSellConfigured(product.desiredSellAmount, product.desiredSellPrice)
        corp.sellProduct(TOBACCO_DIVISION, city, productName, SELL_AMOUNT, SELL_PRICE, false)
        if (!already) {
          lines.push(`${TOBACCO_DIVISION}/${city}/${productName}: sell ${SELL_AMOUNT} @ ${SELL_PRICE}`)
        }
      } catch {
        // product not yet available in this city
      }
    }
  }

  return lines
}
