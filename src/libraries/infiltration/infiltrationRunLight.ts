import type { NS } from "@ns"
import {
  clickStartInfiltration,
  dismissInfiltrationFailureModal,
  isInfiltrationActive,
  isOnInfiltrationIntro,
  tryPrepareCityNavigation,
  visitInfiltrationTargetDom,
} from "./infiltrationNavigation.js"
import type { InfiltrationTarget } from "./infiltrationTargets.js"
import {
  clearInfiltrationRunOutcome,
  peekInfiltrationRunOutcome,
  setInfiltrationRunOutcome,
} from "./infiltrationRunState.js"
import {
  getInfiltrationSolverPollMs,
  tickInfiltrationSolver,
  type InfiltrationSolverState,
} from "./infiltrationSolver.js"
import { travelToInfiltrationCity } from "./infiltrationTargets.js"

const MODAL_DISMISS_SETTLE_MS = 250
const DEFAULT_STEP_TIMEOUT_MS = 15000
const DEFAULT_RUN_TIMEOUT_MS = 600000

export type InfiltrationRunLightOutcome =
  | "victory"
  | "cancelled"
  | "timeout"
  | "visit_failed"
  | "travel_failed"

export interface InfiltrationRunLightOptions {
  stepTimeoutMs?: number
  runTimeoutMs?: number
  solver: InfiltrationSolverState
}

