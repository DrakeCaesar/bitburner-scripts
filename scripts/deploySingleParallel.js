/** @param {import("..").NS } ns */
export async function main(ns) {
    let target = "n00dles"
    let node = "node00"
    await ns.scp([
        "/hacking/hack.js",
        "/hacking/hackRunner.js",
        "/hacking/grow.js",
        "/hacking/growRunner.js",
        "/hacking/weaken.js",
        "/hacking/autoHackParallel.js",
        "/hacking/autoHackParallelTest.js"
    ], node)
    ns.killall(node)
    //ns.exec("/hacking/autoHackParallel.js", node, 1, target)
    ns.exec("/hacking/autoHackParallelTest.js", node, 1, target)
}