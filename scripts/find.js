/** @param {import("..").NS } ns */
export function main(ns) {
    let knownServers = {
        home: [],
    }
    crawl(ns, knownServers)
    if (ns.args.length == 0) {
        ns.tprintf(JSON.stringify(knownServers, null, 4))
        ns.tprint("servers: " + Object.keys(knownServers).length)
    } else {
        var keys = Object.keys(knownServers)
        keys.sort()
        for (const key of keys) {
            for (const arg of ns.args) {
                if (key.toLowerCase().includes(arg.toLowerCase())) {
                    var connectString = "home;"
                    for (const hop of knownServers[key]) {
                        connectString += "connect " + hop + ";"
                    }

                    const terminalInput =
                        document.getElementById("terminal-input")
                    terminalInput.value = connectString
                    const handler = Object.keys(terminalInput)[1]
                    terminalInput[handler].onChange({ target: terminalInput })
                    terminalInput[handler].onKeyDown({
                        key: "Enter",
                        preventDefault: () => null,
                    })
                }
            }
        }
    }
}

/** @param {import("..").NS } ns */
export function crawl(
    ns,
    knownServers,
    hostname,
    depth = 0,
    path = new Array()
) {
    let servers = ns.scan(hostname)
    for (const element of servers) {
        if (!(element in knownServers)) {
            knownServers[element] = path.concat([element])
            crawl(ns, knownServers, element, depth + 1, path.concat([element]))
        }
    }
}
