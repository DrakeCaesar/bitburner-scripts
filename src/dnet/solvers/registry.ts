import type { AuthTarget, ServerDetails } from "../types.js"
import type { SolverModule } from "./types.js"
import { LABYRINTH_MODEL } from "../constants.js"
import { labyrinthSolver } from "./labyrinth.js"
import { SOLVER_MODULES, bellaCuoreRange } from "./impl/all.js"

/** Resolve solver from live server details, or from target metadata when the host is temporarily unreachable. */
export function lookupSolverForTarget(target: AuthTarget, details: ServerDetails | null): SolverModule | null {
  if (details) return lookupSolver(details)
  if (target.modelId === LABYRINTH_MODEL) return labyrinthSolver
  if (target.modelId === "BellaCuore" && target.format === "numeric") {
    return bellaCuoreRange
  }
  return SOLVER_MODULES[`${target.modelId}|${target.format}`] ?? null
}

export function lookupSolver(details: ServerDetails): SolverModule | null {
  if (details.modelId === LABYRINTH_MODEL) {
    return labyrinthSolver
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

/** Registry key for web-worker solver dispatch; null for labyrinth (inline on main thread). */
export function solverWorkerKey(details: ServerDetails): string | null {
  if (details.modelId === LABYRINTH_MODEL) return null
  if (details.modelId === "BellaCuore" && details.passwordFormat === "numeric" && details.data.includes(",")) {
    return "BellaCuore|numeric|range"
  }
  const key = solverKey(details)
  return SOLVER_MODULES[key] ? key : null
}

/** Worker key from target metadata when live server details are unavailable. */
export function solverWorkerKeyForTarget(target: AuthTarget, details: ServerDetails | null): string | null {
  if (target.modelId === LABYRINTH_MODEL) return null
  if (details) return solverWorkerKey(details)
  if (target.modelId === "BellaCuore" && target.format === "numeric") {
    return "BellaCuore|numeric"
  }
  const key = `${target.modelId}|${target.format}`
  return SOLVER_MODULES[key] ? key : null
}

export { SOLVER_MODULES }
