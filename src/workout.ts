import { NS } from ".."

export async function main(ns: NS): Promise<void> {
   for (;;) {
      const focus = ns.singularity.isFocused()
      const skills = ns.getPlayer().skills
      if (
         skills.agility < skills.dexterity &&
         skills.agility < skills.defense &&
         skills.agility < skills.strength
      ) {
         ns.singularity.gymWorkout("powerhouse gym", "Agility", focus)
      } else if (
         skills.dexterity < skills.defense &&
         skills.dexterity < skills.strength
      ) {
         ns.singularity.gymWorkout("powerhouse gym", "Dexterity", focus)
      } else if (skills.defense < skills.strength) {
         ns.singularity.gymWorkout("powerhouse gym", "Defense", focus)
      } else {
         ns.singularity.gymWorkout("powerhouse gym", "Strength", focus)
      }
      await ns.sleep(1000)
   }
}
