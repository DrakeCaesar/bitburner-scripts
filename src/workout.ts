import { CityName, GymType, NS } from "@ns"

const GYM = "Powerhouse Gym"
const SECTOR_12: CityName = "Sector-12"
const SKILL_GAP_TRAVEL_THRESHOLD = 100
const MIN_TRAVEL_MONEY = 100_000_000
const TRAVEL_COOLDOWN_MS = 60_000
const MILLI_PER_CYCLE = 200
const LEVEL_POLL_MS = 50

type SkillName = "str" | "def" | "dex" | "agi"
type CombatSkill = "strength" | "defense" | "dexterity" | "agility"
type CombatExp = "strExp" | "defExp" | "dexExp" | "agiExp"

const SKILL_BY_GYM: Record<SkillName, CombatSkill> = {
  str: "strength",
  def: "defense",
  dex: "dexterity",
  agi: "agility",
}

const EXP_GAIN_BY_GYM: Record<SkillName, CombatExp> = {
  str: "strExp",
  def: "defExp",
  dex: "dexExp",
  agi: "agiExp",
}

const ORDER_PREFERENCE: Record<SkillName, number> = {
  str: 0,
  def: 1,
  dex: 2,
  agi: 3,
}

function getCombatSkillLevel(ns: NS, gymType: GymType): number {
  return ns.getPlayer().skills[SKILL_BY_GYM[gymType as SkillName]]
}

function estimateMsToNextLevel(ns: NS, gymType: GymType): number | null {
  try {
    const player = ns.getPlayer()
    const skill = SKILL_BY_GYM[gymType as SkillName]
    const level = player.skills[skill]
    const mult = player.mults[skill]
    const expNeeded = ns.formulas.skills.calculateExp(level + 1, mult) - player.exp[skill]
    if (expNeeded <= 0) return 0

    const gains = ns.formulas.work.gymGains(player, gymType, GYM)
    const expPerCycle = gains[EXP_GAIN_BY_GYM[gymType as SkillName]]
    if (expPerCycle <= 0) return null

    return (expNeeded / expPerCycle) * MILLI_PER_CYCLE
  } catch {
    return null
  }
}

async function workoutUntilLevelUp(ns: NS, gymType: GymType, focus: boolean): Promise<void> {
  const startLevel = getCombatSkillLevel(ns, gymType)
  ns.singularity.gymWorkout(GYM, gymType, focus)

  const estimate = estimateMsToNextLevel(ns, gymType)
  if (estimate != null && estimate > 0) {
    await ns.sleep(Math.max(0, estimate - MILLI_PER_CYCLE))
  }

  while (getCombatSkillLevel(ns, gymType) === startLevel) {
    await ns.sleep(LEVEL_POLL_MS)
  }
}

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

    const skills: Array<{ name: SkillName; value: number }> = [
      { name: "agi", value: player.skills.agility },
      { name: "dex", value: player.skills.dexterity },
      { name: "def", value: player.skills.defense },
      { name: "str", value: player.skills.strength },
    ]

    const lowestSkill = skills.reduce((min, skill) => {
      if (skill.value < min.value) return skill
      if (skill.value === min.value && ORDER_PREFERENCE[skill.name] < ORDER_PREFERENCE[min.name]) {
        return skill
      }
      return min
    })

    const skillLevels = skills.map((skill) => skill.value)
    const skillGap = Math.max(...skillLevels) - Math.min(...skillLevels)
    const now = Date.now()
    if (
      skillGap >= SKILL_GAP_TRAVEL_THRESHOLD &&
      player.city !== SECTOR_12 &&
      player.money >= MIN_TRAVEL_MONEY &&
      now - lastTravelAt >= TRAVEL_COOLDOWN_MS
    ) {
      ns.singularity.travelToCity(SECTOR_12)
      lastTravelAt = now
      await ns.sleep(500)
    }

    await workoutUntilLevelUp(ns, lowestSkill.name, focus)
  }
}
