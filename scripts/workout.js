/** @param {import("..").NS } ns */
export async function main(ns) {
    for (;;) {
        const focus = ns.singularity.isFocused()
        const p = ns.getPlayer()
        if (
            p.agility < p.dexterity &&
            p.agility < p.defense &&
            p.agility < p.strength
        ) {
            ns.singularity.gymWorkout("powerhouse gym", "Agility", focus)
        } else if (p.dexterity < p.defense && p.dexterity < p.strength) {
            ns.singularity.gymWorkout("powerhouse gym", "Dexterity", focus)
        } else if (p.defense < p.strength) {
            ns.singularity.gymWorkout("powerhouse gym", "Defense", focus)
        } else {
            ns.singularity.gymWorkout("powerhouse gym", "Strength", focus)
        }
        await ns.sleep(1000)
    }
}
