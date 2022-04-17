/** @param {import("..").NS } ns */
export function main(ns) {
    let knownServers = {
        "home": []
    }
    crawl(ns, knownServers)
    if (ns.args.length == 0) {
        ns.tprintf(JSON.stringify(knownServers, null, 2))
        ns.tprint("servers: " + Object.keys(knownServers).length)
    } else {
        var keys = Object.keys(knownServers);
        keys.sort();
        for (const key of keys) {
            for (const arg of ns.args) {
                if (key.toLowerCase().includes(arg.toLowerCase())) {
                    var connectString = "home; "
                    for (const hop of knownServers[key]) {
                        connectString += "connect " + hop + "; "
                    }
                    navigator.clipboard.writeText(connectString)
                    ns.tprint("")
                    ns.tprint(key + ":")
                    ns.tprint(connectString)
                }
            }
        }
    }
}

/** @param {import("..").NS } ns */
export function crawl(ns, knownServers, hostname, depth = 0, path = new Array) {
    let servers = ns.scan(hostname)
    for (const element of servers) {

        if (!(element in knownServers)) {
            knownServers[element] = path.concat([element])
            crawl(ns, knownServers, element, depth + 1, path.concat([element]))
        }
    }
}