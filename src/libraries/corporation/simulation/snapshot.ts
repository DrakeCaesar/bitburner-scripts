import { CityName, CorpMaterialName, NS } from "@ns"
import { warehouseSizeUsed } from "./math.js"
import type { CorporationSnapshot, DivisionSnapshot, MaterialSnapshot, OfficeSnapshot, WarehouseSnapshot } from "./types.js"

/** Match display.ts — inlined so sim modules do not import a separate constants module (breaks RAM calc). */
const FARMLAND_DIVISION = "Farmland"

function captureMaterial(ns: NS, division: string, city: CityName, name: CorpMaterialName): MaterialSnapshot | null {
  const corp = ns.corporation
  try {
    const mat = corp.getMaterial(division, city, name)
    const data = corp.getMaterialData(name)
    return {
      name,
      stored: mat.stored,
      quality: mat.quality,
      // Not exposed on Material API; seeded from market price for sim bookkeeping.
      averagePrice: mat.marketPrice,
      marketPrice: mat.marketPrice,
      buyAmount: mat.buyAmount,
      productionAmount: mat.productionAmount,
      desiredSellAmount: mat.desiredSellAmount,
      desiredSellPrice: mat.desiredSellPrice,
      // Market-TA flags are not readable via getMaterial; Farmland automation leaves them off.
      marketTa1: false,
      marketTa2: false,
      demand: mat.demand ?? 1,
      competition: mat.competition ?? 0,
      actualSellAmount: mat.actualSellAmount,
      size: data.size,
      productionLimit: mat.productionLimit,
    }
  } catch {
    return null
  }
}

function captureWarehouse(ns: NS, division: DivisionSnapshot, city: CityName): WarehouseSnapshot | null {
  const corp = ns.corporation
  if (!corp.hasWarehouse(division.name, city)) return null

  const warehouse = corp.getWarehouse(division.name, city)
  const materials: Partial<Record<CorpMaterialName, MaterialSnapshot>> = {}

  const names = new Set<CorpMaterialName>()
  for (const n of Object.keys(division.requiredMaterials) as CorpMaterialName[]) names.add(n)
  for (const n of division.producedMaterials) names.add(n)

  for (const name of names) {
    const mat = captureMaterial(ns, division.name, city, name)
    if (mat) materials[name] = mat
  }

  return {
    city,
    size: warehouse.size,
    sizeUsed: warehouse.sizeUsed,
    smartSupplyEnabled: warehouse.smartSupplyEnabled,
    materials,
  }
}

function captureDivision(ns: NS, divisionName: string): DivisionSnapshot {
  const corp = ns.corporation
  const division = corp.getDivision(divisionName)
  const industry = corp.getIndustryData(division.industry)

  const snapshot: DivisionSnapshot = {
    name: divisionName,
    industry: division.industry,
    awareness: division.awareness,
    popularity: division.popularity,
    productionMult: division.productionMult,
    researchPoints: division.researchPoints,
    lastCycleRevenue: division.lastCycleRevenue,
    lastCycleExpenses: division.lastCycleExpenses,
    thisCycleRevenue: division.thisCycleRevenue,
    thisCycleExpenses: division.thisCycleExpenses,
    requiredMaterials: { ...(industry.requiredMaterials ?? {}) },
    producedMaterials: [...(industry.producedMaterials ?? [])] as CorpMaterialName[],
    researchFactor: industry.scienceFactor ?? 0.1,
    aiCoreFactor: industry.aiCoreFactor ?? 0.05,
    cities: [...division.cities],
    offices: [],
    warehouses: [],
  }

  for (const city of division.cities) {
    try {
      const office = corp.getOffice(divisionName, city)
      snapshot.offices.push({
        city,
        numEmployees: office.numEmployees,
        size: office.size,
        employeeProductionByJob: { ...office.employeeProductionByJob },
        totalExperience: office.totalExperience,
      })
    } catch {
      // no office in city
    }

    const wh = captureWarehouse(ns, snapshot, city)
    if (wh) snapshot.warehouses.push(wh)
  }

  return snapshot
}

export function captureCorporationSnapshot(ns: NS, divisionName = FARMLAND_DIVISION): CorporationSnapshot | null {
  const corp = ns.corporation
  if (!corp.hasCorporation()) return null

  const info = corp.getCorporation()
  const divisions: DivisionSnapshot[] = []

  if (info.divisions.includes(divisionName)) {
    divisions.push(captureDivision(ns, divisionName))
  }

  return {
    name: info.name,
    funds: info.funds,
    revenue: info.revenue,
    expenses: info.expenses,
    prevState: info.prevState,
    nextState: info.nextState,
    divisions,
  }
}

export function getDivisionWarehouse(
  snapshot: CorporationSnapshot,
  divisionName: string,
  city: CityName
): WarehouseSnapshot | undefined {
  const division = snapshot.divisions.find((d) => d.name === divisionName)
  return division?.warehouses.find((w) => w.city === city)
}

export function recomputeWarehouseSizeUsed(warehouse: WarehouseSnapshot): void {
  warehouse.sizeUsed = warehouseSizeUsed(warehouse.materials)
}