/** Infiltration run loop without full victory/faction modules (solver handles rewards). */
export async function runInfiltrationForTargetLight(
  ns: NS,
  target: InfiltrationTarget,
  options: InfiltrationRunLightOptions
): Promise<InfiltrationRunLightOutcome> {
  const stepTimeoutMs = options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
  const runTimeoutMs = options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS
  const solver = options.solver

  async function finishVictory(): Promise<InfiltrationRunLightOutcome> {
    return "victory"
  }

  tryPrepareCityNavigation()

  if (isInfiltrationActive()) {
    ns.print(`Infiltration already active; waiting for ${target.name}`)
  } else if (!(await travelToInfiltrationCity(ns, target.city))) {
    ns.print(`ERROR: travelToCity(${target.city}) failed`)
    return "travel_failed"
  }

  if (ns.getPlayer().city !== target.city) {
    ns.print(`ERROR: still in ${ns.getPlayer().city} after travel to ${target.city}`)
    return "travel_failed"
  }

  tryPrepareCityNavigation()

  let visitDeadline = Date.now() + stepTimeoutMs
  const runDeadline = Date.now() + runTimeoutMs
  let lastStep = ""
  let infiltrationStarted = isInfiltrationActive()

  solver.wasActive = false
  solver.inactiveStreak = 0
  solver.victoryHandled = false
  solver.session = null
  clearInfiltrationRunOutcome()

  function prepareInfiltrationRetry(reason: string): void {
    ns.print(`${reason} at ${target.name}; starting another run`)
    infiltrationStarted = false
    lastStep = ""
    visitDeadline = Date.now() + stepTimeoutMs
    solver.wasActive = false
    solver.inactiveStreak = 0
    solver.victoryHandled = false
    solver.session = null
    clearInfiltrationRunOutcome()
    tryPrepareCityNavigation()
  }

  async function handleInfiltrationRetry(reason: string): Promise<null> {
    prepareInfiltrationRetry(reason)
    await ns.sleep(MODAL_DISMISS_SETTLE_MS)
    return null
  }

  async function waitTick(): Promise<InfiltrationRunLightOutcome | null> {
    const solverResult = await tickInfiltrationSolver(ns, solver)
    if (solverResult === "failed") {
      return handleInfiltrationRetry("Infiltration run failed")
    }
    if (solverResult === "cancelled") {
      if (dismissInfiltrationFailureModal()) {
        return handleInfiltrationRetry("Infiltration run failed")
      }
      clearInfiltrationRunOutcome()
      ns.print(`Infiltration cancelled at ${target.name}`)
      return "cancelled"
    }
    if (solverResult === "victory") {
      return finishVictory()
    }
    await ns.sleep(getInfiltrationSolverPollMs(solver))
    return null
  }

  while (Date.now() < runDeadline) {
    if (dismissInfiltrationFailureModal()) {
      const tickOutcome = await handleInfiltrationRetry("Infiltration run failed")
      if (tickOutcome) return tickOutcome
      continue
    }

    if (infiltrationStarted && isInfiltrationActive()) {
      const tickOutcome = await waitTick()
      if (tickOutcome) return tickOutcome
      continue
    }

    if (infiltrationStarted && !isInfiltrationActive() && !solver.isVictoryScreen?.()) {
      const sharedOutcome = peekInfiltrationRunOutcome()
      if (sharedOutcome === "cancelled") {
        if (dismissInfiltrationFailureModal()) {
          const tickOutcome = await handleInfiltrationRetry("Infiltration run failed")
          if (tickOutcome) return tickOutcome
          continue
        }
        clearInfiltrationRunOutcome()
        ns.print(`Infiltration cancelled at ${target.name}`)
        return "cancelled"
      }
      if (sharedOutcome === "victory") {
        clearInfiltrationRunOutcome()
        ns.print(`Infiltration at ${target.name} complete`)
        return finishVictory()
      }
      const tickOutcome = await waitTick()
      if (tickOutcome) return tickOutcome
      continue
    }

    if (!infiltrationStarted && Date.now() >= visitDeadline) {
      ns.print(`ERROR: Timed out visiting ${target.name}`)
      return "timeout"
    }

    if (isInfiltrationActive()) {
      if (!infiltrationStarted) {
        ns.print(`Infiltration running at ${target.name}`)
      }
      infiltrationStarted = true
      const tickOutcome = await waitTick()
      if (tickOutcome) return tickOutcome
      continue
    }

    if (isOnInfiltrationIntro(target.name) && clickStartInfiltration()) {
      ns.print(`Started infiltration at ${target.name}`)
      infiltrationStarted = true
      const tickOutcome = await waitTick()
      if (tickOutcome) return tickOutcome
      continue
    }

    if (Date.now() >= visitDeadline && infiltrationStarted) {
      const tickOutcome = await waitTick()
      if (tickOutcome) return tickOutcome
      continue
    }

    if (infiltrationStarted) {
      const tickOutcome = await waitTick()
      if (tickOutcome) return tickOutcome
      continue
    }

    const result = visitInfiltrationTargetDom(ns, target.name, target.city)
    if (result.step !== lastStep) {
      ns.print(`Step: ${result.step}${result.detail ? ` (${result.detail})` : ""}`)
      lastStep = result.step
    }

    if (!result.ok) {
      if (result.step === "wrong city" || result.step === "go to location failed") {
        if (ns.getPlayer().city !== target.city) {
          ns.print(`Need ${target.city} for ${target.name}; traveling from ${ns.getPlayer().city}...`)
          if (!(await travelToInfiltrationCity(ns, target.city))) {
            ns.print(`ERROR: travelToCity(${target.city}) failed`)
            return "travel_failed"
          }
          tryPrepareCityNavigation()
        } else {
          ns.print(`Singularity goToLocation(${target.name}) failed; waiting...`)
        }
        const tickOutcome = await waitTick()
        if (tickOutcome) return tickOutcome
        continue
      }
      ns.print(`ERROR: ${result.step}${result.detail ? `: ${result.detail}` : ""}`)
      return "visit_failed"
    }

    if (result.step === "started") {
      ns.print(`Infiltration started at ${target.name}`)
      infiltrationStarted = true
      const tickOutcome = await waitTick()
      if (tickOutcome) return tickOutcome
      continue
    }

    const tickOutcome = await waitTick()
    if (tickOutcome) return tickOutcome
  }

  ns.print(`ERROR: Timed out waiting for infiltration at ${target.name}`)
  return "timeout"
}
