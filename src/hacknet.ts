import { NS } from "@ns"
import { killOtherInstances } from "./libraries/batchCalculations"

interface HacknetConfig {
  enablePurchasing: boolean
}

export async function main(ns: NS) {
  ns.disableLog("sleep")
  await killOtherInstances(ns)

  const config: HacknetConfig = {
    enablePurchasing: true,
  }

  for (;;) {
    await spendHashes(ns)

    if (config.enablePurchasing) {
      await handlePurchasing(ns)
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
  const moneyUpgrade = upgrades.find(upgrade => upgrade === "Sell for Money") || upgrades[0]
  
  if (!moneyUpgrade) return

  // Spend hashes when we're at 90% capacity or have at least 4 hashes
  const hashThreshold = Math.max(4, capacity * 0.9)
  
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

async function handlePurchasing(ns: NS): Promise<void> {
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
      efficiency: newNodeRatio
    })
  }

  // For each node, find its most profitable upgrade type
  for (let i = 0; i < ns.hacknet.numNodes(); i++) {
    const node = ns.hacknet.getNodeStats(i)
    
    const upgrades = []
    
    // Level upgrade
    if (node.level < 200) {
      const profit = calculateLevelUpgradeProfit(ns, i)
      const cost = ns.hacknet.getLevelUpgradeCost(i, 1)
      upgrades.push({ type: "LVL", cost, efficiency: profit / cost })
    }
    
    // RAM upgrade
    if (node.ram < Math.pow(2, 20)) {
      const profit = calculateRamUpgradeProfit(ns, i)
      const cost = ns.hacknet.getRamUpgradeCost(i, 1)
      upgrades.push({ type: "RAM", cost, efficiency: profit / cost })
    }
    
    // Core upgrade
    if (node.cores < 16) {
      const profit = calculateCoreUpgradeProfit(ns, i)
      const cost = ns.hacknet.getCoreUpgradeCost(i, 1)
      upgrades.push({ type: "CPU", cost, efficiency: profit / cost })
    }
    
    // Find the best upgrade for this node
    if (upgrades.length > 0) {
      const bestUpgrade = upgrades.reduce((best, current) => 
        current.efficiency > best.efficiency ? current : best
      )
      
      upgradeOptions.push({
        nodeIndex: i,
        type: bestUpgrade.type,
        cost: bestUpgrade.cost,
        efficiency: bestUpgrade.efficiency
      })
    }
  }

  if (upgradeOptions.length === 0) {
    ns.print("No upgrade options available")
    return
  }

  // Sort by cost (cheapest first) among profitable options
  const profitableOptions = upgradeOptions.filter(option => option.efficiency > 0)
  if (profitableOptions.length === 0) {
    ns.print("No profitable upgrades available")
    return
  }

  profitableOptions.sort((a, b) => a.cost - b.cost)
  const cheapestOption = profitableOptions[0]

  ns.print(`Cheapest profitable option: hacknet-server-${cheapestOption.nodeIndex} ${cheapestOption.type} (cost: $${ns.formatNumber(cheapestOption.cost)}, efficiency: ${cheapestOption.efficiency.toFixed(6)})`)

  let purchased = -1
  let upgraded = false

  if (cheapestOption.type == "NODE") {
    purchased = ns.hacknet.purchaseNode()
    if (purchased >= 0) {
      ns.print(`Purchased new hacknet node: hacknet-server-${purchased}`)
    }
  } else if (cheapestOption.type == "LVL") {
    upgraded = ns.hacknet.upgradeLevel(cheapestOption.nodeIndex, 1)
    if (upgraded) {
      ns.print(`Upgraded level of hacknet-server-${cheapestOption.nodeIndex}`)
    }
  } else if (cheapestOption.type == "RAM") {
    upgraded = ns.hacknet.upgradeRam(cheapestOption.nodeIndex, 1)
    if (upgraded) {
      ns.print(`Upgraded RAM of hacknet-server-${cheapestOption.nodeIndex}`)
    }
  } else if (cheapestOption.type == "CPU") {
    upgraded = ns.hacknet.upgradeCore(cheapestOption.nodeIndex, 1)
    if (upgraded) {
      ns.print(`Upgraded cores of hacknet-server-${cheapestOption.nodeIndex}`)
    }
  }

  if (purchased == -1 && !upgraded) {
    ns.print("Could not afford the upgrade")
    await ns.sleep(10) // Wait longer if we can't afford anything
  }
}

function calculateNewNodeProfitRate(ns: NS): number {
  // New nodes start at level 1, ram 1, cores 1
  return ns.formulas.hacknetNodes.moneyGainRate(1, 1, 1, ns.getHacknetMultipliers().production)
}

function calculateLevelUpgradeProfit(ns: NS, nodeIndex: number): number {
  const node = ns.hacknet.getNodeStats(nodeIndex)
  const mult = ns.getHacknetMultipliers().production
  const currentProduction = ns.formulas.hacknetNodes.moneyGainRate(node.level, node.ram, node.cores, mult)
  const upgradedProduction = ns.formulas.hacknetNodes.moneyGainRate(node.level + 1, node.ram, node.cores, mult)
  return upgradedProduction - currentProduction
}

function calculateRamUpgradeProfit(ns: NS, nodeIndex: number): number {
  const node = ns.hacknet.getNodeStats(nodeIndex)
  const mult = ns.getHacknetMultipliers().production
  const currentProduction = ns.formulas.hacknetNodes.moneyGainRate(node.level, node.ram, node.cores, mult)
  const upgradedProduction = ns.formulas.hacknetNodes.moneyGainRate(node.level, node.ram * 2, node.cores, mult)
  return upgradedProduction - currentProduction
}

function calculateCoreUpgradeProfit(ns: NS, nodeIndex: number): number {
  const node = ns.hacknet.getNodeStats(nodeIndex)
  const mult = ns.getHacknetMultipliers().production
  const currentProduction = ns.formulas.hacknetNodes.moneyGainRate(node.level, node.ram, node.cores, mult)
  const upgradedProduction = ns.formulas.hacknetNodes.moneyGainRate(node.level, node.ram, node.cores + 1, mult)
  return upgradedProduction - currentProduction
}
