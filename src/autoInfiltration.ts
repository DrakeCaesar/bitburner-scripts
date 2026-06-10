import { NS } from "@ns"
import { getPreferredFactionForInfiltrationRep } from "./libraries/factionWork.js"
import { disableTrustedKeyInjection, syncTrustedKeyInjection } from "./libraries/infiltration/infiltrationKeyInput.js"
import { isInfiltrationActive } from "./libraries/infiltration/infiltrationNavigation.js"
import { runInfiltrationForTarget } from "./libraries/infiltration/infiltrationRun.js"
import { InfiltrationRunStatsTracker } from "./libraries/infiltration/infiltrationRunStats.js"
import { setupInfiltrationSolver, shutdownInfiltrationSolver } from "./libraries/infiltration/infiltrationSolver.js"
import {
  getBestInfiltrationTarget,
  getInfiltrationApi,
  getInfiltrationRewardGoal,
  getInfiltrationRewardPerLevel,
  isInfiltrationMoneyMode,
} from "./libraries/infiltration/infiltrationTargets.js"

const SHOW_INFILTRATION_DOM_WINDOW = true
const SHOW_MINIGAME_INFO = false

const CHECK_INTERVAL_MS = 2000
const BETWEEN_RUNS_MS = 1000

export async function main(ns: NS): Promise<void> {
  ns.disableLog("sleep")
  ns.atExit(() => disableTrustedKeyInjection())
  ns.ui.openTail()
  ns.ui.setTailTitle(isInfiltrationMoneyMode(ns) ? "Auto Infiltration (money)" : "Auto Infiltration")

  if (!getInfiltrationApi(ns)) {
    ns.print("ERROR: ns.infiltration API is not available")
    return
  }

  const solver = setupInfiltrationSolver(ns, {
    showDomWindow: SHOW_INFILTRATION_DOM_WINDOW,
    showMinigameInfo: SHOW_MINIGAME_INFO,
  })
  const runStats = new InfiltrationRunStatsTracker()
  solver.runStats = runStats

  try {
    while (true) {
      const rewardGoal = getInfiltrationRewardGoal(ns)
      const grindFaction =
        rewardGoal === "reputation" ? getPreferredFactionForInfiltrationRep(ns) : null
      const target = getBestInfiltrationTarget(ns, rewardGoal)

      if (!target) {
        ns.print("No infiltration targets available. Waiting...")
        syncTrustedKeyInjection()
        await ns.sleep(CHECK_INTERVAL_MS)
        continue
      }

      const rewardPerLevel = getInfiltrationRewardPerLevel(target, rewardGoal)
      const rewardLabel =
        rewardGoal === "reputation"
          ? `rep ${ns.format.number(target.data.reward.tradeRep)} (${ns.format.number(rewardPerLevel)}/lvl, ${target.data.maxClearanceLevel} lvls)`
          : `cash ${ns.format.number(target.data.reward.sellCash)} (${ns.format.number(rewardPerLevel)}/lvl, ${target.data.maxClearanceLevel} lvls)`
      ns.print(
        `Target: ${target.name} (${target.city}, ${target.tier}, rating ${target.rating.toFixed(0)}, ${rewardLabel})`
      )

      if (isInfiltrationActive()) {
        ns.print("Infiltration already in progress; waiting for completion...")
      }

      runStats.beginCycle(target, rewardGoal, grindFaction)
      const outcome = await runInfiltrationForTarget(ns, target, { solver })

      switch (outcome) {
        case "victory":
          runStats.completeCycle()
          ns.print(`Done: ${target.name}. Re-running best ${rewardGoal} target.`)
          break
        case "cancelled":
          runStats.abandonCycle()
          ns.print("Infiltration cancelled. Stopping auto script.")
          return
        case "travel_failed":
          runStats.abandonCycle()
          ns.print(`Travel failed for ${target.city}. Retrying.`)
          break
        case "visit_failed":
          runStats.abandonCycle()
          ns.print(`Visit failed for ${target.name}. Retrying.`)
          break
        case "timeout":
          runStats.abandonCycle()
          ns.print(`Timed out on ${target.name}. Retrying.`)
          break
      }

      await ns.sleep(BETWEEN_RUNS_MS)
      syncTrustedKeyInjection()
    }
  } finally {
    shutdownInfiltrationSolver(solver)
  }
}
