import { NS } from "@ns"
import { getPreferredFactionForInfiltrationRep, isWorkingForFactionOrCompany } from "./libraries/factionWork.js"
import {
  GYM_CITY,
  GYM_NAME,
  getCombatGymSkillLevel,
  getLowestCombatGymSkill,
  startGymWorkout,
  type CombatGymSkill,
} from "./libraries/gymWorkout.js"
import { syncTrustedKeyInjection } from "./libraries/infiltration/infiltrationKeyInput.js"
import { isInfiltrationActive } from "./libraries/infiltration/infiltrationNavigation.js"
import {
  runInfiltrationForTarget,
  travelToInfiltrationCity,
} from "./libraries/infiltration/infiltrationRun.js"
import { InfiltrationRunStatsTracker } from "./libraries/infiltration/infiltrationRunStats.js"
import { setupInfiltrationSolver, shutdownInfiltrationSolver } from "./libraries/infiltration/infiltrationSolver.js"
import {
  canAffordInfiltrationTravel,
  getBestInfiltrationTarget,
  getBestInfiltrationTargetForPlayer,
  getInfiltrationApi,
  getInfiltrationRewardGoal,
  getInfiltrationRewardPerLevel,
  INFILTRATION_TRAVEL_COST,
  isInfiltrationMoneyMode,
} from "./libraries/infiltration/infiltrationTargets.js"

const SHOW_INFILTRATION_DOM_WINDOW = true
const SHOW_MINIGAME_INFO = false
/** Set false to let minigames time out without sending keys (testing). */
const SOLVE_MINIGAMES = true

const CHECK_INTERVAL_MS = 2000
const WORKOUT_SCRIPT = "workout.js"

function killConflictingScripts(ns: NS): void {
  const scriptName = ns.getScriptName()
  for (const proc of ns.ps(ns.getHostname())) {
    if (proc.pid === ns.pid) continue
    if (proc.filename === scriptName || proc.filename === WORKOUT_SCRIPT) {
      ns.kill(proc.pid)
    }
  }
}

async function prepareGymWorkout(ns: NS, trainingStat: CombatGymSkill): Promise<void> {
  if (isWorkingForFactionOrCompany(ns)) {
    ns.print("Skipping gym workout; faction or company work active")
    return
  }

  if (ns.getPlayer().city !== GYM_CITY) {
    if (!canAffordInfiltrationTravel(ns)) {
      ns.print(`Skipping gym workout; cannot afford travel to ${GYM_CITY}`)
      return
    }
    ns.print(`Traveling to ${GYM_CITY} for gym workout (${trainingStat})`)
    if (!(await travelToInfiltrationCity(ns, GYM_CITY))) {
      ns.print(`Travel to ${GYM_CITY} failed; skipping gym workout`)
      return
    }
  }

  const level = getCombatGymSkillLevel(ns, trainingStat)
  ns.print(`Gym: ${GYM_NAME} (${trainingStat}, level ${level})`)
  startGymWorkout(ns, trainingStat, ns.singularity.isFocused())
}

function maybeSwitchGymTraining(ns: NS, trainingStat: CombatGymSkill): CombatGymSkill {
  const lowest = getLowestCombatGymSkill(ns)
  if (lowest === trainingStat) return trainingStat
  ns.print(`Switching gym training from ${trainingStat} to ${lowest}`)
  return lowest
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("sleep")

  if (!getInfiltrationApi(ns)) {
    ns.print("ERROR: ns.infiltration API is not available")
    return
  }

  killConflictingScripts(ns)

  const solver = setupInfiltrationSolver(ns, {
    showDomWindow: SHOW_INFILTRATION_DOM_WINDOW,
    showMinigameInfo: SHOW_MINIGAME_INFO,
    solveMinigames: SOLVE_MINIGAMES,
  })
  ns.atExit(() => shutdownInfiltrationSolver(solver))
  ns.ui.openTail()
  ns.ui.setTailTitle(isInfiltrationMoneyMode(ns) ? "Auto Infiltration (money)" : "Auto Infiltration")
  if (!SOLVE_MINIGAMES) {
    ns.print("Minigame solver disabled; waiting for minigames to fail")
  }
  const runStats = new InfiltrationRunStatsTracker()
  solver.runStats = runStats
  let trainingStat = getLowestCombatGymSkill(ns)

  try {
    while (true) {
      const rewardGoal = getInfiltrationRewardGoal(ns)
      const grindFaction =
        rewardGoal === "reputation" ? getPreferredFactionForInfiltrationRep(ns) : null
      const globalBest = getBestInfiltrationTarget(ns, rewardGoal)
      const playerCity = ns.getPlayer().city
      const target = getBestInfiltrationTargetForPlayer(ns, rewardGoal)

      if (!target) {
        if (
          globalBest != null &&
          globalBest.city !== playerCity &&
          !canAffordInfiltrationTravel(ns)
        ) {
          ns.print(
            `Cannot afford travel (${ns.format.number(INFILTRATION_TRAVEL_COST)}) and no targets in ${playerCity}. Waiting...`
          )
        } else {
          ns.print("No infiltration targets available. Waiting...")
        }
        syncTrustedKeyInjection()
        await ns.sleep(CHECK_INTERVAL_MS)
        continue
      }

      if (
        globalBest != null &&
        target !== globalBest &&
        globalBest.city !== playerCity &&
        !canAffordInfiltrationTravel(ns)
      ) {
        ns.print(
          `Cannot afford travel (${ns.format.number(INFILTRATION_TRAVEL_COST)}); using ${target.name} in ${playerCity}`
        )
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

      await prepareGymWorkout(ns, trainingStat)

      runStats.beginCycle(target, rewardGoal, grindFaction)
      const outcome = await runInfiltrationForTarget(ns, target, { solver })

      switch (outcome) {
        case "victory":
          runStats.completeCycle()
          trainingStat = maybeSwitchGymTraining(ns, trainingStat)
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

      syncTrustedKeyInjection()
    }
  } finally {
    shutdownInfiltrationSolver(solver)
  }
}
