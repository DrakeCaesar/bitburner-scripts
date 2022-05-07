/** @param {import("..").NS } ns */
export async function main(ns) {
    let node = ns.args[0]
    let target = ns.args[1]
    let maxRam = ns.getPurchasedServerMaxRam()
    let maxCost = ns.getPurchasedServerCost(maxRam)
    let printState = true
    for (;;) {
        let money = Math.floor(ns.getPlayer().money)
        let cost
        let future
        for (
            future = 1;
            future <= ns.getPurchasedServerMaxRam() &&
            ns.getPurchasedServerCost(future * 2) < money;
            future *= 2
        ) {
            cost = ns.getPurchasedServerCost(future)
        }

        let current = 0
        if (ns.serverExists(node)) current = ns.getServerMaxRam(node)

        if (money >= cost && future > current) {
            printState = true
            if (ns.serverExists(node)) {
                ns.killall(node)
                ns.deleteServer(node)
            }

            ns.purchaseServer(node, future)
        }

        if (ns.serverExists(node)) {
            await ns.scp(
                [
                    "/hacking/hack.js",
                    "/hacking/grow.js",
                    "/hacking/weaken.js",
                    "/hacking/autoHackParallel.js",
                    "autoHack.js",
                    "/data/" + target + ".txt",
                ],
                node
            )
            ns.exec("/hacking/autoHackParallel.js", "home", 1, node, target)
            //ns.exec("autoHack.js", node, 1, target)
        }

        if (printState) {
            printState = false

            ns.tprint("current ram: " + format(current))
            ns.tprint("next ram:    " + format(future))
            ns.tprint("max ram:     " + format(maxRam))
            ns.tprint("")

            ns.tprint(
                "cost:        " +
                    format(Math.min(ns.getPurchasedServerCost(future), maxCost))
            )
            ns.tprint("money:       " + format(money))
            ns.tprint("max cost:    " + format(maxCost))
            ns.tprint("")

            ns.tprint("money: " + money)
            ns.tprint("cost: " + cost)
            ns.tprint("future: " + future)
            ns.tprint("current: " + current)
        }
        await ns.sleep(10000)
    }
}

function format(string) {
    return Math.floor(string)
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, " ")
        .padStart(16)
}
