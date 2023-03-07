/** @param {import("../..").NS } ns */
export async function main(ns) {
   let node = ns.args[0]
   let target = ns.args[1]
   ns.killall(node)
   await ns.scp(
      [
         "/hacking/hack.js",
         "/hacking/grow.js",
         "/hacking/weaken.js",
         "/hacking/autoHackParallel.js",
      ],
      node
   )
   ns.exec("/hacking/autoHackParallel.js", node, 1, target)
}
