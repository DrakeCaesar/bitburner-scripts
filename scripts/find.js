

/** @param {import("..").NS } ns */
export function main(ns) {
    let knownservers = {"home":[]}
    crawl(ns, knownservers)
    if (ns.args.length == 0){
        ns.tprintf(JSON.stringify(knownservers, null, 2))
        ns.tprint("servers: " + Object.keys(knownservers).length)
    }
    else{
        ns.args.forEach(key => {
            //var connectString = ns.tprintf(JSON.stringify(knownservers[key], null, 2))
            var connectString = "home; "
            knownservers[key].forEach(hop => {
                connectString += "connect " + hop +"; "
            });
            navigator.clipboard.writeText(connectString)
            ns.tprint(connectString)
        })
    }
    //ns.tprint(knownservers)
}

/** @param {import("..").NS } ns */
export function crawl(ns, knownservers, hostname, depth = 0, path = new Array){
    let servers = ns.scan(hostname)
    for (const element of servers) {
        
        if (!(element in knownservers)) {
            knownservers[element] = path.concat([element])
            crawl(ns, knownservers, element, depth + 1, path.concat([element]))
        }
    }
}
