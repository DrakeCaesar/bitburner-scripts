import { NS } from "@ns"
import { isInfiltrationActive } from "./libraries/infiltration/infiltrationNavigation.js"
import { runInfiltrationForTarget } from "./libraries/infiltration/infiltrationRun.js"
import {
  getInfiltrationApi,
  getInfiltrationTargetsHardestFirst,
  type InfiltrationTarget,
} from "./libraries/infiltration/infiltrationTargets.js"

const SOLVER_SCRIPT = "infiltrationDom.js"
const CHECK_INTERVAL_MS = 2000
const BETWEEN_RUNS_MS = 1000

function isSolverRunning(ns: NS): boolean {
  for (const proc of ns.ps("home")) {
    if (proc.filename === SOLVER_SCRIPT) {
      return true
    }
  }
  return false
}

function ensureSolverRunning(ns: NS): void {
  if (isSolverRunning(ns)) {
    return
  }

  const pid = ns.exec(SOLVER_SCRIPT, "home", 1)
  if (pid === 0) {
    ns.print(`WARNING: Failed to start ${SOLVER_SCRIPT}`)
    return
  }

  ns.print(`Started ${SOLVER_SCRIPT} (pid ${pid})`)
}

function pickNextTarget(
  targets: InfiltrationTarget[],
  index: number
): { target: InfiltrationTarget; nextIndex: number } | null {
  if (targets.length === 0) {
    return null
  }

  const target = targets[index % targets.length]
  return { target, nextIndex: (index + 1) % targets.length }
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("sleep")
  ns.ui.openTail()
  ns.ui.setTailTitle("Auto Infiltration")

  if (!getInfiltrationApi(ns)) {
    ns.print("ERROR: ns.infiltration API is not available")
    return
  }

  ensureSolverRunning(ns)

  let targetIndex = 0

  while (true) {
    ensureSolverRunning(ns)

    const targets = getInfiltrationTargetsHardestFirst(ns)
    const picked = pickNextTarget(targets, targetIndex)

    if (!picked) {
      ns.print("No infiltration targets available. Waiting...")
      await ns.sleep(CHECK_INTERVAL_MS)
      continue
    }

    targetIndex = picked.nextIndex
    const target = picked.target

    ns.print(
      `Target: ${target.name} (${target.city}, ${target.tier}, rating ${target.rating.toFixed(0)})`
    )

    if (isInfiltrationActive()) {
      ns.print("Infiltration already in progress; waiting for completion...")
    }

    const outcome = await runInfiltrationForTarget(ns, target)

    switch (outcome) {
      case "victory":
        ns.print(`Done: ${target.name}. Picking next target.`)
        break
      case "travel_failed":
        ns.print(`Travel failed for ${target.city}. Retrying next cycle.`)
        break
      case "visit_failed":
        ns.print(`Visit failed for ${target.name}. Trying next target.`)
        break
      case "timeout":
        ns.print(`Timed out on ${target.name}. Trying next target.`)
        break
    }

    await ns.sleep(BETWEEN_RUNS_MS)
  }
}
