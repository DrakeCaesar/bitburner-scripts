/** @param {import("..").NS } ns */
export async function main(ns) {
  let node = ns.args[0]
  upgradeServer(ns, node)
}

/**
 * Attempts to upgrade a server if we can afford a better one
 * @param {import("..").NS} ns
 * @param {string} node - Server name to upgrade
 * @returns {boolean} true if server was upgraded
 */
export function upgradeServer(ns, node) {
  let money = Math.floor(ns.getPlayer().money)
  let cost
  let future

  // Find the highest RAM we can afford
  for (
    future = 1;
    future <= ns.getPurchasedServerMaxRam() &&
    ns.getPurchasedServerCost(future * 2) < money;
    future *= 2
  ) {
    cost = ns.getPurchasedServerCost(future)
  }

  let current = 0
  if (ns.serverExists(node)) current = ns.getServerMaxRam(node)

  if (money >= cost && future > current) {
    if (ns.serverExists(node)) {
      ns.killall(node)
      ns.deleteServer(node)
    }

    ns.purchaseServer(node, future)
    ns.tprint(`Upgraded ${node} from ${format(current)} to ${format(future)} GB (cost: ${format(cost)})`)
    return true
  }

  return false
}

function format(string) {
  return Math.floor(string)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ")
    .padStart(16)
}
