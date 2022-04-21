/** @param {import("../..").NS } ns
 * Execute hack after a timeout. */
export async function main(ns) {
    //args[0: target, 1: timeout]
    ns.disableLog("ALL")

    if (ns.args.length >= 2 && ns.args[1] > 0) {
        await ns.sleep(ns.args[1])
    }

    if (
        ns.getServerSecurityLevel(ns.args[0]) >
        ns.getServerMinSecurityLevel(ns.args[0])
    ) {
        ns.tprint("Server security before executing hack is too high")
        return
    }

    await ns.hack(ns.args[0])
}
