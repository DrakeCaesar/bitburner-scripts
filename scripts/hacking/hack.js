/** @param {import("../..").NS } ns
 * Execute hack after a timeout. */
export async function main(ns) {
    //args[0: target, 1: time before start, 2: consider security]
    ns.disableLog("ALL")

    if (ns.args[1]) {
        await ns.sleep(ns.args[1])
    }

    if (
        ns.args[3] &&
        ns.getServerSecurityLevel(ns.args[0]) >
            ns.getServerMinSecurityLevel(ns.args[0])
    ) {
        //ns.tprint("Server security before executing hack is too high")
        return
    }

    await ns.hack(ns.args[0])
}
