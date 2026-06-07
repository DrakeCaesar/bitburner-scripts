import { NS } from "@ns"
import { disableTrustedKeyInjection, syncTrustedKeyInjection } from "./libraries/infiltration/infiltrationKeyInput.js"
import { isInfiltrationActive } from "./libraries/infiltration/infiltrationNavigation.js"
import { runInfiltrationForTarget } from "./libraries/infiltration/infiltrationRun.js"
import { setupInfiltrationSolver, shutdownInfiltrationSolver } from "./libraries/infiltration/infiltrationSolver.js"
import {
  getInfiltrationApi,
  getInfiltrationTargetsHardestFirst,
  type InfiltrationTarget,
} from "./libraries/infiltration/infiltrationTargets.js"

const CHECK_INTERVAL_MS = 2000
const BETWEEN_RUNS_MS = 1000

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
  ns.atExit(() => disableTrustedKeyInjection())
  ns.ui.openTail()
  ns.ui.setTailTitle("Auto Infiltration")

  if (!getInfiltrationApi(ns)) {
    ns.print("ERROR: ns.infiltration API is not available")
    return
  }

  const solver = setupInfiltrationSolver(ns)

  let targetIndex = 0

  try {
    while (true) {
      const targets = getInfiltrationTargetsHardestFirst(ns)
      const picked = pickNextTarget(targets, targetIndex)

      if (!picked) {
        ns.print("No infiltration targets available. Waiting...")
        syncTrustedKeyInjection()
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

      const outcome = await runInfiltrationForTarget(ns, target, { solver })

      switch (outcome) {
        case "victory":
          ns.print(`Done: ${target.name}. Picking next target.`)
          break
        case "cancelled":
          ns.print("Infiltration cancelled. Stopping auto script.")
          return
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
      syncTrustedKeyInjection()
    }
  } finally {
    shutdownInfiltrationSolver(solver)
  }
}
