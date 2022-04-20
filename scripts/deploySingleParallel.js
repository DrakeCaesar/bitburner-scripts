/** @param {import("..").NS } ns */
export async function main(ns) {
    let target = "n00dles"
    let node = "node00"
    ns.killall(target)
    await ns.scp("hack.js", target)
    await ns.scp("grow.js", target)
    await ns.scp("weaken.js", target)
    await ns.scp("autoHack.js", target)
    await ns.scp("AutoHackParallelTest.js.js", target)
    ns.exec("autoHackParallelTest.js", target)
    
    await ns.scp([
        "/hacking/hack.js",
        "/hacking/hackRunner.js",
        "/hacking/grow.js",
        "/hacking/growRunner.js",
        "/hacking/weaken.js",
        "/hacking/autoHackParallelTest.js"
    ], node)
    ns.killall(node)
    ns.exec("/hacking/autoHackParallelTest.js", node, 1, target)
}

