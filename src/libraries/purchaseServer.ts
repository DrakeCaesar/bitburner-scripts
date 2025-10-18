import { NS } from "@ns"

export async function main(ns: NS): Promise<void> {
  purchaseServers(ns)
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
export function purchaseServers(ns: NS): boolean {
  const maxRam = ns.getPurchasedServerMaxRam()
  let purchasedAny = false

  // Keep trying to buy/upgrade while we can afford it
  while (true) {
    // Get all existing servers and their RAM (recalculate each iteration)
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

    // Find our best server RAM (recalculate each iteration)
    const bestRam = existingServers.length > 0 ? Math.max(...existingServers.map((s) => s.ram)) : 0

    // Calculate target RAM - double the best, or 1 if no servers, capped at maxRam
    // const targetRam = bestRam > 0 ? Math.min(bestRam * 2, maxRam) : 1
    const money = ns.getPlayer().money * 0.5

    let targetRam = 0
    if (bestRam < Math.pow(2, 20)) {
      targetRam = bestRam > 0 ? Math.min(bestRam * 2, maxRam) : 1
    } else {
      for (let i = 0; i <= 20; i++) {
        const ram = Math.pow(2, i)
        const cost = ns.getPurchasedServerCost(ram)
        if (money > cost && ram >= 128) {
          targetRam = ram
        }
      }
    }
    ns.tprint("TARGET RAM " + targetRam)

    const cost = ns.getPurchasedServerCost(targetRam)

    // Check if we can afford the target
    if (money < cost || targetRam == 0) {
      break // Can't afford, exit loop
    }

    // Strategy 1: Always fill empty slots first (even with max RAM servers)
    if (existingServers.length < 25) {
      let purchased = false
      for (let i = 0; i < 25; i++) {
        const nodeName = "node" + String(i).padStart(2, "0")
        if (!ns.serverExists(nodeName)) {
          ns.purchaseServer(nodeName, targetRam)
          ns.tprint(`Purchased ${nodeName} with ${format(targetRam)} GB RAM (cost: ${format(cost)})`)
          purchasedAny = true
          purchased = true
          break // Exit for loop, continue while loop
        }
      }
      if (purchased) continue
    }

    // Strategy 2: All slots filled - upgrade the worst server if target is better
    if (existingServers.length >= 25) {
      existingServers.sort((a, b) => a.ram - b.ram)
      const worstServer = existingServers[0]
      if (worstServer.ram == maxRam) {
        break
      }

      // Only upgrade if the target RAM is better than what we're replacing
      if (targetRam == maxRam || targetRam >= worstServer.ram * 1024) {
        ns.killall(worstServer.name)
        ns.deleteServer(worstServer.name)
        ns.purchaseServer(worstServer.name, targetRam)
        ns.tprint(
          `Upgraded ${worstServer.name} from ${format(worstServer.ram)} to ${format(targetRam)} GB (cost: ${format(cost)})`
        )
        purchasedAny = true
        continue // Continue while loop
      }
    }

    // If we get here, nothing was purchased/upgraded
    break
  }

  return purchasedAny
}

function format(num: number): string {
  return Math.floor(num)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ")
    .padStart(16)
}
