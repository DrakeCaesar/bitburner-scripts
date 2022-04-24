/** @param {import("..").NS } ns */
export async function main(ns, copy = false) {
    let knownServers = new Array()
    crawl(ns, knownServers)

    var assortedServers = []
    for (const key of knownServers) {
        let level = ns.getServerRequiredHackingLevel(key)
        if (key != "home" && !key.includes("node")) {
            assortedServers.push([key, level])
        }
    }
    assortedServers.sort(function (first, second) {
        return first[1] - second[1]
    })

    // eslint-disable-next-line no-unused-vars
    for (const [hostname, level] of assortedServers) {
        let list = ns.ls(hostname)
        let listCCT = ns.ls(hostname, ".cct")
        if (copy) {
            let listLIT = ns.ls(hostname, ".lit")
            if (listLIT.length) {
                await ns.scp("copyHome.js", hostname)
                let pid = ns.exec("copyHome.js", hostname)
                while (ns.isRunning(pid)) {
                    await ns.sleep(10)
                }
                ns.rm("copyHome.js", hostname)
            }
        }

        var listStrange = []
        for (const file of list) {
            if (!file.includes(".lit") && !file.includes(".cct")) {
                listStrange.push(file)
            }
        }

        if (listCCT.length) {
            ns.tprint(hostname + ":")
            for (const file of listCCT) {
                ns.tprint("    " + file)
            }
            ns.tprint("")
        }

        if (listStrange.length) {
            ns.tprint("STRANGE: " + hostname + ":")
            for (const file of listStrange) {
                ns.tprint("    " + file)
            }
            ns.tprint("")
        }
    }
}

/** @param {import("..").NS } ns */
export function crawl(ns, knownServers, hostname, depth = 0) {
    let servers = ns.scan(hostname)
    for (const element of servers) {
        if (!knownServers.includes(element)) {
            knownServers.push(element)
            crawl(ns, knownServers, element, depth + 1)
        }
    }
}
