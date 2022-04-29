/** @param {import("..").NS } ns */
export async function main(ns) {
    ns.tprint("running")
    let money = Math.floor(ns.getPlayer().money)
    let target = "node00"
    for (let i = 1; i <= ns.getPurchasedServerMaxRam(); i = i * 2) {
        let cost = ns.getPurchasedServerCost(i)
        let maxCost = ns.getPurchasedServerCost(ns.getPurchasedServerMaxRam())
        if (
            (cost < money && cost * 2 > money) ||
            (i == ns.getPurchasedServerMaxRam() && cost < money)
        ) {
            ns.tprint(
                "cost:     " +
                    cost.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")
            )
            ns.tprint(
                "money:    " +
                    money.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")
            )
            ns.tprint(
                "max:      " +
                    maxCost.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")
            )
            let current
            if (ns.serverExists(target)) {
                current = ns.getServerMaxRam(target)
            } else {
                current = 0
            }
            let future = i

            ns.tprint("c:        " + current)
            ns.tprint("f:        " + future)
            if (future > current) {
                if (ns.serverExists(target)) {
                    ns.killall(target)
                    ns.deleteServer(target)
                }

                ns.purchaseServer(target, future)

                await ns.scp(
                    [
                        "/hacking/hack.js",
                        "/hacking/grow.js",
                        "/hacking/weaken.js",
                        "/hacking/autoHackParallel.js",
                        "/data/foodnstuff.txt",
                    ],
                    target
                )
                ns.exec("/hacking/autoHackParallel.js", target, 1, "foodnstuff")

                ns.tprint("purchased " + target)
                ns.tprint(
                    "for       " +
                        ns
                            .getPurchasedServerCost(future)
                            .toString()
                            .replace(/\B(?=(\d{3})+(?!\d))/g, " ")
                )
                return
            }
        }
        //ns.tprint("issue")
    }
}
