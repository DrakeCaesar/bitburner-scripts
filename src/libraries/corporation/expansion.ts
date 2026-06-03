import { NS } from "@ns"
import { ensureDivisionBranch } from "@/libraries/corporation/divisionBranch.js"
import { FARMLAND_CITIES, FARMLAND_DIVISION, FARMLAND_INDUSTRY } from "@/libraries/corporation/farmland.js"

const FARMLAND_BRANCH = {
  divisionName: FARMLAND_DIVISION,
  industry: FARMLAND_INDUSTRY,
  cities: FARMLAND_CITIES,
}

/** Create Farmland and open each configured city (office + warehouse) when affordable. */
export function ensureFarmlandDivision(ns: NS): string[] {
  return ensureDivisionBranch(ns, FARMLAND_BRANCH)
}
