/** @param {import("../..").NS } ns 

 * Execute grow after a timeout. */
export async function main(ns) {
    ns.disableLog("ALL")
    //args[0: target, 1: time before start]

    if (ns.args.length >= 2 && ns.args[1] > 0) {
        await ns.sleep(ns.args[1])
    }

    if (ns.getServerSecurityLevel(ns.args[0]) > ns.getServerMinSecurityLevel(ns.args[0])) {
        ns.print("Server security before executing grow is too high")
        return
    }

    await ns.grow(ns.args[0])
    /*
    if (await ns.grow(ns.args[0]) == 0) {
        ns.print("Server money after executing grow was not 100%")
    }
    */
}