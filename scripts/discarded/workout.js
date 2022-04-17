/** @param {import("../..").NS } ns */
export async function main(ns) {
    while (true) {
        let p = ns.getPlayer();
        if (p.strength < p.defense && p.strength < p.dexterity && p.strength < p.agility) {
            ns.gymWorkout('powerhouse gym', 'Strength');
        } else if (p.defense < p.dexterity && p.defense < p.agility) {
            ns.gymWorkout('powerhouse gym', 'Defense');
        } else if (p.dexterity < p.agility) {
            ns.gymWorkout('powerhouse gym', 'Dexterity');
        } else {
            ns.gymWorkout('powerhouse gym', 'Agility')
        }
        await ns.sleep(100);
        ns.stopAction()
    }
}