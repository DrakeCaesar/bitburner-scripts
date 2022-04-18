/** @param {import("..").NS } ns */
export async function main(ns) {
    ns.disableLog("ALL")
    if (ns.args.length >= 2 && ns.args[1] > 0) {
        await ns.sleep(ns.args[1])
    }
    await ns.grow(ns.args[0])
}