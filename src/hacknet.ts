import { NS } from "@ns"
import { killOtherInstances } from "./libraries/batchCalculations"

interface HacknetConfig {
  enablePurchasing: boolean
  moneyReserve: number
}

export async function main(ns: NS) {
  ns.disableLog("sleep")
  await killOtherInstances(ns)

  const config: HacknetConfig = {
    enablePurchasing: true,
    // moneyReserve: 160_000_000_000,
    // moneyReserve: 200_005_000_000_000,
    moneyReserve: 0,
  }

  for (;;) {
    await spendHashes(ns)

    if (config.enablePurchasing) {
      await handlePurchasing(ns, config)
    }

    await ns.sleep(10)
  }
}

async function spendHashes(ns: NS): Promise<void> {
  if (ns.hacknet.hashCapacity() == 0) return

  const hashes = ns.hacknet.numHashes()
  const capacity = ns.hacknet.hashCapacity()
  const upgrades = ns.hacknet.getHashUpgrades()

  // Default to "Sell for Money" if available
  const moneyUpgrade = upgrades.find((upgrade) => upgrade === "Sell for Money") || upgrades[0]

  if (!moneyUpgrade) return

  // Spend hashes when we're at 90% capacity or have at least 4 hashes
  let hashThreshold: number
  if (ns.hacknet.hashCapacity() > 1000) {
    hashThreshold = Math.max(4, capacity * 0.9)
  } else {
    hashThreshold = Math.min(4, capacity * 0.9)
  }

  while (ns.hacknet.numHashes() >= hashThreshold) {
    const cost = ns.hacknet.hashCost(moneyUpgrade)
    if (ns.hacknet.numHashes() >= cost) {
      const success = ns.hacknet.spendHashes(moneyUpgrade)
      if (!success) {
        ns.print(`Failed to spend hashes on ${moneyUpgrade}`)
        break
      }
    } else {
      break
    }
  }
}

async function handlePurchasing(ns: NS, config: HacknetConfig): Promise<void> {
  interface UpgradeOption {
    nodeIndex: number
    type: string
    cost: number
    efficiency: number
  }

  const upgradeOptions: UpgradeOption[] = []

  // Check if we should buy a new node (same metric as upgrades: marginal hash/s per dollar)
  if (ns.hacknet.numNodes() < ns.hacknet.maxNumNodes()) {
    const newNodeCost = ns.hacknet.getPurchaseNodeCost()
    upgradeOptions.push({
      nodeIndex: -1,
      type: "NODE",
      cost: newNodeCost,
      efficiency: calculateNewNodeEfficiency(ns),
    })
  }

  // Check all possible upgrades for all nodes
  for (let i = 0; i < ns.hacknet.numNodes(); i++) {
    const node = ns.hacknet.getNodeStats(i)

    // Level upgrade
    if (node.level < 200) {
      const profit = calculateLevelUpgradeProfit(ns, i)
      const cost = ns.hacknet.getLevelUpgradeCost(i, 1)
      upgradeOptions.push({
        nodeIndex: i,
        type: "LVL",
        cost: cost,
        efficiency: profit / cost,
      })
    }

    // RAM upgrade
    if (node.ram < Math.pow(2, 20)) {
      const profit = calculateRamUpgradeProfit(ns, i)
      const cost = ns.hacknet.getRamUpgradeCost(i, 1)
      upgradeOptions.push({
        nodeIndex: i,
        type: "RAM",
        cost: cost,
        efficiency: profit / cost,
      })
    }

    // Core upgrade
    if (node.cores < 32) {
      const profit = calculateCoreUpgradeProfit(ns, i)
      const cost = ns.hacknet.getCoreUpgradeCost(i, 1)
      upgradeOptions.push({
        nodeIndex: i,
        type: "CPU",
        cost: cost,
        efficiency: profit / cost,
      })
    }
  }

  if (upgradeOptions.length === 0) {
    ns.print("No upgrade options available")
    return
  }

  // Sort by efficiency (best increment per unit of cost) among profitable options
  const profitableOptions = upgradeOptions.filter((option) => option.efficiency > 0)
  if (profitableOptions.length === 0) {
    ns.print("No profitable upgrades available")
    return
  }

  profitableOptions.sort((a, b) => b.efficiency - a.efficiency)
  const bestOption = profitableOptions[0]

  const targetLabel =
    bestOption.type === "NODE" ? "new hacknet node" : `hacknet-server-${bestOption.nodeIndex}`
  ns.print(
    `Best efficiency option: ${targetLabel} ${bestOption.type} (cost: $${ns.format.number(bestOption.cost)}, efficiency: ${bestOption.efficiency.toFixed(6)})`
  )

  // Check if we have enough money after keeping the reserve
  const currentMoney = ns.getServerMoneyAvailable("home")
  const availableMoney = currentMoney - config.moneyReserve

  if (availableMoney < bestOption.cost) {
    ns.print(
      `Not enough money for upgrade. Available: $${ns.format.number(availableMoney)}, Cost: $${ns.format.number(bestOption.cost)}, Reserve: $${ns.format.number(config.moneyReserve)}`
    )
    return
  }

  let purchased = -1
  let upgraded = false

  if (bestOption.type == "NODE") {
    purchased = ns.hacknet.purchaseNode()
    if (purchased >= 0) {
      ns.print(`Purchased new hacknet node: hacknet-server-${purchased}`)
    }
  } else if (bestOption.type == "LVL") {
    upgraded = ns.hacknet.upgradeLevel(bestOption.nodeIndex, 1)
    if (upgraded) {
      ns.print(`Upgraded level of hacknet-server-${bestOption.nodeIndex}`)
    }
  } else if (bestOption.type == "RAM") {
    upgraded = ns.hacknet.upgradeRam(bestOption.nodeIndex, 1)
    if (upgraded) {
      ns.print(`Upgraded RAM of hacknet-server-${bestOption.nodeIndex}`)
    }
  } else if (bestOption.type == "CPU") {
    upgraded = ns.hacknet.upgradeCore(bestOption.nodeIndex, 1)
    if (upgraded) {
      ns.print(`Upgraded cores of hacknet-server-${bestOption.nodeIndex}`)
    }
  }

  if (purchased == -1 && !upgraded) {
    ns.print("Could not afford the upgrade")
    await ns.sleep(10) // Wait longer if we can't afford anything
  }
}

