/** @param {import("..").NS } ns */
export async function main(ns) {
    let money = ns.getPlayer().money;
    let target = "node00"
    for (let i = 1; i <= ns.getPurchasedServerMaxRam(); i = i * 2) {
        let cost = ns.getPurchasedServerCost(i)

        if (cost < money && cost > money / 2) {
            ns.tprint("RAM: " + i + " cost: " + cost.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " "))
            let current = ns.getServerMaxRam(target)
            let future = i
            ns.tprint("c: " + current)
            ns.tprint("f: " + future)
            if (future > current) {
                ns.killall(target)
                ns.deleteServer(target)
                ns.purchaseServer(target, future)
                ns.tprint("purchased " + future)
                return
            }
        }
    }

}