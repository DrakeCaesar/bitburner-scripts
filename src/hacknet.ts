import { NS } from "@ns"
import { killOtherInstances } from "./libraries/batchCalculations"

interface HacknetConfig {
  enablePurchasing: boolean
  moneyReserve: number
  /** Max fraction of (home cash − reserve) spent on a single production purchase. */
  spendCapFraction: number
  /** Max fraction of cash for one cache upgrade (hash capacity only, not production). */
  cacheCapFraction: number
}

const MAX_CACHE_LEVEL = 15

export async function main(ns: NS) {
  ns.disableLog("sleep")
  await killOtherInstances(ns)

  const config: HacknetConfig = {
    enablePurchasing: true,
    // moneyReserve: 160_000_000_000,
    // moneyReserve: 200_005_000_000_000,
    moneyReserve: 0,
    spendCapFraction: 0.01,
    cacheCapFraction: 0.01,
  }

  for (;;) {
    await spendHashes(ns)

    if (config.enablePurchasing) {
      await handleCacheUpgrades(ns, config)
      await handlePurchasing(ns, config)
    }

    await ns.sleep(10)
  }
}

async function spendHashes(ns: NS): Promise<void> {
  if (ns.hacknet.hashCapacity() == 0) return

  const capacity = ns.hacknet.hashCapacity()
  const upgrades = ns.hacknet.getHashUpgrades()

  // Default to "Sell for Money" if available
  const moneyUpgrade = upgrades.find((upgrade) => upgrade === "Sell for Money") || upgrades[0]

  if (!moneyUpgrade) return

  // Spend hashes when near capacity OR when hash rate is low
  let hashThreshold: number
  if (ns.hacknet.hashCapacity() > 100) {
    hashThreshold = Math.max(4, capacity * 0.9)
  } else {
    hashThreshold = Math.min(4, capacity * 0.9)
  }

  const hashRate = calculateTotalHashRate(ns)
  const lowHashRate = hashRate < 4

  while (true) {
    const numHashes = ns.hacknet.numHashes()
    if (numHashes < hashThreshold && !lowHashRate) break

    const cost = ns.hacknet.hashCost(moneyUpgrade)
    if (numHashes < cost) break

    const success = ns.hacknet.spendHashes(moneyUpgrade)
    if (!success) {
      ns.print(`Failed to spend hashes on ${moneyUpgrade}`)
      break
    }
  }
}

async function handleCacheUpgrades(ns: NS, config: HacknetConfig): Promise<void> {
  if (ns.hacknet.hashCapacity() === 0) return

  const availableMoney = Math.max(0, ns.getServerMoneyAvailable("home") - config.moneyReserve)
  const cacheSpendCap = availableMoney * config.cacheCapFraction

  const affordable: { nodeIndex: number; cost: number }[] = []

  for (let i = 0; i < ns.hacknet.numNodes(); i++) {
    const cache = ns.hacknet.getNodeStats(i).cache ?? 0
    if (cache >= MAX_CACHE_LEVEL) continue

    const cost = ns.hacknet.getCacheUpgradeCost(i, 1)
    if (!Number.isFinite(cost) || cost <= 0 || cost > cacheSpendCap) continue

    affordable.push({ nodeIndex: i, cost })
  }

  if (affordable.length === 0) return

  affordable.sort((a, b) => a.cost - b.cost)
  const pick = affordable[0]

  if (ns.hacknet.upgradeCache(pick.nodeIndex, 1)) {
    ns.print(
      `Upgraded cache on hacknet-server-${pick.nodeIndex} (cost: $${ns.format.number(pick.cost)}, cap: $${ns.format.number(cacheSpendCap)})`
    )
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

  const currentMoney = ns.getServerMoneyAvailable("home")
  const availableMoney = Math.max(0, currentMoney - config.moneyReserve)
  const spendCap = availableMoney * config.spendCapFraction

  const affordableOptions = profitableOptions.filter((option) => option.cost <= spendCap)
  if (affordableOptions.length === 0) {
    ns.print(
      `No purchase ≤ ${(config.spendCapFraction * 100).toFixed(0)}% of available cash ($${ns.format.number(spendCap)} of $${ns.format.number(availableMoney)})`
    )
    return
  }

  affordableOptions.sort((a, b) => b.efficiency - a.efficiency)
  const bestOption = affordableOptions[0]

  const targetLabel =
    bestOption.type === "NODE" ? "new hacknet node" : `hacknet-server-${bestOption.nodeIndex}`
  ns.print(
    `Best efficiency option: ${targetLabel} ${bestOption.type} (cost: $${ns.format.number(bestOption.cost)}, cap: $${ns.format.number(spendCap)}, efficiency: ${bestOption.efficiency.toFixed(6)})`
  )

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

function calculateTotalHashRate(ns: NS): number {
  const mult = ns.getHacknetMultipliers().production
  let total = 0
  for (let i = 0; i < ns.hacknet.numNodes(); i++) {
    const node = ns.hacknet.getNodeStats(i)
    total += ns.formulas.hacknetServers.hashGainRate(node.level, node.cache ?? 0, node.ram, node.cores, mult)
  }
  return total
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

