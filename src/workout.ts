import { GymType, NS } from "@ns"

export async function main(ns: NS): Promise<void> {
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

    ns.singularity.gymWorkout("Powerhouse Gym", lowestSkill.name as GymType, focus)
    await ns.sleep(250)
  }
}
