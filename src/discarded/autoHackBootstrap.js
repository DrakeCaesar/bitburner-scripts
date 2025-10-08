/** @param {import("../../NetscriptDefinitions").NS } ns */
export async function main(ns) {
  //ns.disableLog("ALL")
  let knownServers = []
  crawl(ns, knownServers)
  knownServers.sort()
  let paddingServers = 0
  let paddingLevels = 0
  for (const key of knownServers) {
    paddingServers = Math.max(key.length, paddingServers)

    paddingLevels = Math.max(String(ns.getServerRequiredHackingLevel(key)).length, paddingLevels)
  }
  let hackingLevelUpperBound = Infinity
  if (ns.args.length > 0) {
    hackingLevelUpperBound = ns.args[0]
  }
  var items = []
  for (const key of knownServers) {
    let level = ns.getServerRequiredHackingLevel(key)
    let playerLevel = ns.getPlayer().skills.hacking
    if (
      level <= playerLevel &&
      level <= hackingLevelUpperBound &&
      key != "." &&
      key != "avmnite-02h" &&
      key != "CSEC" &&
      key != "darkweb" &&
      key != "home" &&
      key != "I.I.I.I" &&
      key != "run4theh111z" &&
      key != "The-Cave" &&
      //key != "n00dles" &&
      key != "w0r1d_d43m0n" &&
      key != "fulcrumassets" &&
      key != "megacorp" &&
      !key.includes("node")
    ) {
      items.push([key, level])
    }
  }
  items.sort(function (first, second) {
    return second[1] - first[1]
  })
  //await ns.killall()
  //ns.kill("/hacking/autoHackParallel.js", "home","home","fulcrumassets")
  //ns.run("/hacking/autoHackParallel.js", "home", 1, "home", "fulcrumassets")

  let i = 0
  for (const [target, level] of items) {
    let node = "node" + String(i).padStart(2, "0")
    i++

    if (!ns.serverExists(node)) {
      if (node == "node00") {
        node = "home"
      } else {
        break
      }
    }

    ns.tprint(
      "server: " +
        target.padEnd(paddingServers, " ") +
        "    level: " +
        String(level).padStart(paddingLevels, " ") +
        "  " +
        node
    )
    //ns.killall(node)
    //ns.kill("/hacking/autoHackParallel.js", "home", node, target)

    const list = ns.ls(node, "/data/")
    for (const file of list) {
      ns.rm(file, node)
    }
    ns.nuke(target)
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
    ns.exec("/hacking/autoHackParallel.js", "home", 1, node, target)
  }
  ns.tprint("total hackable servers: " + items.length)
}

/** @param {import("../../NetscriptDefinitions").NS } ns */
export function crawl(ns, knownServers, hostname, depth = 0) {
  let servers = ns.scan(hostname)
  for (const element of servers) {
    if (!knownServers.includes(element)) {
      knownServers.push(element)
      crawl(ns, knownServers, element, depth + 1)
    }
  }
}
