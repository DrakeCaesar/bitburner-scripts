/** @param {import("..").NS } ns */
export function main(ns) {
    let knownServers = new Array()
    crawl(ns, knownServers)
    knownServers.sort()
    let paddingServers = 0
    let paddinglevels = 0
    for (const key of knownServers) {
        paddingServers = Math.max(key.length, paddingServers)

        paddinglevels = Math.max(
            String(ns.getServerRequiredHackingLevel(key)).length,
            paddinglevels
        )
    }

    var items = []
    for (const key of knownServers) {
        if (!key.includes("node")) {
            items.push([key, ns.getServerRequiredHackingLevel(key)])
        }
    }
    items.sort(function (first, second) {
        return first[1] - second[1]
    })

    for (const [target, level] of items) {
        let player = ns.getPlayer()
        let server = ns.getServer(target)
        ns.tprint(
            target.padEnd(paddingServers, " ") +
                "    LVL: " +
                String(level).padStart(paddinglevels, " ") +
                (level <= player.hacking ? " <= " : " >> ") +
                player.hacking +
                (server.hasAdminRights ? "  ROOT" : "      ") +
                "  SEC: " +
                (server.hackDifficulty - server.minDifficulty)
                    .toFixed(2)
                    .padStart(8) +
                "  MEM: " +
                String(server.maxRam).padEnd(8) +
                "    TIM: " +
                ns.tFormat(ns.getWeakenTime(target)).padEnd(30)
        )
        let numPortsOpen = 0
        if (ns.fileExists("BruteSSH.exe", "home")) {
            ns.brutessh(target)
            ++numPortsOpen
        }
        if (ns.fileExists("FTPCrack.exe", "home")) {
            ns.ftpcrack(target)
            ++numPortsOpen
        }
        if (ns.fileExists("relaySMTP.exe", "home")) {
            ns.relaysmtp(target)
            ++numPortsOpen
        }
        if (ns.fileExists("relaySMTP.exe", "home")) {
            ns.relaysmtp(target)
            ++numPortsOpen
        }
        if (ns.fileExists("HTTPWorm.exe", "home")) {
            ns.httpworm(target)
            ++numPortsOpen
        }
        if (ns.fileExists("SQLInject.exe", "home")) {
            ns.sqlinject(target)
            ++numPortsOpen
        }
        if (
            ns.fileExists("NUKE.exe", "home") &&
            level <= player.hacking &&
            ns.getServerNumPortsRequired(target) <= numPortsOpen
        ) {
            ns.nuke(target)
        }
    }

    //ns.tprint(items);
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
