/** @param {import("../../NetscriptDefinitions").NS } ns */
export async function main(ns) {
  let knownServers = {
    home: [],
  }
  crawl(ns, knownServers)

  var sortedItems = []
  for (const key of Object.keys(knownServers)) {
    let playerLevel = ns.getPlayer().skills.hacking
    let serverLevel = ns.getServerRequiredHackingLevel(key)
    if (serverLevel <= playerLevel) {
      sortedItems.push([key, ns.getServerRequiredHackingLevel(key)])
    }
  }
  sortedItems.sort(function (first, second) {
    return first[1] - second[1]
  })
  var bigConnectString = "\n"
  for (const [arg] of sortedItems) {
    var connectString = "home; "
    for (const hop of knownServers[arg]) {
      connectString += "connect " + hop + "; "
    }
    connectString += "backdoor;\n"
    await navigator.clipboard.writeText(connectString)
    //ns.tprint("")
    //ns.tprint(arg + ": " + ns.getServerRequiredHackingLevel(arg))
    bigConnectString += connectString
    //ns.tprint(connectString)
  }
  ns.tprint(bigConnectString)
  await navigator.clipboard.writeText(bigConnectString)
}

