import { CityName, CorpIndustryName } from "@ns"
import type { TableLayout } from "../scriptLogUi.js"

export const CORP_NAME = "dracorp"
export const FARMLAND_DIVISION = "Farmland"
export const FARMLAND_INDUSTRY: CorpIndustryName = "Agriculture"
export const FARMLAND_START_CITY: CityName = "Sector-12"

export const CORP_LOG_LAYOUT: Partial<TableLayout> = {
  tableWidthPx: 880,
  fontSizePx: 12,
}
