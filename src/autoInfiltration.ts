import { NS } from "@ns"
import { getPreferredFactionForInfiltrationRep, isWorkingForFactionOrCompany } from "./libraries/factionWork.js"
import {
  GYM_CITY,
  GYM_NAME,
  getCombatGymSkillLevel,
  getLowestCombatGymSkill,
  workoutUntilLevelUp,
  type CombatGymSkill,
} from "./libraries/gymWorkout.js"
import { disableTrustedKeyInjection, syncTrustedKeyInjection } from "./libraries/infiltration/infiltrationKeyInput.js"
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

const CHECK_INTERVAL_MS = 2000
const BETWEEN_RUNS_MS = 1000
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

  const levelBefore = getCombatGymSkillLevel(ns, trainingStat)
  ns.print(`Gym: ${GYM_NAME} (${trainingStat}, level ${levelBefore})`)
  await workoutUntilLevelUp(ns, trainingStat, ns.singularity.isFocused())
}

async function maybeSwitchGymTraining(
  ns: NS,
  trainingStat: CombatGymSkill
): Promise<CombatGymSkill> {
  const lowest = getLowestCombatGymSkill(ns)
  if (lowest === trainingStat) return trainingStat

  if (ns.getPlayer().city !== GYM_CITY && !canAffordInfiltrationTravel(ns)) {
    ns.print(
      `Lowest stat is now ${lowest}; cannot afford travel (${ns.format.number(INFILTRATION_TRAVEL_COST)}) to switch gym training`
    )
    return trainingStat
  }

  if (ns.getPlayer().city !== GYM_CITY) {
    ns.print(`Lowest stat is now ${lowest}; traveling to ${GYM_CITY} to switch gym training`)
    if (!(await travelToInfiltrationCity(ns, GYM_CITY))) {
      ns.print(`Travel to ${GYM_CITY} failed; keeping gym training on ${trainingStat}`)
      return trainingStat
    }
  }

  ns.print(`Switching gym training from ${trainingStat} to ${lowest}`)
  return lowest
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("sleep")
  ns.atExit(() => disableTrustedKeyInjection())
  ns.ui.openTail()
  ns.ui.setTailTitle(isInfiltrationMoneyMode(ns) ? "Auto Infiltration (money)" : "Auto Infiltration")

  if (!getInfiltrationApi(ns)) {
    ns.print("ERROR: ns.infiltration API is not available")
    return
  }

  killConflictingScripts(ns)

  const solver = setupInfiltrationSolver(ns, {
    showDomWindow: SHOW_INFILTRATION_DOM_WINDOW,
    showMinigameInfo: SHOW_MINIGAME_INFO,
  })
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
          trainingStat = await maybeSwitchGymTraining(ns, trainingStat)
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
