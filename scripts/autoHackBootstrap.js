/** @param {import("..").NS } ns */
export function main(ns) {
    let knownServers = new Array
    crawl(ns, knownServers)
    knownServers.sort();
    let paddingServers = 0
    let paddingLevels = 0
    for (const key of knownServers) {

        paddingServers = Math.max(key.length, paddingServers)

        paddingLevels = Math.max(String(ns.getServerRequiredHackingLevel(key)).length, paddingLevels)

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
            key != "n00dles" &&


            !(key.includes("node"))) {
            items.push([key, level])
        }
    }
    items.sort(function (first, second) {
        return first[1] - second[1];
    });

    for (const [server, level] of items) {
        /*
        ns.tprint(
            "server: " + 
            server.padEnd(paddingServers,' ') + 
            "    level: " + 
            String(level).padStart(paddingLevels,' ') 
        )
        if (!(ns.run("autoHack.js", 1 , server))){
            ns.tprint("error " + server)
        }
        */

        ns.run("autoHack.js", 1, server)

    }
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