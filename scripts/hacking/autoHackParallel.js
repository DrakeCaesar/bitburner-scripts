/** @param {import("../..").NS } ns */
export async function main(ns) {
    ns.disableLog("ALL")
    let target = ns.args[0]
    let proc = 0.6
    let playerLevel = ns.getPlayer().hacking
    let oldPlayerLevel = playerLevel
    let updateHack = false
    let updateGrow = false
    let paramsString = ns.read("/data/" + target + ".txt")
    let params
    if (paramsString) {
        //ns.tprint("test: " + paramsString)
        params = JSON.parse(paramsString)
        oldPlayerLevel = params.oldPlayerLevel
    } else {
        params = await getLoopParams(ns, target, proc)
    }
    //ns.tprint(JSON.stringify(params, null, 4))
    for (let id = Math.floor(Math.random() * 1000000000) * 4 + 1; ; id++) {
        playerLevel = ns.getPlayer().hacking
        if (playerLevel > oldPlayerLevel) {
            updateHack = true
            updateGrow = true
            oldPlayerLevel = playerLevel
        }
        if (updateHack || updateGrow) {
            let tempHack = getHack(ns, target, proc)
            let tempGrow = getGrow(ns, target, proc)
            if (tempHack) {
                params.hack = tempHack
                params = await getParams(ns, target, params)
                updateHack = false
            }
            if (tempGrow) {
                params.grow = tempGrow
                params = await getParams(ns, target, params)
                updateGrow = false
            }
        }

        if (id % 4 == 1) {
            await hack(ns, target, params, id)
        } else if (id % 4 == 3) {
            await grow(ns, target, params, id)
        } else {
            await weaken(ns, target, params, id)
        }
    }
}

/** @param {import("../..").NS } ns */
export async function hack(ns, target, params, id) {
    ns.run(
        "/hacking/hack.js",
        params.hack.threads,
        target,
        params.hack.time,
        id,
        true
    )
    await ns.sleep(params.interval.adjustedMargin)
}
/** @param {import("../..").NS } ns */
export async function grow(ns, target, params, id) {
    ns.run(
        "/hacking/grow.js",
        params.grow.threads,
        target,
        params.grow.time,
        id,
        true
    )
    await ns.sleep(params.interval.adjustedMargin)
}
/** @param {import("../..").NS } ns */
export async function weaken(ns, target, params, id) {
    while (
        ns.getServerSecurityLevel(target) !=
        ns.getServerMinSecurityLevel(target)
    ) {
        await ns.sleep(params.interval.adjustedMargin / 10)
    }
    ns.run(
        "/hacking/weaken.js",
        id % 4 == 2 ? params.hack.threads : params.grow.threads,
        target,
        id
    )
    await ns.sleep(params.interval.adjustedMargin)
}

/** @param {import("../..").NS } ns */
export function getHack(ns, target, proc) {
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
        time: ns.getWeakenTime(target) - ns.getHackTime(target),
        security: security,
        weakenThreads,
        weakenTime: ns.getWeakenTime(target),
    }
}

/** @param {import("../..").NS } ns */
export function getGrow(ns, target, proc) {
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
        time: ns.getWeakenTime(target) - ns.getGrowTime(target),
        security: security,
        weakenThreads: weakenThreads,
        weakenTime: ns.getWeakenTime(target),
    }
}

/** @param {import("../..").NS } ns */
export async function getParams(ns, target, params) {
    const maxRam =
        ns.getServerMaxRam(ns.getHostname()) * 1 -
        ns.getScriptRam("/hacking/autoHackParallel.js")
    const loopRam =
        params.hack.weakenThreads * ns.getScriptRam("/hacking/weaken.js") +
        params.grow.weakenThreads * ns.getScriptRam("/hacking/weaken.js") +
        params.hack.threads * ns.getScriptRam("/hacking/hack.js") +
        params.grow.threads * ns.getScriptRam("/hacking/grow.js")
    const instances = maxRam / loopRam
    const margin = params.hack.weakenTime / instances / 4
    const safeMargin = 25
    const adjustedMargin = Math.max(margin, safeMargin)
    const level = ns.getPlayer().hacking
    //const adjustedMargin = margin
    params.interval = {
        target: target,
        level: level,
        margin: margin,
        safeMargin: safeMargin,
        adjustedMargin: adjustedMargin,
    }
    await ns.write(
        "/data/" + params.interval.target + ".txt",
        JSON.stringify(params, null, 4),
        "w"
    )
    await ns.scp("/data/" + params.interval.target + ".txt", "home")

    return params
}

/** @param {import("../..").NS } ns */
export async function getLoopParams(ns, target, proc) {
    let grow = getGrow(ns, target, proc)
    let hack = getHack(ns, target, proc)
    let actionPid
    let weakenPid
    while (!grow || !hack) {
        if (!hack && !grow) {
            let threads = Math.min(
                Math.ceil(ns.growthAnalyze(target, 1 / (1 - proc))),
                Math.ceil(ns.getServerMaxRam(ns.getHostname()) / 4)
            )
            /*
            let security =
                threads * 0.004 +
                ns.getServerSecurityLevel(target) -
                ns.getServerMinSecurityLevel(target)
            let weakenThreads = Math.min(
                Math.ceil((security / 0.05) * 1.25),
                Math.ceil(ns.getServerMaxRam(ns.getHostname()) / 4)
            )
            */
            let weakenThreads = Math.ceil(
                ns.getServerMaxRam(ns.getHostname()) / 4
            )
            let weakenTime = ns.getWeakenTime(target)
            actionPid = ns.run("/hacking/grow.js", threads, target)
            weakenPid = ns.run("/hacking/weaken.js", weakenThreads, target)
            await ns.sleep(weakenTime)
        } else if (grow) {
            actionPid = ns.run("/hacking/grow.js", grow.threads, target)
            weakenPid = ns.run("/hacking/weaken.js", grow.weakenThreads, target)
            await ns.sleep(grow.weakenTime)
        } else if (hack) {
            actionPid = ns.run("/hacking/hack.js", hack.threads, target)
            weakenPid = ns.run("/hacking/weaken.js", hack.weakenThreads, target)
            await ns.sleep(hack.weakenTime)
        }
        while (
            ns.getRunningScript(actionPid) ||
            ns.getRunningScript(weakenPid)
        ) {
            await ns.sleep(100)
        }
        grow ??= getGrow(ns, target, proc)
        hack ??= getHack(ns, target, proc)
    }

    return await getParams(ns, target, { hack: hack, grow: grow })
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
