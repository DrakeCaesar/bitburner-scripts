/** @param {import("..").NS } ns */
export async function main(ns) {
    while (true) {
        ns.run("autoNuke.js")
        let target = ns.args[0]
        await ns.scp("hack.js", target)
        await ns.scp("grow.js", target)
        await ns.scp("weaken.js", target)
        await ns.scp("autoHack.js", target)
        await ns.scp("autoHackBootstrap.js", target)
        ns.exec("autoHackBootstrap.js", target)
        await ns.sleep(60000)
    }
}