import type { NS } from "@ns"
import {
  GYM_CITY,
  GYM_NAME,
  combatGymExpPerSecond,
  getCombatGymSkillLevel,
  getLowestCombatGymSkill,
  startGymWorkout,
  type CombatGymSkill,
} from "../gymWorkout.js"
import {
  canAffordInfiltrationTravel,
  travelToInfiltrationCity,
} from "./infiltrationTargets.js"

/** Gym-only training lines for the infiltration DOM overlay. */
export function formatGymTrainingDomLines(ns: NS, skill?: CombatGymSkill): string[] {
  const gymSkill = skill ?? getLowestCombatGymSkill(ns)
  const rate = combatGymExpPerSecond(ns, gymSkill, ns.singularity.isFocused()) ?? 0
  return [
    "--- Training ---",
    `Pick: gym ${gymSkill} @ ${GYM_NAME} (${ns.format.number(rate)}/s)`,
    "Mode: combat for infiltrations",
  ]
}

/** Travel to the gym city if needed and start a gym workout. */
export async function prepareInfiltrationGymTraining(ns: NS, skill: CombatGymSkill): Promise<void> {
  if (ns.singularity.getCurrentWork()?.type === "FACTION") {
    ns.print("Skipping gym; faction work active")
    return
  }

  const focus = ns.singularity.isFocused()

  if (ns.getPlayer().city !== GYM_CITY) {
    if (!canAffordInfiltrationTravel(ns)) {
      ns.print(`Skipping gym; cannot afford travel to ${GYM_CITY}`)
      return
    }
    ns.print(`Traveling to ${GYM_CITY} for gym (${skill})`)
    if (!(await travelToInfiltrationCity(ns, GYM_CITY))) {
      ns.print(`Travel to ${GYM_CITY} failed; skipping gym`)
      return
    }
  }

  const level = getCombatGymSkillLevel(ns, skill)
  const rate = combatGymExpPerSecond(ns, skill, focus) ?? 0
  ns.print(`Gym: ${GYM_NAME} (${skill}, level ${level}, ${ns.format.number(rate)}/s)`)
  startGymWorkout(ns, skill, focus)
}
