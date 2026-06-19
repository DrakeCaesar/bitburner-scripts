import { NS } from "@ns"
import {
  prepareCombatSkillTraining,
  renderCombatSkillTrainingTable,
} from "./libraries/combatSkillTraining.js"
import { getPreferredFactionForInfiltrationRep } from "./libraries/factionWork.js"
import {
  getLowestCombatGymSkill,
  type CombatGymSkill,
} from "./libraries/gymWorkout.js"
import { syncTrustedKeyInjection } from "./libraries/infiltration/infiltrationKeyInput.js"
import { isInfiltrationActive } from "./libraries/infiltration/infiltrationNavigation.js"
import {
  runInfiltrationForTarget,
} from "./libraries/infiltration/infiltrationRun.js"
import {
  InfiltrationRunStatsTracker,
  formatCombatSkillTrainingDomLines,
  formatInfiltrationRunViewLines,
} from "./libraries/infiltration/infiltrationRunStats.js"
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
  getEffectiveInfiltrationRepPerLevel,
  getEffectiveInfiltrationRepReward,
  getInfiltrationApi,
  getInfiltrationRewardPerLevel,
  INFILTRATION_TRAVEL_COST,
  isInfiltrationMoneyMode,
  shouldSellAndDonateForRep,
} from "./libraries/infiltration/infiltrationTargets.js"
import { getInfiltrationRewardGoal } from "./libraries/infiltration/infiltrationFactionGoals.js"
import {
  collectInfiltrationVictoryReward,
  isInfiltrationVictoryScreen,
} from "./libraries/infiltration/infiltrationVictory.js"
import { openTailLog } from "./libraries/scriptLogUiLayout.js"

const SHOW_INFILTRATION_DOM_WINDOW = true
const SHOW_COMBAT_TRAINING_TABLE = true
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

function maybeSwitchGymTraining(ns: NS, trainingStat: CombatGymSkill): CombatGymSkill {
  const lowest = getLowestCombatGymSkill(ns)
  if (lowest === trainingStat) return trainingStat
  ns.print(`Switching combat training from ${trainingStat} to ${lowest}`)
  return lowest
}

function syncTrainingDom(ns: NS, solver: InfiltrationSolverState, trainingStat: CombatGymSkill): void {
  solver.trainingSkill = trainingStat
  refreshInfiltrationDomWindow(ns, solver)
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
    collectVictoryReward: collectInfiltrationVictoryReward,
    isVictoryScreen: isInfiltrationVictoryScreen,
    formatTrainingLines: formatCombatSkillTrainingDomLines,
  })
  ns.atExit(() => shutdownInfiltrationSolver(solver))
  openTailLog(ns, isInfiltrationMoneyMode(ns) ? "Auto Infiltration (money)" : "Auto Infiltration")
  if (!SOLVE_MINIGAMES) {
    ns.print("Minigame solver disabled; waiting for minigames to fail")
  }
  const runStats = new InfiltrationRunStatsTracker()
  solver.runStats = runStats
  solver.formatRunViewLines = (viewNs) => formatInfiltrationRunViewLines(viewNs, runStats.getView(viewNs))
  let trainingStat = getLowestCombatGymSkill(ns)
  syncTrainingDom(ns, solver, trainingStat)

  try {
    while (true) {
      syncTrainingDom(ns, solver, trainingStat)

      const rewardGoal = getInfiltrationRewardGoal(ns)
      const grindFaction =
        rewardGoal === "reputation" ? getPreferredFactionForInfiltrationRep(ns) : null
      const globalBest = getBestInfiltrationTarget(ns, rewardGoal, undefined, grindFaction)
      const playerCity = ns.getPlayer().city
      const target = getBestInfiltrationTargetForPlayer(ns, rewardGoal, grindFaction)

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

      const rewardPerLevel =
        rewardGoal === "reputation" && grindFaction != null
          ? getEffectiveInfiltrationRepPerLevel(ns, target, grindFaction)
          : getInfiltrationRewardPerLevel(target, rewardGoal)
      const rewardLabel =
        rewardGoal === "reputation" && grindFaction != null
          ? (() => {
              const effectiveRep = getEffectiveInfiltrationRepReward(ns, target, grindFaction)
              const viaDonation = shouldSellAndDonateForRep(
                ns,
                target.data.reward.sellCash,
                target.data.reward.tradeRep,
                grindFaction
              )
              const method = viaDonation ? "donate" : "trade"
              return `rep ${ns.format.number(effectiveRep)} (${method}, ${ns.format.number(rewardPerLevel)}/lvl, ${target.data.maxClearanceLevel} lvls)`
            })()
          : `cash ${ns.format.number(target.data.reward.sellCash)} (${ns.format.number(rewardPerLevel)}/lvl, ${target.data.maxClearanceLevel} lvls)`
      ns.print(
        `Target: ${target.name} (${target.city}, ${target.tier}, rating ${target.rating.toFixed(0)}, ${rewardLabel})`
      )

      if (isInfiltrationActive()) {
        ns.print("Infiltration already in progress; waiting for completion...")
      }

      if (SHOW_COMBAT_TRAINING_TABLE) {
        await renderCombatSkillTrainingTable(ns, trainingStat)
      }
      await prepareCombatSkillTraining(ns, trainingStat)
      syncTrainingDom(ns, solver, trainingStat)

      runStats.beginCycle(ns, target, rewardGoal, grindFaction)
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

      await prepareCombatSkillTraining(ns, trainingStat)
      syncTrainingDom(ns, solver, trainingStat)
      syncTrustedKeyInjection()
    }
  } finally {
    shutdownInfiltrationSolver(solver)
  }
}
