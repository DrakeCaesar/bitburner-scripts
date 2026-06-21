import { NS } from "@ns"
import {
  formatGymTrainingDomLines,
  prepareInfiltrationGymTraining,
} from "./libraries/infiltration/infiltrationGymTraining.js"
import { syncTrustedKeyInjection } from "./libraries/infiltration/infiltrationKeyInput.js"
import { isInfiltrationActive } from "./libraries/infiltration/infiltrationNavigation.js"
import { runInfiltrationForTargetLight } from "./libraries/infiltration/infiltrationRunLight.js"
import {
  refreshInfiltrationDomWindow,
  setupInfiltrationSolver,
  shutdownInfiltrationSolver,
  type InfiltrationSolverState,
} from "./libraries/infiltration/infiltrationSolver.js"
import {
  canAffordInfiltrationTravel,
  getBestInfiltrationTarget,
  getBestInfiltrationTargetForPlayer,
  getInfiltrationApi,
  getInfiltrationRewardPerLevel,
  INFILTRATION_TRAVEL_COST,
  type InfiltrationRewardGoal,
} from "./libraries/infiltration/infiltrationTargets.js"
import {
  collectInfiltrationVictoryRewardMoney,
  isInfiltrationVictoryScreen,
} from "./libraries/infiltration/infiltrationVictoryMoney.js"
import {
  getSoonestLevelCombatGymSkill,
  type CombatGymSkill,
} from "./libraries/gymWorkout.js"

const REWARD_GOAL: InfiltrationRewardGoal = "money"
const SHOW_INFILTRATION_DOM_WINDOW = true
const SHOW_MINIGAME_INFO = false
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

function maybeSwitchGymTraining(ns: NS, trainingStat: CombatGymSkill): CombatGymSkill {
  const next = getSoonestLevelCombatGymSkill(ns)
  if (next === trainingStat) return trainingStat
  ns.print(`Switching combat training from ${trainingStat} to ${next} (soonest level-up)`)
  return next
}

function syncTrainingDom(ns: NS, solver: InfiltrationSolverState, trainingStat: CombatGymSkill): void {
  solver.trainingSkill = trainingStat
  refreshInfiltrationDomWindow(ns, solver)
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("sleep")
  ns.ui.openTail()

  if (!getInfiltrationApi(ns)) {
    ns.print("ERROR: ns.infiltration API is not available")
    return
  }

  killConflictingScripts(ns)

  const solver = setupInfiltrationSolver(ns, {
    showDomWindow: SHOW_INFILTRATION_DOM_WINDOW,
    showMinigameInfo: SHOW_MINIGAME_INFO,
    solveMinigames: SOLVE_MINIGAMES,
    collectVictoryReward: collectInfiltrationVictoryRewardMoney,
    isVictoryScreen: isInfiltrationVictoryScreen,
    formatTrainingLines: formatGymTrainingDomLines,
  })
  ns.atExit(() => shutdownInfiltrationSolver(solver))

  if (!SOLVE_MINIGAMES) {
    ns.print("Minigame solver disabled; waiting for minigames to fail")
  }

  let trainingStat = getSoonestLevelCombatGymSkill(ns)
  syncTrainingDom(ns, solver, trainingStat)

  try {
    while (true) {
      trainingStat = maybeSwitchGymTraining(ns, trainingStat)
      syncTrainingDom(ns, solver, trainingStat)

      const globalBest = getBestInfiltrationTarget(ns, REWARD_GOAL)
      const playerCity = ns.getPlayer().city
      const target = getBestInfiltrationTargetForPlayer(ns, REWARD_GOAL)

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

      const rewardPerLevel = getInfiltrationRewardPerLevel(target, REWARD_GOAL)
      ns.print(
        `Target: ${target.name} (${target.city}, ${target.tier}, rating ${target.rating.toFixed(0)}, ` +
          `cash ${ns.format.number(target.data.reward.sellCash)} (${ns.format.number(rewardPerLevel)}/lvl, ${target.data.maxClearanceLevel} lvls))`
      )

      if (isInfiltrationActive()) {
        ns.print("Infiltration already in progress; waiting for completion...")
      }

      await prepareInfiltrationGymTraining(ns, trainingStat)
      syncTrainingDom(ns, solver, trainingStat)

      const outcome = await runInfiltrationForTargetLight(ns, target, { solver })

      switch (outcome) {
        case "victory":
          trainingStat = maybeSwitchGymTraining(ns, trainingStat)
          ns.print(`Done: ${target.name}. Re-running best cash target.`)
          break
        case "cancelled":
          ns.print("Infiltration cancelled. Stopping auto script.")
          return
        case "travel_failed":
          ns.print(`Travel failed for ${target.city}. Retrying.`)
          break
        case "visit_failed":
          ns.print(`Visit failed for ${target.name}. Retrying.`)
          break
        case "timeout":
          ns.print(`Timed out on ${target.name}. Retrying.`)
          break
      }

      await prepareInfiltrationGymTraining(ns, trainingStat)
      syncTrainingDom(ns, solver, trainingStat)
      syncTrustedKeyInjection()
    }
  } finally {
    shutdownInfiltrationSolver(solver)
  }
}
