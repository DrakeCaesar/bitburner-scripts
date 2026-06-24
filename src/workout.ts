import { NS } from "@ns"
import {
  GYM_CITY,
  getSoonestLevelCombatGymSkill,
  workoutUntilLevelUp,
  COMBAT_GYM_SKILLS,
  estimateCombatGymMsToNextLevel,
  combatGymExpPerSecond,
  getCombatSkillLevelMult,
  getCombatSkillTotalLevelExp,
  type CombatGymSkill,
} from "./libraries/gymWorkout.js"
import { travelToInfiltrationCity } from "./libraries/infiltration/infiltrationTargets.js"
import { canAffordInfiltrationTravel } from "./libraries/infiltration/infiltrationTargets.js"
import { openTailLog } from "./libraries/scriptLogUiLayout.js"
import { renderGymDashboard, type GymDashboardData } from "./libraries/gymDashboard.js"

const SKILL_GAP_TRAVEL_THRESHOLD = 100
const MIN_TRAVEL_MONEY = 100_000_000
const TRAVEL_COOLDOWN_MS = 60_000

export async function main(ns: NS): Promise<void> {
  const scriptName = ns.getScriptName()
  for (const proc of ns.ps(ns.getHostname())) {
    if (proc.filename === scriptName && proc.pid !== ns.pid) {
      ns.kill(proc.pid)
    }
  }

  ns.disableLog("ALL")
  openTailLog(ns, "Gym Workout")

  let lastTravelAt = 0

  while (true) {
    const focus = ns.singularity.isFocused()
    const player = ns.getPlayer()
    const trainingSkill = getSoonestLevelCombatGymSkill(ns, focus)

    const skillLevels = [
      player.skills.agility,
      player.skills.dexterity,
      player.skills.defense,
      player.skills.strength,
    ]
    const skillGap = Math.max(...skillLevels) - Math.min(...skillLevels)
    const now = Date.now()
    const needsTravel =
      skillGap >= SKILL_GAP_TRAVEL_THRESHOLD &&
      player.city !== GYM_CITY &&
      player.money >= MIN_TRAVEL_MONEY &&
      now - lastTravelAt >= TRAVEL_COOLDOWN_MS

    if (needsTravel) {
      ns.singularity.travelToCity(GYM_CITY)
      lastTravelAt = now
      await ns.sleep(500)
    }

    const isTraveling = player.city !== GYM_CITY
    if (isTraveling) {
      if (canAffordInfiltrationTravel(ns)) {
        await travelToInfiltrationCity(ns, GYM_CITY)
      } else {
        // Build dashboard before sleeping so the UI shows the travel state
        const estimatesMs: Record<string, number | null> = {}
        const expPerSecond: Record<string, number | null> = {}
        const totalLevelExp: Record<string, number> = {}
        const levelMults: Record<string, number> = {}
        for (const skill of COMBAT_GYM_SKILLS) {
          estimatesMs[skill] = estimateCombatGymMsToNextLevel(ns, skill, focus)
          expPerSecond[skill] = combatGymExpPerSecond(ns, skill, focus)
          totalLevelExp[skill] = getCombatSkillTotalLevelExp(ns, skill)
          levelMults[skill] = getCombatSkillLevelMult(ns, skill)
        }
        const d: GymDashboardData = {
          levels: {
            str: player.skills.strength,
            def: player.skills.defense,
            dex: player.skills.dexterity,
            agi: player.skills.agility,
          },
          exp: {
            str: player.exp.strength,
            def: player.exp.defense,
            dex: player.exp.dexterity,
            agi: player.exp.agility,
          },
          estimatesMs,
          expPerSecond,
          totalLevelExp,
          levelMults,
          training: trainingSkill,
          selectionMethod: "soonest",
          tiedSkills: [],
          city: player.city,
          focused: focus,
          skillGap,
          traveling: true,
        }
        await renderGymDashboard(ns, d)
        await ns.sleep(2000)
        continue
      }
    }

    // Compute dashboard data before training
    const estimatesMs: Record<string, number | null> = {}
    const expPerSecond: Record<string, number | null> = {}
    const totalLevelExp: Record<string, number> = {}
    const levelMults: Record<string, number> = {}
    let bestMs = Infinity
    const tiedSkills: CombatGymSkill[] = []

    for (const skill of COMBAT_GYM_SKILLS) {
      const ms = estimateCombatGymMsToNextLevel(ns, skill, focus)
      estimatesMs[skill] = ms
      expPerSecond[skill] = combatGymExpPerSecond(ns, skill, focus)
      totalLevelExp[skill] = getCombatSkillTotalLevelExp(ns, skill)
      levelMults[skill] = getCombatSkillLevelMult(ns, skill)

      if (ms != null && ms < bestMs) {
        bestMs = ms
        tiedSkills.length = 0
        tiedSkills.push(skill)
      } else if (ms != null && ms === bestMs) {
        tiedSkills.push(skill)
      }
    }

    // If all estimates were null, log that we're using the fallback
    const allNull = estimatesMs.str == null && estimatesMs.def == null && estimatesMs.dex == null && estimatesMs.agi == null
    const prevPlayer = ns.getPlayer()
    const d: GymDashboardData = {
      levels: {
        str: prevPlayer.skills.strength,
        def: prevPlayer.skills.defense,
        dex: prevPlayer.skills.dexterity,
        agi: prevPlayer.skills.agility,
      },
      exp: {
        str: prevPlayer.exp.strength,
        def: prevPlayer.exp.defense,
        dex: prevPlayer.exp.dexterity,
        agi: prevPlayer.exp.agility,
      },
      estimatesMs,
      expPerSecond,
      totalLevelExp,
      levelMults,
      training: trainingSkill,
      selectionMethod: allNull ? "lowest" : "soonest",
      tiedSkills,
      city: prevPlayer.city,
      focused: focus,
      skillGap,
      traveling: false,
    }
    await renderGymDashboard(ns, d)

    await workoutUntilLevelUp(ns, trainingSkill, focus)
  }
}
