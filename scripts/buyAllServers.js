/** @param {import("..").NS } ns */
export async function main(ns) {
    while (!ns.serverExists("node24")) {
        let future = ns.getPurchasedServerMaxRam()
        //future = 131072

        let cost = ns.getPurchasedServerCost(future)
        let money = ns.getPlayer().money
        let count = Math.floor(money / cost)
        //ns.tprint("cost: " + cost)
        //ns.tprint("# to buy: " + count)
        //ns.tprint("cost: " + ns.nFormat(cost, "($ 0.000 a)"))
        for (let i = 0; i < 25; ++i) {
            // eslint-disable-next-line quotes
            let target = "node" + String(i).padStart(2, "0")

            if (
                ns.serverExists(target) &&
                ns.getServerMaxRam(target) < future &&
                count > 0
            ) {
                ns.tprint(
                    target +
                        ": to buy " +
                        ns.getServerMaxRam(target) +
                        " < " +
                        future
                )
                count--
                ns.killall(target)
                ns.deleteServer(target)
                ns.purchaseServer(target, future)
            } else if (!ns.serverExists(target) && count > 0) {
                ns.tprint(target + ": to buy")
                count--
                ns.purchaseServer(target, future)
            }
        }
        await ns.sleep(10000)
    }
}
