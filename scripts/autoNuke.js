/** @param {import("..").NS } ns */
export function main(ns) {
    let knownServers = new Array
    crawl(ns, knownServers)
    knownServers.sort();
    let paddingServers = 0
    let paddingLevels = 0
    for (const key of knownServers) {
        let playerLevel = ns.getPlayer().hacking;
        let serverLevel = ns.getServerRequiredHackingLevel(key);
        if (serverLevel <= playerLevel) {
            paddingServers = Math.max(key.length, paddingServers)

            paddingLevels = Math.max(String(ns.getServerRequiredHackingLevel(key)).length, paddingLevels)
        }

    }

    var items = []
    for (const key of knownServers) {
        items.push([key, ns.getServerRequiredHackingLevel(key)])
    }
    items.sort(function (first, second) {
        return first[1] - second[1];
    });

    for (const [server, level] of items) {
        let player = ns.getPlayer();
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
        if (ns.fileExists("NUKE.exe", "home") && level <= player.hacking && ns.getServerNumPortsRequired(server) <= numPortsOpen) {
            /*
            ns.tprint(
                "server: " + 
                server.padEnd(paddingServers,' ') + 
                "    level: " + 
                String(level).padStart(paddingLevels,' ') +
                " <= " + 
                player.hacking +
                "    ports: " +
                ns.getServerNumPortsRequired(server) +
                " <= " + 
                numPortsOpen
                )
            */
            //ns.tprint(server +"\t level" + level + " is lower than player hacking level of " + player.hacking + ", executing nuke")
            ns.nuke(server)
        }

    }


    for (const [server, level] of items) {
        //ns.tprint( server.padEnd(paddingServers,' ') + " " + String(level).padStart(paddingLevels,' '))
    }

    //ns.tprint(items);
}

/** @param {import("..").NS } ns */
export function crawl(ns, knownServers, hostname, depth = 0) {
    let servers = ns.scan(hostname)
    for (const element of servers) {
        if (!knownServers.includes(element)) {
            knownServers.push(element);
            crawl(ns, knownServers, element, depth + 1)
        }
    }
}