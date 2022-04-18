/** @param {import("..").NS } ns */
export async function main(ns) {
    let target = ns.args[0]
    ns.killall(target)
    await ns.scp([
        "/hacking/hack.js",
        "/hacking/hackRunner.js",
        "/hacking/grow.js",
        "/hacking/growRunner.js",
        "/hacking/weaken.js",
        "/hacking/autoHackParallel.js"
    ], target)
    ns.exec("/hacking/autoHackParallel.js", target)
}