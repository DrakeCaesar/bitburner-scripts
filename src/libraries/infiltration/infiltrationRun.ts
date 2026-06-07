import type { CityName, NS } from "@ns"
import {
  clickStartInfiltration,
  isInfiltrationActive,
  isOnInfiltrationIntro,
  visitInfiltrationTargetDom,
  waitForCityNavigationReady,
} from "./infiltrationNavigation.js"
import type { InfiltrationTarget } from "./infiltrationTargets.js"
import {
  collectInfiltrationVictoryReward,
  isInfiltrationVictoryScreen,
} from "./infiltrationVictory.js"
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

const POLL_MS = 200
const DEFAULT_STEP_TIMEOUT_MS = 15000
const DEFAULT_RUN_TIMEOUT_MS = 600000

export type InfiltrationRunOutcome =
  | "victory"
  | "cancelled"
  | "timeout"
  | "visit_failed"
  | "travel_failed"

export interface InfiltrationRunOptions {
  stepTimeoutMs?: number
  runTimeoutMs?: number
  solver?: InfiltrationSolverState
}

export async function travelToInfiltrationCity(ns: NS, city: CityName): Promise<boolean> {
  if (ns.getPlayer().city === city) {
    return true
  }

  if (!ns.singularity.travelToCity(city)) {
    return false
  }

  await ns.sleep(500)
  return true
}

export async function runInfiltrationForTarget(
  ns: NS,
  target: InfiltrationTarget,
  options: InfiltrationRunOptions = {}
): Promise<InfiltrationRunOutcome> {
  const stepTimeoutMs = options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
  const runTimeoutMs = options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS

  async function finishVictory(): Promise<InfiltrationRunOutcome> {
    if (await waitForCityNavigationReady(ns)) {
      return "victory"
    }
    ns.print(`ERROR: Victory UI did not close in time at ${target.name}`)
    return "timeout"
  }

  if (!(await waitForCityNavigationReady(ns))) {
    ns.print(`Waiting for infiltration UI to close before visiting ${target.name}...`)
    if (!(await waitForCityNavigationReady(ns))) {
      ns.print("ERROR: Infiltration UI still blocking navigation")
      return "visit_failed"
    }
  }

  if (isInfiltrationActive()) {
    ns.print(`Infiltration already active; waiting for ${target.name}`)
  } else if (!(await travelToInfiltrationCity(ns, target.city))) {
    ns.print(`ERROR: travelToCity(${target.city}) failed`)
    return "travel_failed"
  }

  if (!(await waitForCityNavigationReady(ns, 5000))) {
    ns.print(`Waiting for city UI after travel to ${target.city}...`)
    await waitForCityNavigationReady(ns)
  }

  const visitDeadline = Date.now() + stepTimeoutMs
  const runDeadline = Date.now() + runTimeoutMs
  let lastStep = ""
  let victoryHandled = false
  let infiltrationStarted = isInfiltrationActive()
  const solver = options.solver

  async function waitTick(): Promise<InfiltrationRunOutcome | null> {
    if (solver) {
      const solverResult = await tickInfiltrationSolver(ns, solver)
      if (solverResult === "cancelled") {
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

    await ns.sleep(POLL_MS)
    return null
  }

  while (Date.now() < runDeadline) {
    if (!solver && isInfiltrationVictoryScreen()) {
      if (!victoryHandled) {
        const reward = await collectInfiltrationVictoryReward(ns)
        if (reward.ok) {
          victoryHandled = true
          setInfiltrationRunOutcome("victory")
          ns.print(`Victory at ${target.name}: ${reward.detail}`)
          return finishVictory()
        }
        ns.print(`Victory reward failed at ${target.name}: ${reward.detail}`)
      }
      const tickOutcome = await waitTick()
      if (tickOutcome) return tickOutcome
      continue
    }
    if (!solver) {
      victoryHandled = false
    }

    if (infiltrationStarted && isInfiltrationActive()) {
      const tickOutcome = await waitTick()
      if (tickOutcome) return tickOutcome
      continue
    }

    if (infiltrationStarted && !isInfiltrationActive() && !isInfiltrationVictoryScreen()) {
      const sharedOutcome = peekInfiltrationRunOutcome()
      if (sharedOutcome === "cancelled") {
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

    const result = visitInfiltrationTargetDom(target.name)
    if (result.step !== lastStep) {
      ns.print(`Step: ${result.step}${result.detail ? ` (${result.detail})` : ""}`)
      lastStep = result.step
    }

    if (!result.ok) {
      if (result.step === "city sidebar missing") {
        ns.print("City sidebar not ready yet; waiting...")
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
