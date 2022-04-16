/** @param {import("..").NS } ns */
export function main(ns) {
    let knownservers = new Array
    crawl(ns, knownservers)
    knownservers.sort();
    let paddingservers = 0
    let paddinglevels = 0
    for (const key of knownservers) {
        let playerLevel = ns.getPlayer().hacking;
        let serverLevel = ns.getServerRequiredHackingLevel(key);
        if (serverLevel <= playerLevel){
            paddingservers = Math.max(key.length, paddingservers)

            paddinglevels = Math.max(String(ns.getServerRequiredHackingLevel(key)).length, paddinglevels)
        }

    }

    var items = []
    for (const key of knownservers) {
        items.push([key, ns.getServerRequiredHackingLevel(key)])
    }
    items.sort(function(first, second) {
        return first[1] - second[1];
    });

    for (const [server, level] of items) {
        let player = ns.getPlayer();
        let numPortsOpen = 0
        if (ns.fileExists("BruteSSH.exe", "home")){
            ns.brutessh(server)
            ++numPortsOpen
        }
        if (ns.fileExists("FTPCrack.exe", "home")){
            ns.ftpcrack(server)
            ++numPortsOpen
        }
        if (ns.fileExists("relaySMTP.exe", "home")){
            ns.relaysmtp(server)
            ++numPortsOpen
        }
        if (ns.fileExists("relaySMTP.exe", "home")){
            ns.relaysmtp(server)
            ++numPortsOpen
        }
        if (ns.fileExists("HTTPWorm.exe", "home")){
            ns.httpworm(server)
            ++numPortsOpen
        }
        if (ns.fileExists("SQLInject.exe", "home")){
            ns.sqlinject(server)
            ++numPortsOpen
        }
        if (ns.fileExists("NUKE.exe", "home") && level <= player.hacking && ns.getServerNumPortsRequired(server) <= numPortsOpen){
            ns.tprint(
                "server: " + 
                server.padEnd(paddingservers,' ') + 
                "    level: " + 
                String(level).padStart(paddinglevels,' ') +
                " <= " + 
                player.hacking +
                "    ports: " +
                ns.getServerNumPortsRequired(server) +
                " <= " + 
                numPortsOpen
                )
            //ns.tprint(server +"\t level" + level + " is lower than player hacking level of " + player.hacking + ", executing nuke")
            ns.nuke(server)
        }
            
    }


    for (const [server, level] of items) {
        //ns.tprint( server.padEnd(paddingservers,' ') + " " + String(level).padStart(paddinglevels,' '))
    }

    //ns.tprint(items);
}

/** @param {import("..").NS } ns */
export function crawl(ns, knownservers, hostname, depth = 0){
    let servers = ns.scan(hostname)
    for (const element of servers) {
        if (!knownservers.includes(element)) {
            knownservers.push(element);
            crawl(ns, knownservers, element, depth + 1)
        }
    }
}
