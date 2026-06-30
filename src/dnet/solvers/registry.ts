import type { ServerDetails } from "../types.js"
import type { SolverModule } from "./types.js"
import { LABYRINTH_MODEL } from "../constants.js"
import { SOLVER_MODULES, bellaCuoreRange } from "./impl/all.js"

export function lookupSolver(details: ServerDetails): SolverModule | null {
  if (details.modelId === LABYRINTH_MODEL) {
    return null
  }
  if (details.modelId === "BellaCuore" && details.passwordFormat === "numeric" && details.data.includes(",")) {
    return bellaCuoreRange
  }
  const key = `${details.modelId}|${details.passwordFormat}`
  return SOLVER_MODULES[key] ?? null
}

export function solverKey(details: ServerDetails): string {
  return `${details.modelId}|${details.passwordFormat}`
}

export { SOLVER_MODULES }
