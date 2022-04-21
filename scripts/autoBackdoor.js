/** @param {import("..").NS } ns */
export function main(ns) {
    let knownServers = {
        "home": []
    }
    crawl(ns, knownServers)



    var sortedItems = []
    for (const key of Object.keys(knownServers)) {
        let playerLevel = ns.getPlayer().hacking
        let serverLevel = ns.getServerRequiredHackingLevel(key)
        if (serverLevel <= playerLevel) {
            sortedItems.push([key, ns.getServerRequiredHackingLevel(key)])
        }

    }
    sortedItems.sort(function (first, second) {
        return first[1] - second[1]
    })
    var bigConnectString = "\n"
    for (const [arg] of sortedItems) {
        var connectString = "home; "
        for (const hop of knownServers[arg]) {
            connectString += "connect " + hop + "; "
        }
        connectString += "backdoor;\n"
        navigator.clipboard.writeText(connectString)
        //ns.tprint("")
        //ns.tprint(arg + ": " + ns.getServerRequiredHackingLevel(arg))
        bigConnectString += connectString
        //ns.tprint(connectString)
    }
    ns.tprint(bigConnectString)
    navigator.clipboard.writeText(bigConnectString)

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