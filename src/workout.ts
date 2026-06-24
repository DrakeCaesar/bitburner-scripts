import { NS } from "@ns"
import {
  GYM_CITY,
  workoutUntilLevelUp,
  COMBAT_GYM_SKILLS,
  estimateCombatGymMsToNextLevel,
  combatGymExpPerSecond,
  getCombatSkillLevelMult,
  getCombatSkillTotalLevelExp,
  getLowestCombatGymSkill,
  type CombatGymSkill,
} from "./libraries/gymWorkout.js"
import { travelToInfiltrationCity } from "./libraries/infiltration/infiltrationTargets.js"
import { canAffordInfiltrationTravel } from "./libraries/infiltration/infiltrationTargets.js"
import { openTailLog } from "./libraries/scriptLogUiLayout.js"
import { renderGymDashboard, type GymDashboardData } from "./libraries/gymDashboard.js"

const SKILL_GAP_TRAVEL_THRESHOLD = 100
const MIN_TRAVEL_MONEY = 100_000_000
const TRAVEL_COOLDOWN_MS = 60_000
const SKILL_PICK_INTERVAL_MS = 1000

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
  let lastSkillPickAt = 0
  let trainingSkill: CombatGymSkill = "str"

  while (true) {
    const focus = ns.singularity.isFocused()
    const player = ns.getPlayer()
    const now = Date.now()

    // Travel logic — cheap checks every iteration
    const skillLevels = [
      player.skills.agility,
      player.skills.dexterity,
      player.skills.defense,
      player.skills.strength,
    ]
    const skillGap = Math.max(...skillLevels) - Math.min(...skillLevels)
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

    if (player.city !== GYM_CITY) {
      if (canAffordInfiltrationTravel(ns)) {
        await travelToInfiltrationCity(ns, GYM_CITY)
        continue
      }
      // Can't afford travel — show dashboard and wait
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
        estimatesMs: { str: null, def: null, dex: null, agi: null },
        expPerSecond: { str: null, def: null, dex: null, agi: null },
        totalLevelExp: { str: 0, def: 0, dex: 0, agi: 0 },
        levelMults: { str: 0, def: 0, dex: 0, agi: 0 },
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

    // Re-evaluate skill pick, compute dashboard data, and render GUI at most once per second.
    // On other iterations just keep training the same stat — no NS API calls, no rendering.
    if (now - lastSkillPickAt >= SKILL_PICK_INTERVAL_MS) {
      lastSkillPickAt = now
      const freshPlayer = ns.getPlayer()

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

      trainingSkill = bestMs === Infinity
        ? getLowestCombatGymSkill(ns)
        : tiedSkills[0]

      const allNull =
        estimatesMs.str == null && estimatesMs.def == null &&
        estimatesMs.dex == null && estimatesMs.agi == null
      const d: GymDashboardData = {
        levels: {
          str: freshPlayer.skills.strength,
          def: freshPlayer.skills.defense,
          dex: freshPlayer.skills.dexterity,
          agi: freshPlayer.skills.agility,
        },
        exp: {
          str: freshPlayer.exp.strength,
          def: freshPlayer.exp.defense,
          dex: freshPlayer.exp.dexterity,
          agi: freshPlayer.exp.agility,
        },
        estimatesMs,
        expPerSecond,
        totalLevelExp,
        levelMults,
        training: trainingSkill,
        selectionMethod: allNull ? "lowest" : "soonest",
        tiedSkills,
        city: freshPlayer.city,
        focused: focus,
        skillGap,
        traveling: false,
      }
      await renderGymDashboard(ns, d)
    }

    await workoutUntilLevelUp(ns, trainingSkill, focus)
  }
}
