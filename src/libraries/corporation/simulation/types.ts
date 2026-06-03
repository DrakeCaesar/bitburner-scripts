import { CityName, CorpMaterialName, CorpStateName } from "@ns"

export type CorpStage = CorpStateName

export interface MaterialSnapshot {
  name: CorpMaterialName
  stored: number
  quality: number
  averagePrice: number
  marketPrice: number
  buyAmount: number
  productionAmount: number
  desiredSellAmount: string | number
  desiredSellPrice: string | number
  marketTa1: boolean
  marketTa2: boolean
  demand: number
  competition: number
  actualSellAmount: number
  size: number
  productionLimit: number | null
}

export interface OfficeSnapshot {
  city: CityName
  numEmployees: number
  size: number
  employeeProductionByJob: Record<string, number>
  totalExperience: number
}

export interface WarehouseSnapshot {
  city: CityName
  size: number
  sizeUsed: number
  smartSupplyEnabled: boolean
  materials: Partial<Record<CorpMaterialName, MaterialSnapshot>>
}

export interface DivisionSnapshot {
  name: string
  industry: string
  awareness: number
  popularity: number
  productionMult: number
  researchPoints: number
  lastCycleRevenue: number
  lastCycleExpenses: number
  thisCycleRevenue: number
  thisCycleExpenses: number
  requiredMaterials: Partial<Record<CorpMaterialName, number>>
  producedMaterials: CorpMaterialName[]
  researchFactor: number
  aiCoreFactor: number
  cities: CityName[]
  offices: OfficeSnapshot[]
  warehouses: WarehouseSnapshot[]
}

export interface CorporationSnapshot {
  name: string
  funds: number
  revenue: number
  expenses: number
  prevState: CorpStage
  nextState: CorpStage
  divisions: DivisionSnapshot[]
}

export interface SimContext {
  secondsPerMarketCycle: number
  marketCycles: number
  /** BitNode / global production modifier (default 1 if unknown). */
  corpProductionMult: number
  /** Research-tree production modifier (default 1 until modeled). */
  divisionResearchProductionMult: number
  /** Advertising / sales modifier from research (default 1). */
  divisionSalesMult: number
  /** Global corp sales modifier (default 1). */
  corpSalesMult: number
  advertisingFactor: number
  industryAdvertisingFactor: number
}

export interface FieldComparison {
  path: string
  predicted: number
  actual: number
  delta: number
  relError: number | null
  ok: boolean
}

export interface StageValidationResult {
  stage: CorpStage
  division: string
  city: CityName
  comparisons: FieldComparison[]
  allOk: boolean
  notes: string[]
}
