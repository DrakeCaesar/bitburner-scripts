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
  let index = 0
  let item = "NODE"
  let best = 0

  // Check if we should buy a new node first
  if (ns.hacknet.numNodes() < ns.hacknet.maxNumNodes()) {
    const newNodeProfit = calculateNewNodeProfitRate(ns)
    const newNodeCost = ns.hacknet.getPurchaseNodeCost()
    const newNodeRatio = newNodeProfit / newNodeCost
    
    if (newNodeRatio > best) {
      best = newNodeRatio
      item = "NODE"
    }
  }

  for (let i = 0; i < ns.hacknet.numNodes(); i++) {
    let node = ns.hacknet.getNodeStats(i)
    
    // Calculate profit increase for each upgrade type
    let levelProfitIncrease = calculateLevelUpgradeProfit(ns, i)
    let ramProfitIncrease = calculateRamUpgradeProfit(ns, i)
    let coreProfitIncrease = calculateCoreUpgradeProfit(ns, i)

    // Get actual costs from API
    let levelCost = ns.hacknet.getLevelUpgradeCost(i, 1)
    let ramCost = ns.hacknet.getRamUpgradeCost(i, 1)
    let coreCost = ns.hacknet.getCoreUpgradeCost(i, 1)

    // Calculate efficiency ratios (profit increase per dollar spent)
    if (levelProfitIncrease / levelCost > best && node.level < 200) {
      best = levelProfitIncrease / levelCost
      index = i
      item = "LVL"
    }
    if (ramProfitIncrease / ramCost > best && node.ram < Math.pow(2, 20)) {
      best = ramProfitIncrease / ramCost
      index = i
      item = "RAM"
    }
    if (coreProfitIncrease / coreCost > best && node.cores < 16) {
      best = coreProfitIncrease / coreCost
      index = i
      item = "CPU"
    }
  }

  if (best <= 0) {
    ns.print("No profitable upgrades available")
    return
  }

  ns.print(`Best option: hacknet-server-${index} ${item} (efficiency: ${best.toFixed(6)})`)

  let purchased = -1
  let upgraded = false

  if (item == "NODE") {
    purchased = ns.hacknet.purchaseNode()
    if (purchased >= 0) {
      ns.print(`Purchased new hacknet node: hacknet-server-${purchased}`)
    }
  } else if (item == "LVL") {
    upgraded = ns.hacknet.upgradeLevel(index, 1)
    if (upgraded) {
      ns.print(`Upgraded level of hacknet-server-${index}`)
    }
  } else if (item == "RAM") {
    upgraded = ns.hacknet.upgradeRam(index, 1)
    if (upgraded) {
      ns.print(`Upgraded RAM of hacknet-server-${index}`)
    }
  } else if (item == "CPU") {
    upgraded = ns.hacknet.upgradeCore(index, 1)
    if (upgraded) {
      ns.print(`Upgraded cores of hacknet-server-${index}`)
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
