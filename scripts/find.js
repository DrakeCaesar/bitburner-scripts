/** @param {import("..").NS } ns */
export function main(ns) {
    let knownservers = {"home":[]}
    crawl(ns, knownservers)
    if (ns.args.length == 0){
        ns.tprintf(JSON.stringify(knownservers, null, 2))
        ns.tprint("servers: " + Object.keys(knownservers).length)
    }
    else{
        var keys = Object.keys(knownservers); 
        keys.sort();
        for (const key of keys) {
            for (const arg of ns.args) {
                if (key.toLowerCase().includes(arg.toLowerCase())){
                    var connectString = "home; "
                    for (const hop of knownservers[key]) {
                        connectString += "connect " + hop +"; "
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
export function crawl(ns, knownservers, hostname, depth = 0, path = new Array){
    let servers = ns.scan(hostname)
    for (const element of servers) {
        
        if (!(element in knownservers)) {
            knownservers[element] = path.concat([element])
            crawl(ns, knownservers, element, depth + 1, path.concat([element]))
        }
    }
}
