import type { CityName, NS } from "@ns"
import {
  clickStartInfiltration,
  isInfiltrationActive,
  isOnInfiltrationIntro,
  visitInfiltrationTargetDom,
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

  if (isInfiltrationActive()) {
    ns.print(`Infiltration already active; waiting for ${target.name}`)
  } else if (!(await travelToInfiltrationCity(ns, target.city))) {
    ns.print(`ERROR: travelToCity(${target.city}) failed`)
    return "travel_failed"
  }

  const visitDeadline = Date.now() + stepTimeoutMs
  const runDeadline = Date.now() + runTimeoutMs
  let lastStep = ""
  let victoryHandled = false
  let infiltrationStarted = isInfiltrationActive()

  while (Date.now() < runDeadline) {
    if (isInfiltrationVictoryScreen()) {
      if (!victoryHandled) {
        const reward = collectInfiltrationVictoryReward(ns)
        if (reward.ok) {
          victoryHandled = true
          setInfiltrationRunOutcome("victory")
          ns.print(`Victory at ${target.name}: ${reward.detail}`)
          return "victory"
        }
        ns.print(`Victory reward failed at ${target.name}: ${reward.detail}`)
      }
      await ns.sleep(POLL_MS)
      continue
    }
    victoryHandled = false

    if (infiltrationStarted && isInfiltrationActive()) {
      await ns.sleep(POLL_MS)
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
        return "victory"
      }
      ns.print(`Infiltration at ${target.name} complete`)
      return "victory"
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
      await ns.sleep(POLL_MS)
      continue
    }

    if (isOnInfiltrationIntro(target.name) && clickStartInfiltration()) {
      ns.print(`Started infiltration at ${target.name}`)
      infiltrationStarted = true
      await ns.sleep(POLL_MS)
      continue
    }

    if (Date.now() >= visitDeadline && infiltrationStarted) {
      await ns.sleep(POLL_MS)
      continue
    }

    const result = visitInfiltrationTargetDom(target.name)
    if (result.step !== lastStep) {
      ns.print(`Step: ${result.step}${result.detail ? ` (${result.detail})` : ""}`)
      lastStep = result.step
    }

    if (!result.ok) {
      ns.print(`ERROR: ${result.step}${result.detail ? `: ${result.detail}` : ""}`)
      return "visit_failed"
    }

    if (result.step === "started") {
      ns.print(`Infiltration started at ${target.name}`)
      infiltrationStarted = true
      await ns.sleep(POLL_MS)
      continue
    }

    await ns.sleep(POLL_MS)
  }

  ns.print(`ERROR: Timed out waiting for infiltration at ${target.name}`)
  return "timeout"
}
