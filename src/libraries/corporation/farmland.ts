import { CityName, CorpIndustryName } from "@ns"

/** Farmland division identity — leaf module (no other corp imports). */
export const FARMLAND_DIVISION = "Farmland"
export const FARMLAND_INDUSTRY: CorpIndustryName = "Agriculture"

/** Offices opened in order; each needs office + warehouse before the next city. */
export const FARMLAND_CITIES: readonly CityName[] = ["Sector-12", "Aevum"] as const

export const FARMLAND_START_CITY: CityName = FARMLAND_CITIES[0]

/** Reserve kept in corp funds before office/warehouse purchases and hiring. */
export const OFFICE_FUND_BUFFER = 5e6
