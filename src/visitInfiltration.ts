import { NS } from "@ns"
import { isInfiltrationActive } from "./libraries/infiltration/infiltrationNavigation.js"
import { runInfiltrationForTarget } from "./libraries/infiltration/infiltrationRun.js"
import {
  getEasiestInfiltrationTarget,
  getInfiltrationApi,
  getInfiltrationTargetByName,
} from "./libraries/infiltration/infiltrationTargets.js"

export async function main(ns: NS): Promise<void> {
  ns.disableLog("sleep")

  if (!getInfiltrationApi(ns)) {
    ns.print("ERROR: ns.infiltration API is not available")
    return
  }

  const arg = String(ns.args[0] ?? "").trim()
  const target = arg ? getInfiltrationTargetByName(ns, arg) : getEasiestInfiltrationTarget(ns)

  if (!target) {
    ns.print("ERROR: No available infiltration targets found")
    return
  }

  ns.print(
    `Target: ${target.name} (${target.city}, ${target.tier}, rating ${target.rating.toFixed(0)})`
  )

  if (isInfiltrationActive()) {
    ns.print("Infiltration already in progress")
    return
  }

  await runInfiltrationForTarget(ns, target)
}
