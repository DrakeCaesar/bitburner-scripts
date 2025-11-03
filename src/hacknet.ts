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

export async function spendHashes(ns: NS): Promise<void> {
  if (ns.hacknet.hashCapacity() === 0) return

  const capacity = ns.hacknet.hashCapacity()

  // Define upgrade priority order
  const upgradePriority = ["Improve Studying", "Sell for Money"]

  // Spend when near capacity or at least a few hashes stored
  const hashThreshold = capacity > 1000 ? Math.max(4, capacity * 0.9) : Math.min(4, capacity * 0.9)

  while (ns.hacknet.numHashes() >= hashThreshold) {
    let spent = false

    for (const upgrade of upgradePriority) {
      const cost = ns.hacknet.hashCost(upgrade)
      if (ns.hacknet.numHashes() >= cost) {
        if (ns.hacknet.spendHashes(upgrade)) {
          spent = true
          break
        }
      }
    }

    if (!spent) break

    await ns.sleep(100)
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

  // Check if we should buy a new node
  if (ns.hacknet.numNodes() < ns.hacknet.maxNumNodes()) {
    const newNodeProfit = calculateNewNodeProfitRate(ns)
    const newNodeCost = ns.hacknet.getPurchaseNodeCost()
    const newNodeRatio = newNodeProfit / newNodeCost

    upgradeOptions.push({
      nodeIndex: -1,
      type: "NODE",
      cost: newNodeCost,
      efficiency: newNodeRatio,
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
    if (node.cores < 16) {
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

  ns.print(
    `Best efficiency option: hacknet-server-${bestOption.nodeIndex} ${bestOption.type} (cost: $${ns.formatNumber(bestOption.cost)}, efficiency: ${bestOption.efficiency.toFixed(6)})`
  )

  // Check if we have enough money after keeping the reserve
  const currentMoney = ns.getServerMoneyAvailable("home")
  const availableMoney = currentMoney - config.moneyReserve

  if (availableMoney < bestOption.cost) {
    ns.print(
      `Not enough money for upgrade. Available: $${ns.formatNumber(availableMoney)}, Cost: $${ns.formatNumber(bestOption.cost)}, Reserve: $${ns.formatNumber(config.moneyReserve)}`
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

function calculateNewNodeProfitRate(ns: NS): number {
  // New nodes start at level 1, ram 1, cores 1
  return ns.formulas.hacknetServers.hashGainRate(1, 0, 1, 1, ns.getHacknetMultipliers().production)
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

function calculateHacknetNewNodeProfitRate(ns: NS): number {
  // New nodes start at level 1, ram 1, cores 1
  return ns.formulas.hacknetNodes.moneyGainRate(1, 1, 1, ns.getHacknetMultipliers().production)
}

function calculateHacknetLevelUpgradeProfit(ns: NS, nodeIndex: number): number {
  const node = ns.hacknet.getNodeStats(nodeIndex)
  const mult = ns.getHacknetMultipliers().production
  const currentProduction = ns.formulas.hacknetNodes.moneyGainRate(node.level, node.ram, node.cores, mult)
  const upgradedProduction = ns.formulas.hacknetNodes.moneyGainRate(node.level + 1, node.ram, node.cores, mult)
  return upgradedProduction - currentProduction
}

function calculateHacknetRamUpgradeProfit(ns: NS, nodeIndex: number): number {
  const node = ns.hacknet.getNodeStats(nodeIndex)
  const mult = ns.getHacknetMultipliers().production
  const currentProduction = ns.formulas.hacknetNodes.moneyGainRate(node.level, node.ram, node.cores, mult)
  const upgradedProduction = ns.formulas.hacknetNodes.moneyGainRate(node.level, node.ram * 2, node.cores, mult)
  ns.tprint(node.ram)
  ns.tprint(`mult: ${mult} current: ${currentProduction}, upgraded: ${upgradedProduction}`)

  return upgradedProduction - currentProduction
}

function calculateHacknetCoreUpgradeProfit(ns: NS, nodeIndex: number): number {
  const node = ns.hacknet.getNodeStats(nodeIndex)
  const mult = ns.getHacknetMultipliers().production
  const currentProduction = ns.formulas.hacknetNodes.moneyGainRate(node.level, node.ram, node.cores, mult)
  const upgradedProduction = ns.formulas.hacknetNodes.moneyGainRate(node.level, node.ram, node.cores + 1, mult)
  return upgradedProduction - currentProduction
}
