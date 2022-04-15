

/** @param {import("..").NS } ns */
export async function main(ns) {
    let startTime = new Date();

    let knownservers = new Array
    await crawl(ns, knownservers)

    var endTime = new Date();
    let timeDiff = (endTime - startTime)/1000;
    ns.tprint("servers: " + knownservers.length + ", runtime: " + timeDiff +"s")
    ns.tprint(knownservers)
}

/** @param {import("..").NS } ns */
export async function crawl(ns, knownservers, hostname, depth = 0){
    await ns.sleep(1);
    let servers = ns.scan(hostname)
    for (const element of servers) {
        if (!knownservers.includes(element)) {
            knownservers.push(element);
            await crawl(ns, knownservers, element, depth + 1)
        }
        
    }
}