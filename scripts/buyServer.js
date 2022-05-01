/** @param {import("..").NS } ns */
export async function main(ns) {
    let node = "node00"
    let target = "n00dles"
    let maxRam = ns.getPurchasedServerMaxRam()
    let maxCost = ns.getPurchasedServerCost(maxRam)
    let firstIteration = true
    for (;;) {
        let money = Math.floor(ns.getPlayer().money)
        let current
        let future = 1
        let cost = ns.getPurchasedServerCost(future)
        while (future < ns.getPurchasedServerMaxRam() && cost * 2 < money) {
            future = future * 2
            cost = ns.getPurchasedServerCost(future)
        }
        if (ns.serverExists(node)) {
            await ns.scp(
                [
                    "/hacking/hack.js",
                    "/hacking/grow.js",
                    "/hacking/weaken.js",
                    "/hacking/autoHackParallel.js",
                    "/data/" + target + ".txt",
                ],
                node
            )
            ns.exec("/hacking/autoHackParallel.js", node, 1, target)
            current = ns.getServerMaxRam(node)
        } else {
            current = 0
        }

        if (firstIteration) {
            ns.tprint("current ram: " + format(current))
            ns.tprint("next ram:    " + format(Math.min(current * 2, maxRam)))
            ns.tprint("max ram:     " + format(maxRam))
            ns.tprint("")

            ns.tprint(
                "cost:        " +
                    format(
                        Math.min(
                            ns.getPurchasedServerCost(current * 2),
                            maxCost
                        )
                    )
            )
            ns.tprint("money:       " + format(money))
            ns.tprint("max cost:    " + format(maxCost))
            ns.tprint("")
            firstIteration = false
        }

        if (money >= cost && future > current && cost * 2 > money) {
            if (ns.serverExists(node)) {
                ns.killall(node)
                ns.deleteServer(node)
            }

            ns.purchaseServer(node, future)

            await ns.scp(
                [
                    "/hacking/hack.js",
                    "/hacking/grow.js",
                    "/hacking/weaken.js",
                    "/hacking/autoHackParallel.js",
                    "/data/" + target + ".txt",
                ],
                node
            )
            ns.exec("/hacking/autoHackParallel.js", node, 1, target)

            ns.tprint("current ram: " + format(current))
            ns.tprint("bought ram:  " + format(future))
            ns.tprint("max ram:     " + format(maxRam))
            ns.tprint("")

            ns.tprint("money:       " + format(money))
            ns.tprint("cost:        " + format(cost))
            ns.tprint(
                "next cost:   " + (cost < maxCost ? format(cost * 2) : "none")
            )
            ns.tprint("max cost:    " + format(maxCost))

            if (future == ns.getPurchasedServerMaxRam()) {
                return
            }
            //ns.tprint("issue")
        }
        await ns.sleep(10000)
    }
}

function format(string) {
    return string
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, " ")
        .padStart(14)
}
