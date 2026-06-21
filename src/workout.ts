import { NS } from "@ns"
import {
  GYM_CITY,
  getSoonestLevelCombatGymSkill,
  workoutUntilLevelUp,
} from "./libraries/gymWorkout.js"
import { travelToInfiltrationCity } from "./libraries/infiltration/infiltrationTargets.js"
import { canAffordInfiltrationTravel } from "./libraries/infiltration/infiltrationTargets.js"

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
    if (
      skillGap >= SKILL_GAP_TRAVEL_THRESHOLD &&
      player.city !== GYM_CITY &&
      player.money >= MIN_TRAVEL_MONEY &&
      now - lastTravelAt >= TRAVEL_COOLDOWN_MS
    ) {
      ns.singularity.travelToCity(GYM_CITY)
      lastTravelAt = now
      await ns.sleep(500)
    }

    if (ns.getPlayer().city !== GYM_CITY) {
      if (canAffordInfiltrationTravel(ns)) {
        await travelToInfiltrationCity(ns, GYM_CITY)
      } else {
        await ns.sleep(2000)
        continue
      }
    }

    await workoutUntilLevelUp(ns, trainingSkill, focus)
  }
}
