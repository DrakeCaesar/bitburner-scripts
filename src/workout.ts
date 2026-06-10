import { CityName, GymType, NS } from "@ns"

const SECTOR_12: CityName = "Sector-12"
const SKILL_GAP_TRAVEL_THRESHOLD = 100
const MIN_TRAVEL_MONEY = 100_000_000
const TRAVEL_COOLDOWN_MS = 60_000

export async function main(ns: NS): Promise<void> {
  let lastTravelAt = 0
  // Define the preferred order for tie-breakers
  const orderPreference: Record<string, number> = {
    str: 0,
    def: 1,
    dex: 2,
    agi: 3,
  }

  while (true) {
    const focus = ns.singularity.isFocused()
    const player = ns.getPlayer()

    // Build an array of skills with their levels
    const skills = [
      { name: "agi", value: player.skills.agility },
      { name: "dex", value: player.skills.dexterity },
      { name: "def", value: player.skills.defense },
      { name: "str", value: player.skills.strength },
    ]

    // Use reduce to find the skill with the lowest level,
    // and if equal, use the preferred order.
    const lowestSkill = skills.reduce((min, skill) => {
      if (skill.value < min.value) {
        return skill
      } else if (skill.value === min.value && orderPreference[skill.name] < orderPreference[min.name]) {
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

    ns.singularity.gymWorkout("Powerhouse Gym", lowestSkill.name as GymType, focus)
    await ns.sleep(250)
  }
}
