/** @param {import("..").NS } ns */
export async function main(ns) {
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

    var items = []
    for (const key of knownServers) {
        let level = ns.getServerRequiredHackingLevel(key)
        let playerLevel = ns.getPlayer().hacking
        if (
            level <= playerLevel &&
            key != "I.I.I.I" &&
            key != "avmnite-02h" &&
            key != "CSEC" &&
            key != "darkweb" &&
            key != "home" &&
            key != "run4theh111z" &&
            key != "." &&
            key != "n00dles" &&
            !key.includes("node")
        ) {
            items.push([key, level])
        }
    }
    items.sort(function (first, second) {
        return first[1] - second[1]
    })
    let i = 0
    for (const [target, level] of items) {
        let node = "node" + String(i).padStart(2, "0")
        i++

        if (node == "node25") {
            return
        }

        //ns.run("autoHack.js", 1, target)

        ns.tprint(
            "server: " +
                target.padEnd(paddingServers, " ") +
                "    level: " +
                String(level).padStart(paddingLevels, " ") +
                "  " +
                node
        )
        ns.killall(node)
        await ns.scp(
            [
                "/hacking/hack.js",
                "/hacking/hackRunner.js",
                "/hacking/grow.js",
                "/hacking/growRunner.js",
                "/hacking/weaken.js",
                "/hacking/autoHackParallel.js",
            ],
            node
        )
        //ns.killall(node)
        ns.exec("/hacking/autoHackParallel.js", node, 1, target)
    }
    ns.tprint("total hackable servers: " + items.length)
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
