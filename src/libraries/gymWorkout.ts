import type { CityName, GymType, NS } from "@ns"

export const GYM_CITY: CityName = "Sector-12"
export const GYM_NAME = "Powerhouse Gym"

const MILLI_PER_CYCLE = 200
const LEVEL_POLL_MS = 50

export type CombatGymSkill = "str" | "def" | "dex" | "agi"
type CombatSkill = "strength" | "defense" | "dexterity" | "agility"
type CombatExp = "strExp" | "defExp" | "dexExp" | "agiExp"

const SKILL_BY_GYM: Record<CombatGymSkill, CombatSkill> = {
  str: "strength",
  def: "defense",
  dex: "dexterity",
  agi: "agility",
}

const EXP_GAIN_BY_GYM: Record<CombatGymSkill, CombatExp> = {
  str: "strExp",
  def: "defExp",
  dex: "dexExp",
  agi: "agiExp",
}

const ORDER_PREFERENCE: Record<CombatGymSkill, number> = {
  str: 0,
  def: 1,
  dex: 2,
  agi: 3,
}

function getCombatSkillLevel(ns: NS, gymType: GymType): number {
  return ns.getPlayer().skills[SKILL_BY_GYM[gymType as CombatGymSkill]]
}

function estimateMsToNextLevel(ns: NS, gymType: GymType): number | null {
  try {
    const player = ns.getPlayer()
    const skill = SKILL_BY_GYM[gymType as CombatGymSkill]
    const level = player.skills[skill]
    const mult = player.mults[skill]
    const expNeeded = ns.formulas.skills.calculateExp(level + 1, mult) - player.exp[skill]
    if (expNeeded <= 0) return 0

    const gains = ns.formulas.work.gymGains(player, gymType, GYM_NAME)
    const expPerCycle = gains[EXP_GAIN_BY_GYM[gymType as CombatGymSkill]]
    if (expPerCycle <= 0) return null

    return (expNeeded / expPerCycle) * MILLI_PER_CYCLE
  } catch {
    return null
  }
}

export function getCombatGymSkillLevel(ns: NS, gymType: GymType): number {
  return getCombatSkillLevel(ns, gymType)
}

/** Lowest combat stat; str < def < dex < agi on ties. */
export function getLowestCombatGymSkill(ns: NS): CombatGymSkill {
  const player = ns.getPlayer()
  const skills: Array<{ name: CombatGymSkill; value: number }> = [
    { name: "agi", value: player.skills.agility },
    { name: "dex", value: player.skills.dexterity },
    { name: "def", value: player.skills.defense },
    { name: "str", value: player.skills.strength },
  ]

  return skills.reduce((min, skill) => {
    if (skill.value < min.value) return skill
    if (skill.value === min.value && ORDER_PREFERENCE[skill.name] < ORDER_PREFERENCE[min.name]) {
      return skill
    }
    return min
  }).name
}

export function startGymWorkout(ns: NS, gymType: GymType, focus = ns.singularity.isFocused()): void {
  ns.singularity.gymWorkout(GYM_NAME, gymType, focus)
}

export async function workoutUntilLevelUp(
  ns: NS,
  gymType: GymType,
  focus = ns.singularity.isFocused()
): Promise<void> {
  const startLevel = getCombatSkillLevel(ns, gymType)
  ns.singularity.gymWorkout(GYM_NAME, gymType, focus)

  const estimate = estimateMsToNextLevel(ns, gymType)
  if (estimate != null && estimate > 0) {
    await ns.sleep(Math.max(0, estimate - MILLI_PER_CYCLE))
  }

  while (getCombatSkillLevel(ns, gymType) === startLevel) {
    await ns.sleep(LEVEL_POLL_MS)
  }
}
