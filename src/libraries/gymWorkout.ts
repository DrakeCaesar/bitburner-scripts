import type { CityName, GymType, NS } from "@ns"

export const GYM_CITY: CityName = "Sector-12"
export const GYM_NAME = "Powerhouse Gym"

const MILLI_PER_CYCLE = 200
const LEVEL_POLL_MS = 50
export const CYCLES_PER_SECOND = 1000 / MILLI_PER_CYCLE
const UNFOCUSED_FOCUS_MULT = 0.8

export type CombatGymSkill = "str" | "def" | "dex" | "agi"
type CombatSkill = "strength" | "defense" | "dexterity" | "agility"
export type CombatExpField = "strExp" | "defExp" | "dexExp" | "agiExp"

export const SKILL_BY_GYM: Record<CombatGymSkill, CombatSkill> = {
  str: "strength",
  def: "defense",
  dex: "dexterity",
  agi: "agility",
}

export const EXP_GAIN_BY_GYM: Record<CombatGymSkill, CombatExpField> = {
  str: "strExp",
  def: "defExp",
  dex: "dexExp",
  agi: "agiExp",
}

export const COMBAT_GYM_SKILLS: readonly CombatGymSkill[] = ["str", "def", "dex", "agi"]

type BitNodeLevelMultiplierKey = "StrengthLevelMultiplier" | "DefenseLevelMultiplier" | "DexterityLevelMultiplier" | "AgilityLevelMultiplier"

const BN_LEVEL_MULT_KEY: Record<CombatGymSkill, BitNodeLevelMultiplierKey> = {
  str: "StrengthLevelMultiplier",
  def: "DefenseLevelMultiplier",
  dex: "DexterityLevelMultiplier",
  agi: "AgilityLevelMultiplier",
}

/** Effective level multiplier for calculateSkill/calculateExp — matches the
 *  game's Person.ts and StatsProgressBar: player.mults[skill] * currentNodeMults */
export function getCombatSkillLevelMult(ns: NS, gymType: CombatGymSkill): number {
  const player = ns.getPlayer()
  const skillName = SKILL_BY_GYM[gymType]
  const bnMults = ns.getBitNodeMultipliers()
  return player.mults[skillName] * bnMults[BN_LEVEL_MULT_KEY[gymType]]
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

/** Estimated ms for a full 0%→100% level at the gym (ignores current progress). */
export function estimateCombatGymMsToNextLevel(
  ns: NS,
  gymType: CombatGymSkill,
  focus = ns.singularity.isFocused()
): number | null {
  try {
    const player = ns.getPlayer()
    const skill = SKILL_BY_GYM[gymType]
    const mult = getCombatSkillLevelMult(ns, gymType)
    const level = ns.formulas.skills.calculateSkill(player.exp[skill], mult)
    const totalExp = ns.formulas.skills.calculateExp(level + 1, mult) - ns.formulas.skills.calculateExp(level, mult)
    if (totalExp <= 0) return 0

    const gains = ns.formulas.work.gymGains(player, gymType, GYM_NAME)
    const expPerCycle =
      gains[EXP_GAIN_BY_GYM[gymType]] * focusMultiplier(focus)
    if (expPerCycle <= 0) return null

    return (totalExp / expPerCycle) * MILLI_PER_CYCLE
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

/** Combat stat that will level up soonest at the gym; str < def < dex < agi on ties. */
export function getSoonestLevelCombatGymSkill(
  ns: NS,
  focus = ns.singularity.isFocused()
): CombatGymSkill {
  let best: CombatGymSkill = COMBAT_GYM_SKILLS[0]
  let bestMs = Infinity

  for (const gymType of COMBAT_GYM_SKILLS) {
    const ms = estimateCombatGymMsToNextLevel(ns, gymType, focus) ?? Infinity
    if (ms < bestMs || (ms === bestMs && ORDER_PREFERENCE[gymType] < ORDER_PREFERENCE[best])) {
      best = gymType
      bestMs = ms
    }
  }

  return bestMs === Infinity ? getLowestCombatGymSkill(ns) : best
}

function focusMultiplier(focus: boolean): number {
  return focus ? 1 : UNFOCUSED_FOCUS_MULT
}

/** Focused combat skill exp/s at the infiltration gym. */
export function combatGymExpPerSecond(
  ns: NS,
  gymType: CombatGymSkill,
  focus = ns.singularity.isFocused()
): number | null {
  try {
    const gains = ns.formulas.work.gymGains(ns.getPlayer(), gymType, GYM_NAME)
    const expPerCycle = gains[EXP_GAIN_BY_GYM[gymType]]
    if (expPerCycle <= 0) return null
    return expPerCycle * CYCLES_PER_SECOND * focusMultiplier(focus)
  } catch {
    return null
  }
}

/**
 * Gym baseline for a multi-stat job. Gym trains one stat at a time, so compare against
 * the mean gym rate across the job's stats (sum / N), not the sum of all gym rates.
 */
export function combinedGymCombatExpPerSecond(
  ns: NS,
  skills: readonly CombatGymSkill[],
  focus = ns.singularity.isFocused()
): number {
  if (skills.length === 0) return 0
  let total = 0
  for (const skill of skills) {
    total += combatGymExpPerSecond(ns, skill, focus) ?? 0
  }
  return total / skills.length
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

  // Estimate remaining time from current progress (not full-level time)
  let estimate: number | null = null
  try {
    const player = ns.getPlayer()
    const skill = SKILL_BY_GYM[gymType as CombatGymSkill]
    const mult = getCombatSkillLevelMult(ns, gymType as CombatGymSkill)
    const level = ns.formulas.skills.calculateSkill(player.exp[skill], mult)
    const expRemaining = ns.formulas.skills.calculateExp(level + 1, mult) - player.exp[skill]
    if (expRemaining > 0) {
      const gains = ns.formulas.work.gymGains(player, gymType, GYM_NAME)
      const expPerCycle = gains[EXP_GAIN_BY_GYM[gymType as CombatGymSkill]] * focusMultiplier(focus)
      if (expPerCycle > 0) {
        estimate = (expRemaining / expPerCycle) * MILLI_PER_CYCLE
      }
    }
  } catch {
    // use polling fallback
  }

  if (estimate != null && estimate > 0) {
    await ns.sleep(Math.max(0, estimate - MILLI_PER_CYCLE))
  }

  while (getCombatSkillLevel(ns, gymType) === startLevel) {
    await ns.sleep(LEVEL_POLL_MS)
  }
}
