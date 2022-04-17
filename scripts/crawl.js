/** @param {import("..").NS } ns */
export function main(ns) {
    let knownservers = new Array
    crawl(ns, knownservers)
    ns.tprint("servers: " + knownservers.length)
    ns.tprint(knownservers)
}

/** @param {import("..").NS } ns */
export function crawl(ns, knownservers, hostname, depth = 0) {
    let servers = ns.scan(hostname)
    for (const element of servers) {
        if (!knownservers.includes(element)) {
            knownservers.push(element);
            crawl(ns, knownservers, element, depth + 1)
        }
    }
}