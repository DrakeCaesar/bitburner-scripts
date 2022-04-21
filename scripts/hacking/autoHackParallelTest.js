/** @param {import("../..").NS } ns */
export async function main(ns) {

    let target = ns.args[0]
    ns.tprint(target)





    let proc = 0.9
    let monT = 0.15



    let moneyMax = ns.getServerMaxMoney(target)
    let securityMin = ns.getServerMinSecurityLevel(target)

    let moneyCur = ns.getServerMoneyAvailable(target)
    let securityCur = ns.getServerSecurityLevel(target)



    ns.tprint("start")
    ns.tprint(
        "\nmoney         " + ((moneyCur / moneyMax) * 100).toFixed(2) + "%" +
        "\nmoney         " + (moneyMax * (1 - proc) * (1 - monT)).toFixed(0) + " <= " + moneyCur.toFixed(0) + " <= " + (moneyMax * (1 - proc) * (1 + monT)).toFixed(0) +
        "\nsecurity      " + (securityMin).toFixed(2) + " + " + (securityCur - securityMin).toFixed(2) + " = " + securityCur.toFixed(2) +
        "\n"
    )

}

/** @param {import("../..").NS } ns */
export function getHackProp(ns, target, proc) {
    let server = ns.getServer(target)

    if (
        server.moneyAvailable != server.moneyMax ||
        server.baseDifficulty != server.hackDifficulty
    ) {
        return null
    }
    const threads = Math.floor(ns.hackAnalyzeThreads(target, server.moneyMax * proc))
    const time = ns.getHackTime(target)
    const security = threads * 0.002
    const weakenThreads = Math.ceil(security / 0.05)

    return {
        "threads": threads,
        "time": time,
        "security": security,
        "weakenThreads": weakenThreads
    }



}

/** @param {import("../..").NS } ns */
export function getGrowProp(ns, target, proc) {
    let server = ns.getServer(target)

    if (
        server.baseDifficulty != server.hackDifficulty ||
        server.moneyAvailable > server.moneyMax * (1 - proc) * 1.2 ||
        server.moneyAvailable < server.moneyMax * (1 - proc) / 1.2
    ) {
        return null
    }
    const threads = Math.floor(ns(target, server.moneyMax * proc))
    const time = ns.getGrowTime(target)
    const security = threads * 0.004
    const weakenThreads = Math.ceil(security / 0.05)

    return {
        "threads": threads,
        "time": time,
        "security": security,
        "weakenThreads": weakenThreads
    }
}


export function normalize(ns, target, proc) {
    let growProp
    let hackProp

    do {
        growProp ??= getGrowProp(ns, target, proc)
        hackProp ??= getHackProp(ns, target, proc)

        if (growProp != null) {
            ns.print("out of Memory")

        }
    } while (growProp != null && hackProp != null)

}

/** @param {import("../..").NS } ns */