/** @param {import("..").NS } ns */
export async function main(ns) {
    let node = ns.args[0]
    let target = ns.args[1]
    ns.kill("/hacking/autoHackParallel.js", node, node, target)
    ns.killall(node)
    await ns.scp(
        [
            "/hacking/hack.js",
            "/hacking/grow.js",
            "/hacking/weaken.js",
            "/hacking/autoHackParallel.js",
            "/data/" + target + ".txt",
        ],
        node
    )
    ns.exec("/hacking/autoHackParallel.js", node, 1, node, target)
}
