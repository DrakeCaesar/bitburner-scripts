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
        "\nmoney         " +
            ((moneyCur / moneyMax) * 100).toFixed(2) +
            "%" +
            "\nmoney         " +
            (moneyMax * (1 - proc) * (1 - monT)).toFixed(0) +
            " <= " +
            moneyCur.toFixed(0) +
            " <= " +
            (moneyMax * (1 - proc) * (1 + monT)).toFixed(0) +
            "\nsecurity      " +
            securityMin.toFixed(2) +
            " + " +
            (securityCur - securityMin).toFixed(2) +
            " = " +
            securityCur.toFixed(2) +
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
    const threads = Math.floor(
        ns.hackAnalyzeThreads(target, server.moneyMax * proc)
    )
    const security = threads * 0.002
    const weakenThreads = Math.ceil(security / 0.05)

    return {
        threads: threads,
        time: ns.getHackTime(target),
        security: security,
        weakenThreads: weakenThreads,
        weakenTime: ns.getWeakenTime(target),
    }
}

/** @param {import("../..").NS } ns */
export function getGrowProp(ns, target, proc) {
    let server = ns.getServer(target)

    if (
        server.baseDifficulty != server.hackDifficulty ||
        server.moneyAvailable > server.moneyMax * (1 - proc) * 1.2 ||
        server.moneyAvailable < (server.moneyMax * (1 - proc)) / 1.2
    ) {
        return null
    }
    const threads = Math.ceil(ns.growthAnalyze(target, 1 / (1 - proc)))
    const security = threads * 0.004
    const weakenThreads = Math.ceil(security / 0.05)

    return {
        threads: threads,
        time: ns.getGrowTime(target),
        security: security,
        weakenThreads: weakenThreads,
        weakenTime: ns.getWeakenTime(target),
    }
}

/** @param {import("../..").NS } ns */

export async function normalize(ns, target, proc) {
    let growProp
    let hackProp

    do {
        growProp ??= getGrowProp(ns, target, proc)
        hackProp ??= getHackProp(ns, target, proc)

        if (growProp != null && hackProp == null) {
            let growPid = ns.run("/hacking/grow.js", growProp.threads)
            let weakPid = ns.run("/hacking/weaken.js", growProp.weakenThreads)
            await ns.sleep(growProp.weakenTime)
            while (
                ns.getRunningScript(growPid) != null ||
                ns.getRunningScript(weakPid) != null
            ) {
                await ns.sleep(100)
            }
        } else if (hackProp != null && growProp == null) {
            let hackPid = ns.run("/hacking/hack.js", hackProp.threads)
            let weakPid = ns.run("/hacking/weaken.js", hackProp.weakenThreads)
            await ns.sleep(hackProp.weakenTime)
            while (
                ns.getRunningScript(hackPid) != null ||
                ns.getRunningScript(weakPid) != null
            ) {
                await ns.sleep(100)
            }
        } else {
            let threads = Math.ceil(ns.growthAnalyze(target, 1 / (1 - proc)))
            if (threads == Infinity) {
                threads = 10000
            }
            let security =
                threads * 0.004 +
                ns.getServerSecurityLevel(target) -
                ns.getServerMinSecurityLevel(target)
            let weakenThreads = Math.ceil(security / 0.05)
            let growPid = ns.run("/hacking/grow.js", threads)
            let weakPid = ns.run("/hacking/weaken.js", weakenThreads)
            await ns.sleep(growProp.weakenTime)
            while (
                ns.getRunningScript(growPid) != null ||
                ns.getRunningScript(weakPid) != null
            ) {
                await ns.sleep(100)
            }
        }
    } while (growProp != null && hackProp != null)
}

/** @param {import("../..").NS } ns */