/** Hash/s from a new node at default stats (level 1, 1GB RAM, 1 core). */
function calculateNewNodeMarginalHashRate(ns: NS): number {
  const mult = ns.getHacknetMultipliers().production
  return ns.formulas.hacknetServers.hashGainRate(1, 0, 1, 1, mult)
}

/** Marginal hash/s per dollar for purchasing another node (comparable to upgrade delta/cost). */
function calculateNewNodeEfficiency(ns: NS): number {
  const cost = ns.hacknet.getPurchaseNodeCost()
  if (cost <= 0) return 0
  return calculateNewNodeMarginalHashRate(ns) / cost
}

function calculateLevelUpgradeProfit(ns: NS, nodeIndex: number): number {
  const node = ns.hacknet.getNodeStats(nodeIndex)
  const mult = ns.getHacknetMultipliers().production
  const currentProduction = ns.formulas.hacknetServers.hashGainRate(node.level, 0, node.ram, node.cores, mult)
  const upgradedProduction = ns.formulas.hacknetServers.hashGainRate(node.level + 1, 0, node.ram, node.cores, mult)
  return upgradedProduction - currentProduction
}

function calculateRamUpgradeProfit(ns: NS, nodeIndex: number): number {
  const node = ns.hacknet.getNodeStats(nodeIndex)
  const mult = ns.getHacknetMultipliers().production
  const currentProduction = ns.formulas.hacknetServers.hashGainRate(node.level, 0, node.ram, node.cores, mult)
  const upgradedProduction = ns.formulas.hacknetServers.hashGainRate(node.level, 0, node.ram * 2, node.cores, mult)
  // ns.tprint(`mult: ${mult} current: ${currentProduction}, upgraded: ${upgradedProduction}`)

  return upgradedProduction - currentProduction
}

function calculateCoreUpgradeProfit(ns: NS, nodeIndex: number): number {
  const node = ns.hacknet.getNodeStats(nodeIndex)
  const mult = ns.getHacknetMultipliers().production
  const currentProduction = ns.formulas.hacknetServers.hashGainRate(node.level, 0, node.ram, node.cores, mult)
  const upgradedProduction = ns.formulas.hacknetServers.hashGainRate(node.level, 0, node.ram, node.cores + 1, mult)
  return upgradedProduction - currentProduction
}

