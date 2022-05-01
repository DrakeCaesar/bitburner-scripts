/** @param {import("..").NS } ns */
export async function main(ns) {
    //ns.disableLog("ALL")
    let node = ns.args[0]
    await ns.scp("/hacking/weaken.js", node)
    let knownServers = new Array()
    crawl(ns, knownServers)
    knownServers.sort()
    let paddingServers = 0
    let paddingLevels = 0
    for (const key of knownServers) {
        paddingServers = Math.max(key.length, paddingServers)

        paddingLevels = Math.max(
            String(ns.getServerRequiredHackingLevel(key)).length,
            paddingLevels
        )
    }
    for (;;) {
        var items = []
        for (const key of knownServers) {
            let level = ns.getServerRequiredHackingLevel(key)
            let playerLevel = ns.getPlayer().hacking
            if (
                level <= playerLevel &&
                key != "." &&
                key != "avmnite-02h" &&
                key != "CSEC" &&
                //key != "darkweb" &&
                key != "home" &&
                key != "I.I.I.I" &&
                key != "run4theh111z" &&
                //key != "The-Cave" &&
                !key.includes("node") &&
                ns.getServerMinSecurityLevel(key) !=
                    ns.getServerSecurityLevel(key)
            ) {
                items.push([key, level])
            }
        }
        items.sort(function (first, second) {
            return first[1] - second[1]
        })

        // eslint-disable-next-line no-unused-vars
        for (const [target, level] of items) {
            ns.run("autoNuke.js")

            let security =
                ns.getServerSecurityLevel(target) -
                ns.getServerMinSecurityLevel(target)
            let weakenThreads = Math.min(
                Math.ceil(security / 0.05),
                Math.floor(ns.getServerMaxRam(node) / 2)
            )
            //ns.tprint(target)
            if (
                weakenThreads > 0 &&
                !ns.getRunningScript("/hacking/weaken.js", node, target) &&
                ns.exec("/hacking/weaken.js", node, weakenThreads, target)
            ) {
                ns.tprint(
                    target.padEnd(18) +
                        "level: " +
                        String(level).padStart(5) +
                        ns
                            .getServerMinSecurityLevel(target)
                            .toFixed(2)
                            .padStart(6) +
                        " + " +
                        (
                            ns.getServerSecurityLevel(target) -
                            ns.getServerMinSecurityLevel(target)
                        )
                            .toFixed(2)
                            .padStart(6)
                )
            }
        }
        await ns.sleep(10000)
    }
}

/** @param {import("..").NS } ns */
export function crawl(ns, knownServers, hostname, depth = 0) {
    let servers = ns.scan(hostname)
    for (const element of servers) {
        if (!knownServers.includes(element)) {
            knownServers.push(element)
            crawl(ns, knownServers, element, depth + 1)
        }
    }
}
