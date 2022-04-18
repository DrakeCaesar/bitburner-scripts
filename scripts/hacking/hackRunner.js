/** @param {import("..").NS } ns */
export async function main(ns) {
    ns.disableLog("ALL")
    await ns.sleep(ns.args[2])
    ns.run("/hacking/hack.js", ns.args[0], ns.args[1], ns.args[3])
}