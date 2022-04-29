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

    for (const [server, level] of items) {
        let player = ns.getPlayer()
        ns.tprint(
            "server: " +
                server.padEnd(paddingServers, " ") +
                "    level: " +
                String(level).padStart(paddinglevels, " ") +
                (level <= player.hacking ? " <= " : " >> ") +
                player.hacking +
                "    ram: " +
                String(ns.getServerMaxRam(server)).padEnd(6) +
                "    weaken: " +
                ns.tFormat(ns.getWeakenTime(server)).padEnd(30) +
                "    grow:   " +
                ns.tFormat(ns.getGrowTime(server)).padEnd(30) +
                "    hack:   " +
                ns.tFormat(ns.getHackTime(server)).padEnd(30)
        )
        let numPortsOpen = 0
        if (ns.fileExists("BruteSSH.exe", "home")) {
            ns.brutessh(server)
            ++numPortsOpen
        }
        if (ns.fileExists("FTPCrack.exe", "home")) {
            ns.ftpcrack(server)
            ++numPortsOpen
        }
        if (ns.fileExists("relaySMTP.exe", "home")) {
            ns.relaysmtp(server)
            ++numPortsOpen
        }
        if (ns.fileExists("relaySMTP.exe", "home")) {
            ns.relaysmtp(server)
            ++numPortsOpen
        }
        if (ns.fileExists("HTTPWorm.exe", "home")) {
            ns.httpworm(server)
            ++numPortsOpen
        }
        if (ns.fileExists("SQLInject.exe", "home")) {
            ns.sqlinject(server)
            ++numPortsOpen
        }
        if (
            ns.fileExists("NUKE.exe", "home") &&
            level <= player.hacking &&
            ns.getServerNumPortsRequired(server) <= numPortsOpen
        ) {
            ns.nuke(server)
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
