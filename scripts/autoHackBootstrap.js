/** @param {import("..").NS } ns */
export function main(ns) {
    let knownservers = new Array
    crawl(ns, knownservers)
    knownservers.sort();
    let paddingservers = 0
    let paddinglevels = 0
    for (const key of knownservers) {
        
            paddingservers = Math.max(key.length, paddingservers)

            paddinglevels = Math.max(String(ns.getServerRequiredHackingLevel(key)).length, paddinglevels)

    }

    var items = []
    for (const key of knownservers) {
        let level = ns.getServerRequiredHackingLevel(key)
        let playerLevel = ns.getPlayer().hacking
        if (
            level <= playerLevel && 
            key != "I.I.I.I"  && 
            key != "avmnite-02h" && 
            key != "CSEC" &&
            key != "darkweb" && 
            key != "home" && 
            key != "run4theh111z" &&

            !(key.includes("node"))){
            items.push([key, level])
        }
    }
    items.sort(function(first, second) {
        return first[1] - second[1];
    });

    for (const [server, level] of items) {
        /*
        ns.tprint(
            "server: " + 
            server.padEnd(paddingservers,' ') + 
            "    level: " + 
            String(level).padStart(paddinglevels,' ') 
        )
        if (!(ns.run("autoHack.js", 1 , server))){
            ns.tprint("error " + server)
        }
        */

        ns.run("autoHack.js", 1 , server)
        
    }
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
