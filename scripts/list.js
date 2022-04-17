/** @param {import("..").NS } ns */
export function main(ns) {
    let knownServers = new Array
    crawl(ns, knownServers)
    knownServers.sort();
    let paddingServers = 0
    let paddinglevels = 0
    for (const key of knownServers) {

        paddingServers = Math.max(key.length, paddingServers)

        paddinglevels = Math.max(String(ns.getServerRequiredHackingLevel(key)).length, paddinglevels)

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
        ns.tprint(
            "server: " +
            server.padEnd(paddingServers, ' ') +
            "    level: " +
            String(level).padStart(paddinglevels, ' ') +
            ((level <= player.hacking) ? " <== " : "  >  ") +
            player.hacking
        )
        //ns.tprint(server +"\t level" + level + " is lower than player hacking level of " + player.hacking + ", executing nuke")
        ns.nuke(server)

    }


    for (const [server, level] of items) {
        //ns.tprint( server.padEnd(paddingServers,' ') + " " + String(level).padStart(paddinglevels,' '))
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