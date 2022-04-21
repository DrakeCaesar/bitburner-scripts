/** @param {import("../..").NS } ns */
export async function main(ns) {
    let target = ns.args[0]
    ns.tprint(target)
    let proc = 0.9
    let params = await getLoopParams(ns, target, proc)
    ns.tprint(params)
}

/** @param {import("../..").NS } ns */
export function getHack(ns, target, proc) {
    ns.tprint("get hack")
    let server = ns.getServer(target)

    if (
        server.moneyAvailable != server.moneyMax ||
        server.minDifficulty != server.hackDifficulty
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
export function getGrow(ns, target, proc) {
    ns.tprint("get grow")

    let server = ns.getServer(target)

    if (
        server.minDifficulty != server.hackDifficulty ||
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
export async function getLoopParams(ns, target, proc) {
    let grow
    let hack
    do {
        serverStats(ns, target)
        grow ??= getGrow(ns, target, proc)
        ns.tprint(grow)

        hack ??= getHack(ns, target, proc)
        ns.tprint(hack)

        let actionPid
        let weakenPid
        if (grow != null && hack == null) {
            actionPid = ns.run("/hacking/grow.js", grow.threads, target)
            weakenPid = ns.run("/hacking/weaken.js", grow.weakenThreads, target)
            await ns.sleep(grow.weakenTime)
        } else if (hack != null && grow == null) {
            actionPid = ns.run("/hacking/hack.js", hack.threads, target)
            weakenPid = ns.run("/hacking/weaken.js", hack.weakenThreads, target)
            await ns.sleep(hack.weakenTime)
        } else if (hack == null && grow == null) {
            ns.tprint("normalize")

            let threads = Math.ceil(ns.growthAnalyze(target, 1 / (1 - proc)))
            if (threads == Infinity) {
                threads = ns.getServerMaxRam(ns.getHostname()) / 4
            }
            let security =
                threads * 0.004 +
                ns.getServerSecurityLevel(target) -
                ns.getServerMinSecurityLevel(target)
            let weakenThreads = Math.ceil(security / 0.05)
            let weakenTime = ns.getWeakenTime(target)
            actionPid = ns.run("/hacking/grow.js", threads, target)
            weakenPid = ns.run("/hacking/weaken.js", weakenThreads, target)
            await ns.sleep(weakenTime)
        }
        ns.tprint(actionPid)
        ns.tprint(weakenPid)
        ns.tprint("")

        while (
            ns.getRunningScript(actionPid) != null ||
            ns.getRunningScript(weakenPid) != null
        ) {
            await ns.sleep(100)
        }
    } while (grow == null || hack == null)
    ns.tprint("finished")

    return { grow: grow, hack: hack }
}

/** @param {import("../..").NS } ns */
export function serverStats(ns, target) {
    let server = ns.getServer(target)
    ns.tprint(
        "server security: " +
            (server.hackDifficulty - server.minDifficulty).toFixed(2)
    )

    ns.tprint(
        "server money:    " +
            ((server.moneyAvailable / server.moneyMax) * 100).toFixed(2) +
            "%"
    )
}
