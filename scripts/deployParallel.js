/** @param {import("..").NS } ns */
export async function main(ns) {
    let target = ns.args[0]
    ns.killall(target)
    await ns.scp("hack.js", target)
    await ns.scp("grow.js", target)
    await ns.scp("weaken.js", target)
    await ns.scp("autoHackParallel.js", target)
    ns.exec("autoHackParallel.js", target)
}