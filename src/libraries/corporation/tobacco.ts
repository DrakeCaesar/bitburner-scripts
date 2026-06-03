import { CityName, CorpIndustryName } from "@ns"

export const TOBACCO_DIVISION = "Tobacco"
export const TOBACCO_INDUSTRY: CorpIndustryName = "Tobacco"
export const TOBACCO_START_CITY: CityName = "Sector-12"
export const TOBACCO_CITIES: readonly CityName[] = [TOBACCO_START_CITY] as const

/** First product created in the start city when the division has no products yet. */
export const TOBACCO_PRODUCT_NAME = "Smoke"
export const TOBACCO_DESIGN_INVEST = 4e9
export const TOBACCO_MARKETING_INVEST = 1e9
