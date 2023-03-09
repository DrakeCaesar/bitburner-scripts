import { NS } from "@ns"

export async function main(ns: NS): Promise<void> {
   for (;;) {
      const focus = ns.singularity.isFocused()
      const exp = ns.getPlayer().exp
      const skillOrder = [
         { name: "Agility", value: exp.agility },
         { name: "Dexterity", value: exp.dexterity },
         { name: "Defense", value: exp.defense },
         { name: "Strength", value: exp.strength },
      ]
      ns.getPlayer().skills
      const minSkill = skillOrder.reduce((prev, curr) =>
         prev.value < curr.value ? prev : curr
      )
      ns.singularity.gymWorkout("powerhouse gym", minSkill.name, focus)
      await ns.sleep(250)
   }
}
