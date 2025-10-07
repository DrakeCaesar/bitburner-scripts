import { NS } from "@ns"

export async function main(ns: NS): Promise<void> {
  upgradeServer(ns)
}

interface ServerInfo {
  name: string
  ram: number
}

/**
 * Manages server purchases and upgrades across all 25 slots (node00-node24)
 * Strategy:
 * 1. Fill empty slots with progressively better servers (only buy if better than our best)
 * 2. Once all slots filled, upgrade the worst server (only if we can afford better than our best)
 * 3. For max RAM servers, keep buying more to replace worst servers
 * @param ns - Netscript API
 * @returns true if a server was purchased or upgraded
 */
export function upgradeServer(ns: NS): boolean {
  const money = Math.floor(ns.getPlayer().money)
  const maxRam = ns.getPurchasedServerMaxRam()

  // Get all existing servers and their RAM
  const existingServers: ServerInfo[] = []
  for (let i = 0; i < 25; i++) {
    const nodeName = "node" + String(i).padStart(2, "0")
    if (ns.serverExists(nodeName)) {
      existingServers.push({
        name: nodeName,
        ram: ns.getServerMaxRam(nodeName),
      })
    }
  }

  // Find our best server RAM
  const bestRam = existingServers.length > 0 ? Math.max(...existingServers.map((s) => s.ram)) : 0

  // Calculate target RAM - double the best, or 1 if no servers, capped at maxRam
  const targetRam = bestRam > 0 ? Math.min(bestRam * 2, maxRam) : 1
  const cost = ns.getPurchasedServerCost(targetRam)

  // Check if we can afford the target
  if (money < cost) {
    return false
  }

  // If best is already maxed, don't try to double it
  if (bestRam >= maxRam) {
    return false
  }

  // Strategy 1: Fill empty slots first
  if (existingServers.length < 25) {
    for (let i = 0; i < 25; i++) {
      const nodeName = "node" + String(i).padStart(2, "0")
      if (!ns.serverExists(nodeName)) {
        ns.purchaseServer(nodeName, targetRam)
        ns.tprint(`Purchased ${nodeName} with ${format(targetRam)} GB RAM (cost: ${format(cost)})`)
        return true
      }
    }
  }

  // Strategy 2: All slots filled - upgrade the worst server
  // Find the server with the smallest RAM
  existingServers.sort((a, b) => a.ram - b.ram)
  const worstServer = existingServers[0]

  // Only upgrade if the target RAM is better than what we're replacing
  if (targetRam > worstServer.ram) {
    ns.killall(worstServer.name)
    ns.deleteServer(worstServer.name)
    ns.purchaseServer(worstServer.name, targetRam)
    ns.tprint(
      `Upgraded ${worstServer.name} from ${format(worstServer.ram)} to ${format(targetRam)} GB (cost: ${format(cost)})`
    )
    return true
  }

  return false
}

function format(num: number): string {
  return Math.floor(num)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ")
    .padStart(16)
}
