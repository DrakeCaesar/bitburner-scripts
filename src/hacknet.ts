import { NS } from "@ns"
import { killOtherInstances } from "./libraries/batchCalculations"
export async function main(ns: NS) {
  ns.disableLog("sleep")
  await killOtherInstances(ns)

  for (;;) {
    var index = 0
    var item = "NODE"
    var best = 0
    const maxHashes = ns.hacknet.hashCapacity()
    const hashes = ns.hacknet.numHashes()
    const mon = ns.hacknet.getHashUpgrades()[0]

    // ns.tprint(hashes)
    // ns.tprint(mon)

    for (var i = 0; i < ns.hacknet.numNodes(); i++) {
      let node = ns.hacknet.getNodeStats(i)
      //ns.tprintf(JSON.stringify(node))
      let node_lvl = levelUpgradeProfit(ns, node.level, node.ram, node.cores)
      let node_ram = ramUpgradeProfit(ns, node.level, node.ram, node.cores)
      let node_cpu = coreUpgradeProfit(ns, node.level, node.ram, node.cores)

      if (node_lvl / ns.hacknet.getLevelUpgradeCost(i, 1) > best && node.level < 200) {
        ns.hacknet.upgradeRam
        best = node_lvl / ns.hacknet.getLevelUpgradeCost(i, 1)
        index = i
        item = "LVL"
      }
      if (node_ram / ns.hacknet.getRamUpgradeCost(i, 1) > best && node.ram < 64) {
        best = node_ram / ns.hacknet.getRamUpgradeCost(i, 1)
        index = i
        item = "RAM"
      }
      if (node_cpu / ns.hacknet.getCoreUpgradeCost(i, 1) > best && node.cores < 16) {
        best = node_cpu / ns.hacknet.getCoreUpgradeCost(i, 1)
        index = i
        item = "CPU"
      }
      //ns.tprint(node_lvl)
      //ns.tprint(node_ram)
      //ns.tprint(node_cpu)
    }

    ns.print(item)
    ns.print(index)
    ns.print("")

    let purchaseCost = ns.hacknet.getPurchaseNodeCost()
    let purchased = -1
    let upgraded = false
    while (purchased == -1 && !upgraded) {
      if (item == "NODE") {
        purchased = ns.hacknet.purchaseNode()
      }
      if (item == "LVL") {
        let upgradeCost = ns.hacknet.getLevelUpgradeCost(index, 1)
        if (upgradeCost > purchaseCost) {
          purchased = ns.hacknet.purchaseNode()
        } else {
          upgraded = ns.hacknet.upgradeLevel(index, 1)
        }
      } else if (item == "RAM") {
        let upgradeCost = ns.hacknet.getRamUpgradeCost(index, 1)
        if (upgradeCost > purchaseCost) {
          purchased = ns.hacknet.purchaseNode()
        } else {
          upgraded = ns.hacknet.upgradeRam(index, 1)
        }
      } else if (item == "CPU") {
        let upgradeCost = ns.hacknet.getCoreUpgradeCost(index, 1)
        if (upgradeCost > purchaseCost) {
          purchased = ns.hacknet.purchaseNode()
        } else {
          upgraded = ns.hacknet.upgradeCore(index, 1)
        }
      }

      if (purchased == -1 && !upgraded) {
        await ns.sleep(1000)

        while (ns.hacknet.numHashes() >= ns.hacknet.hashCapacity() * 0.9) {
          ns.hacknet.spendHashes(mon)
        }
      }
    }
  }
}

export function levelUpgradeProfit(ns: NS, currentLevel: number, currentRam: number, currentLevelCore: number) {
  return (
    1 * 1.5 * Math.pow(1.035, currentRam - 1) * ((currentLevelCore + 5) / 6) * ns.getHacknetMultipliers().production
  )
}
export function ramUpgradeProfit(ns: NS, currentLevel: number, currentRam: number, currentLevelCore: number) {
  return (
    currentLevel *
    1.5 *
    (Math.pow(1.035, 2 * currentRam - 1) - Math.pow(1.035, currentRam - 1)) *
    ((currentLevelCore + 5) / 6) *
    ns.getHacknetMultipliers().production
  )
}
export function coreUpgradeProfit(ns: NS, currentLevel: number, currentRam: number, currentLevelCore: number) {
  return currentLevel * 1.5 * Math.pow(1.035, currentRam - 1) * (1 / 6) * ns.getHacknetMultipliers().production
}
