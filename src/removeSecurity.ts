/** @param {import("..").NS } ns */
import { crawl } from "@/libraries/crawl.js"
export async function main(ns) {
  //ns.disableLog("ALL")
  let node = ns.args[0] || "home"
  await ns.scp("/hacking/weaken.js", node)
  const knownServers: Set<string> = new Set<string>()

  crawl(ns, knownServers)
  let paddingServers = 0
  let paddingLevels = 0
  for (const key of knownServers) {
    paddingServers = Math.max(key.length, paddingServers)

    paddingLevels = Math.max(String(ns.getServerRequiredHackingLevel(key)).length, paddingLevels)
  }
  for (;;) {
    var items = []
    for (const key of knownServers) {
      let level = ns.getServerRequiredHackingLevel(key)
      let playerLevel = ns.getPlayer().skills.hacking
      if (
        level <= playerLevel &&
        key != "." &&
        key != "avmnite-02h" &&
        key != "CSEC" &&
        key != "darkweb" &&
        key != "home" &&
        key != "I.I.I.I" &&
        key != "run4theh111z" &&
        key != "w0r1d_d43m0n" &&
        key != "The-Cave" &&
        !key.includes("node") &&
        ns.getServerMinSecurityLevel(key) != ns.getServerSecurityLevel(key)
      ) {
        items.push([key, level])
      }
    }
    items.sort(function (first, second) {
      return first[1] - second[1]
    })

    // eslint-disable-next-line no-unused-vars
    for (const [target, level] of items) {
      // ns.run("autoNuke.js")
      let security = ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target)
      let weakenThreads = Math.min(Math.ceil(security / 0.05), Math.floor(ns.getServerMaxRam(node) / 2))
      //ns.tprint(target)
      if (
        ns.hasRootAccess(target) &&
        weakenThreads > 0 &&
        security % 1 == 0 &&
        !ns.getRunningScript("/hacking/weaken.js", node, target) &&
        ns.exec("/hacking/weaken.js", node, weakenThreads, target)
      ) {
        ns.print(
          target.padEnd(18) +
            "level: " +
            String(level).padStart(5) +
            ns.getServerMinSecurityLevel(target).toFixed(2).padStart(6) +
            " + " +
            (ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target)).toFixed(2).padStart(6)
        )
      }
    }
    await ns.sleep(10000)
  }
}
