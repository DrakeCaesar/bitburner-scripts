import { NS, Person, Player, Server } from "@ns"
import { crawl } from "./libraries/crawl.js"
/**
 * Calculate XP gained from a hacking operation (hack/grow/weaken)
 * Based on ns.formulas.hacking.hackExp()
 */
export function calculateOperationXp(server: Server, player: Person, threads: number, ns: NS): number {
  const xpPerThread = ns.formulas.hacking.hackExp(server, player)
  return xpPerThread * threads
}

/**
 * Kahan summation state for accumulating XP with minimal floating point error
 */
export interface KahanSum {
  sum: number
  compensation: number
}

/**
 * Create a new Kahan summation state
 */
export function createKahanSum(initialValue = 0): KahanSum {
  return { sum: initialValue, compensation: 0 }
}

/**
 * Add a value to a Kahan sum, returning updated state
 * Uses Kahan summation algorithm to minimize floating point error accumulation
 */
export function kahanAdd(kahan: KahanSum, value: number): KahanSum {
  // Kahan summation algorithm:
  // 1. Adjust input by accumulated error compensation
  const y = value - kahan.compensation
  // 2. Add to running sum
  const t = kahan.sum + y
  // 3. Calculate new error: (t - sum) should equal y, but floating point error means it doesn't
  //    This error becomes the compensation for next iteration
  kahan.compensation = t - kahan.sum - y
  // 4. Update sum
  kahan.sum = t
  return kahan
}

/**
 * Update player object with new hacking XP and recalculate hacking level
 * Only copies the necessary nested objects to avoid deprecated property warnings
 */
export function updatePlayerWithXp(player: Player, xpGained: number, ns: NS): Player {
  const updatedPlayer = {
    ...player,
    exp: { ...player.exp },
    skills: { ...player.skills },
  }
  updatedPlayer.exp.hacking += xpGained

  // Recalculate hacking skill level from total XP
  updatedPlayer.skills.hacking = ns.formulas.skills.calculateSkill(
    updatedPlayer.exp.hacking,
    updatedPlayer.mults.hacking
  )

  return updatedPlayer
}

/**
 * Update player object with XP from Kahan accumulator and recalculate hacking level
 * More accurate than updatePlayerWithXp when accumulating many small XP values
 */
export function updatePlayerWithKahanXp(player: Player, xpKahan: KahanSum, ns: NS): Player {
  const updatedPlayer = {
    ...player,
    exp: { ...player.exp },
    skills: { ...player.skills },
  }
  updatedPlayer.exp.hacking = xpKahan.sum

  // Recalculate hacking skill level from total XP
  updatedPlayer.skills.hacking = ns.formulas.skills.calculateSkill(
    updatedPlayer.exp.hacking,
    updatedPlayer.mults.hacking
  )

  return updatedPlayer
}

export function hackServerInstance(server: Server, player: Player) {
  const serverCopy = { ...server }
  serverCopy.moneyAvailable = serverCopy.moneyMax!
  serverCopy.hackDifficulty = serverCopy.minDifficulty
  return { server: serverCopy, player }
}

export function wkn1ServerInstance(server: Server, player: Player, hackThreads: number, ns: NS) {
  const serverCopy = { ...server }
  serverCopy.hackDifficulty = serverCopy.minDifficulty! + ns.hackAnalyzeSecurity(hackThreads, undefined)

  return { server: serverCopy, player }
}

export function growServerInstance(server: Server, player: Player, hackThreshold: number) {
  const serverCopy = { ...server }
  serverCopy.moneyAvailable = serverCopy.moneyMax! * hackThreshold
  serverCopy.hackDifficulty = serverCopy.minDifficulty

  return { server: serverCopy, player }
}

export function wkn2ServerInstance(server: Server, player: Player, growThreads: number, ns: NS, myCores: number) {
  const serverCopy = { ...server }
  serverCopy.hackDifficulty = serverCopy.minDifficulty! + ns.growthAnalyzeSecurity(growThreads, undefined, myCores)
  return { server: serverCopy, player }
}

export function calculateHackThreads(server: Server, player: Person, moneyMax: number, hackThreshold: number, ns: NS) {
  const hackPct = ns.formulas.hacking.hackPercent(server, player)
  return Math.floor((moneyMax - moneyMax * hackThreshold) / (hackPct * moneyMax))
}

export function calculateWeakThreads(server: Server, player: Player, myCores: number) {
  const addedSecurity = server.hackDifficulty! - server.minDifficulty!
  return Math.max(1, Math.ceil(addedSecurity / (0.05 * (1 + (myCores - 1) / 16))))
}

// TODO: Verify if adding 1 is a good approach here
export function calculateGrowThreads(server: Server, player: Person, moneyMax: number, myCores: number, ns: NS) {
  return Math.ceil(ns.formulas.hacking.growThreads(server, player, moneyMax, myCores) + 1)
}

export function getDelta(opTime: number, index: number) {
  return opTime / (2.5 + 2 * index)
}

export function getIndexFromDelta(opTime: number, targetDelta: number) {
  const index = (opTime / targetDelta - 2.5) / 2
  return Math.max(0, Math.round(index))
}

export function calculateOptimalDelta(maxWeakenTime: number, maxConcurrentBatches: number) {
  return maxWeakenTime / (maxConcurrentBatches * 4)
}

export async function killOtherInstances(ns: NS) {
  const currentScript = ns.getScriptName()
  const allServers = ns.getPurchasedServers().concat(["home"])

  for (const server of allServers) {
    const runningScripts = ns.ps(server)
    for (const script of runningScripts) {
      if (script.filename === currentScript && script.pid !== ns.pid) {
        ns.kill(script.pid)
      }
    }
  }
}

export async function copyRequiredScripts(ns: NS, host: string) {
  ns.scp("/hacking/hack.js", host)
  ns.scp("/hacking/grow.js", host)
  ns.scp("/hacking/weaken.js", host)
  ns.scp("/prepareServer.js", host)
  ns.scp("/batchCalculations.js", host)
  ns.scp("/batchVisualizerStub.js", host)
  ns.scp("/libraries/crawl.js", host)
  ns.scp("/crawl.ts", host)
}

/**
 * Calculate estimated prep time for a server based on available RAM across all nodes
 * Simulates the prep process to determine how many iterations are needed
 * @param showVerbose - If true, displays detailed simulation output to console
 */
export function calculatePrepTime(ns: NS, nodes: string[], target: string, showVerbose = false): number {
  const server = ns.getServer(target)
  let player = ns.getPlayer()
  const moneyMax = server.moneyMax ?? 0
  const baseSecurity = server.minDifficulty ?? 0
  const secTolerance = 0
  const moneyTolerance = 1

  // If already prepped, return 0
  const currentSec = server.hackDifficulty ?? 0
  const currentMoney = server.moneyAvailable ?? 0
  if (currentMoney >= moneyMax * moneyTolerance && currentSec <= baseSecurity + secTolerance) {
    ns.tprint(`[Prep Sim] Server already prepped!`)
    return 0
  }

  const myCores = ns.getServer(nodes[0]).cpuCores
  const growScriptRam = ns.getScriptRam("/hacking/grow.js")
  const weakenScriptRam = ns.getScriptRam("/hacking/weaken.js")

  // Accumulate verbose output
  let verboseOutput = ""
  const log = (msg: string) => {
    verboseOutput += msg + "\n"
    if (!showVerbose) {
      ns.tprint(msg)
    }
  }

  // Helper to calculate weaken threads needed for a given security reduction
  const calcWeakenThreads = (secToReduce: number): number => {
    if (secToReduce <= 0) return 0
    return Math.ceil(secToReduce / (0.05 * (1 + (myCores - 1) / 16)))
  }

  // Helper to simulate thread distribution across nodes and build capacity table
  interface NodeCapacity {
    name: string
    availRam: number
    growThreads: number
    weakenThreads: number
    usedRam: number
    totalRam: number
  }

  const simulateDistribution = (
    growThreadsNeeded: number,
    weakenThreadsNeeded: number
  ): {
    actualGrowThreads: number
    actualWeakenThreads: number
    nodeCapacities: NodeCapacity[]
  } => {
    const nodeCapacities: NodeCapacity[] = []
    let remainingGrow = growThreadsNeeded
    let remainingWeaken = weakenThreadsNeeded

    for (const node of nodes) {
      const totalRam = ns.getServerMaxRam(node)
      const usedRam = ns.getServerUsedRam(node)
      const availRam = totalRam - usedRam
      let nodeGrowThreads = 0
      let nodeWeakenThreads = 0

      // Allocate grow and weaken together on this node
      if (remainingGrow > 0 && remainingWeaken > 0) {
        // Try to fit both grow and weaken on this node
        const maxGrowThreads = Math.floor(availRam / growScriptRam)
        const potentialGrowThreads = Math.min(remainingGrow, maxGrowThreads)

        // Calculate weaken needed for this grow amount
        const growSecIncrease = ns.growthAnalyzeSecurity(potentialGrowThreads, undefined, myCores)
        const weakenNeeded = calcWeakenThreads(growSecIncrease)
        const weakenForThisGrow = Math.min(weakenNeeded, remainingWeaken)

        // Check if both fit
        const ramNeeded = potentialGrowThreads * growScriptRam + weakenForThisGrow * weakenScriptRam
        if (ramNeeded <= availRam) {
          nodeGrowThreads = potentialGrowThreads
          nodeWeakenThreads = weakenForThisGrow
          remainingGrow -= nodeGrowThreads
          remainingWeaken -= nodeWeakenThreads
        } else {
          // Find max grow that fits with its weaken on this node
          let low = 1
          let high = potentialGrowThreads
          let bestGrow = 0
          let bestWeaken = 0

          while (low <= high) {
            const mid = Math.floor((low + high) / 2)
            const testGrowSecIncrease = ns.growthAnalyzeSecurity(mid, undefined, myCores)
            const testWeakenNeeded = calcWeakenThreads(testGrowSecIncrease)
            const testWeaken = Math.min(testWeakenNeeded, remainingWeaken)
            const testRamNeeded = mid * growScriptRam + testWeaken * weakenScriptRam

            if (testRamNeeded <= availRam) {
              bestGrow = mid
              bestWeaken = testWeaken
              low = mid + 1
            } else {
              high = mid - 1
            }
          }

          nodeGrowThreads = bestGrow
          nodeWeakenThreads = bestWeaken
          remainingGrow -= nodeGrowThreads
          remainingWeaken -= nodeWeakenThreads
        }
      } else if (remainingGrow > 0) {
        // Only grow left
        const maxGrowThreads = Math.floor(availRam / growScriptRam)
        nodeGrowThreads = Math.min(remainingGrow, maxGrowThreads)
        remainingGrow -= nodeGrowThreads
      } else if (remainingWeaken > 0) {
        // Only weaken left
        const maxWeakenThreads = Math.floor(availRam / weakenScriptRam)
        nodeWeakenThreads = Math.min(remainingWeaken, maxWeakenThreads)
        remainingWeaken -= nodeWeakenThreads
      }

      nodeCapacities.push({
        name: node,
        availRam,
        growThreads: nodeGrowThreads,
        weakenThreads: nodeWeakenThreads,
        usedRam,
        totalRam,
      })
    }

    return {
      actualGrowThreads: growThreadsNeeded - remainingGrow,
      actualWeakenThreads: weakenThreadsNeeded - remainingWeaken,
      nodeCapacities,
    }
  }

  // Helper to build table from node capacities
  const buildCapacityTable = (nodeCapacities: NodeCapacity[], iteration: number): string => {
    // Column headers
    const serverCol = "Server"
    const availRamCol = "Avail"
    const growCol = "G"
    const growRamCol = "G RAM"
    const weakenCol = "W"
    const weakenRamCol = "W RAM"
    const remainCol = "Left"

    // Calculate column widths
    let serverLen = serverCol.length
    let availRamLen = availRamCol.length
    let growLen = growCol.length
    let growRamLen = growRamCol.length
    let weakenLen = weakenCol.length
    let weakenRamLen = weakenRamCol.length
    let remainLen = remainCol.length

    for (const nc of nodeCapacities) {
      const growRam = nc.growThreads * growScriptRam
      const weakenRam = nc.weakenThreads * weakenScriptRam
      const remaining = nc.availRam - growRam - weakenRam

      serverLen = Math.max(serverLen, nc.name.length)
      availRamLen = Math.max(availRamLen, ns.formatRam(nc.availRam).length)
      growLen = Math.max(growLen, nc.growThreads.toString().length)
      growRamLen = Math.max(growRamLen, ns.formatRam(growRam).length)
      weakenLen = Math.max(weakenLen, nc.weakenThreads.toString().length)
      weakenRamLen = Math.max(weakenRamLen, ns.formatRam(weakenRam).length)
      remainLen = Math.max(remainLen, ns.formatRam(remaining).length)
    }

    // Build table rows
    let tableRows = ""
    for (const nc of nodeCapacities) {
      const growRam = nc.growThreads * growScriptRam
      const weakenRam = nc.weakenThreads * weakenScriptRam
      const remaining = nc.availRam - growRam - weakenRam

      const server = nc.name.padEnd(serverLen)
      const availRam = ns.formatRam(nc.availRam).padStart(availRamLen)
      const grow = nc.growThreads.toString().padStart(growLen)
      const growRamStr = ns.formatRam(growRam).padStart(growRamLen)
      const weaken = nc.weakenThreads.toString().padStart(weakenLen)
      const weakenRamStr = ns.formatRam(weakenRam).padStart(weakenRamLen)
      const remain = ns.formatRam(remaining).padStart(remainLen)

      tableRows += `┃ ${server} ┃ ${availRam} ┃ ${grow} ┃ ${growRamStr} ┃ ${weaken} ┃ ${weakenRamStr} ┃ ${remain} ┃\n`
    }

    // Add script cost info
    const scriptInfo = `Grow: ${ns.formatRam(growScriptRam)}/t, Weaken: ${ns.formatRam(weakenScriptRam)}/t`

    // Build full table with box-drawing characters
    const fullTable =
      `\n═══ Iteration ${iteration} ═══ ${scriptInfo}\n` +
      `┏━${"━".repeat(serverLen)}━┳━${"━".repeat(availRamLen)}━┳━${"━".repeat(growLen)}━┳━${"━".repeat(growRamLen)}━┳━${"━".repeat(weakenLen)}━┳━${"━".repeat(weakenRamLen)}━┳━${"━".repeat(remainLen)}━┓\n` +
      `┃ ${serverCol.padEnd(serverLen)} ┃ ${availRamCol.padStart(availRamLen)} ┃ ${growCol.padStart(growLen)} ┃ ${growRamCol.padStart(growRamLen)} ┃ ${weakenCol.padStart(weakenLen)} ┃ ${weakenRamCol.padStart(weakenRamLen)} ┃ ${remainCol.padStart(remainLen)} ┃\n` +
      `┣━${"━".repeat(serverLen)}━╋━${"━".repeat(availRamLen)}━╋━${"━".repeat(growLen)}━╋━${"━".repeat(growRamLen)}━╋━${"━".repeat(weakenLen)}━╋━${"━".repeat(weakenRamLen)}━╋━${"━".repeat(remainLen)}━┫\n` +
      `${tableRows}` +
      `┗━${"━".repeat(serverLen)}━┻━${"━".repeat(availRamLen)}━┻━${"━".repeat(growLen)}━┻━${"━".repeat(growRamLen)}━┻━${"━".repeat(weakenLen)}━┻━${"━".repeat(weakenRamLen)}━┻━${"━".repeat(remainLen)}━┛`

    return fullTable
  }

  // Initialize XP tracking with Kahan summation for accuracy
  let xpKahan = createKahanSum(player.exp.hacking)

  // Simulate prep iterations
  let simSec = currentSec
  let simMoney = currentMoney
  let iterations = 0
  const maxIterations = 100 // Safety limit

  log(
    `[Prep Sim] Starting simulation - Money: ${ns.formatNumber(simMoney)}/${ns.formatNumber(moneyMax)} (${((simMoney / moneyMax) * 100).toFixed(1)}%), Security: ${simSec.toFixed(2)}/${baseSecurity.toFixed(2)} (+${(simSec - baseSecurity).toFixed(2)}), Player Level: ${player.skills.hacking}`
  )

  while ((simMoney < moneyMax * moneyTolerance || simSec > baseSecurity + secTolerance) && iterations < maxIterations) {
    iterations++

    // Calculate total available RAM across all nodes
    const currentTotalRam = nodes.reduce((sum, node) => {
      return sum + (ns.getServerMaxRam(node) - ns.getServerUsedRam(node))
    }, 0)

    log(
      `\n[Prep Sim] Iteration ${iterations} - Money: ${ns.formatNumber(simMoney)}/${ns.formatNumber(moneyMax)} (${((simMoney / moneyMax) * 100).toFixed(1)}%), Security: ${simSec.toFixed(2)}/${baseSecurity.toFixed(2)} (+${(simSec - baseSecurity).toFixed(2)}), Player Level: ${player.skills.hacking}`
    )

    let growThreads = 0
    let weakenThreads = 0

    const currentExcessSec = simSec - baseSecurity
    const needsMoney = simMoney < moneyMax * moneyTolerance
    const needsWeaken = currentExcessSec > secTolerance

    // Match the exact logic from prepareServerMultiNode
    if (needsMoney && needsWeaken) {
      // Calculate ideal threads
      const simServer = { ...server, hackDifficulty: simSec, moneyAvailable: simMoney }
      const growThreadsNeeded = Math.ceil(ns.formulas.hacking.growThreads(simServer, player, moneyMax, myCores))
      const growSecurityIncrease = ns.growthAnalyzeSecurity(growThreadsNeeded, undefined, myCores)
      const totalSecToReduce = currentExcessSec + growSecurityIncrease
      const weakenThreadsNeeded = calcWeakenThreads(totalSecToReduce)

      const totalRamNeeded = growThreadsNeeded * growScriptRam + weakenThreadsNeeded * weakenScriptRam

      // Can we do both?
      if (totalRamNeeded <= currentTotalRam) {
        growThreads = growThreadsNeeded
        weakenThreads = weakenThreadsNeeded
      } else {
        // Can't do both - prioritize weaken to min security first
        const weakenToMinThreads = calcWeakenThreads(currentExcessSec)
        const weakenToMinRam = weakenToMinThreads * weakenScriptRam

        if (weakenToMinRam <= currentTotalRam) {
          // We can weaken to min, check if we have RAM left for grow
          const remainingRam = currentTotalRam - weakenToMinRam
          const maxGrowThreads = Math.floor(remainingRam / growScriptRam)

          if (maxGrowThreads > 0) {
            // Add grow operations, but recalculate weaken to offset grow security
            growThreads = Math.min(growThreadsNeeded, maxGrowThreads)
            const growSecIncrease = ns.growthAnalyzeSecurity(growThreads, undefined, myCores)
            const totalSecWithGrow = currentExcessSec + growSecIncrease
            const weakenNeededWithGrow = calcWeakenThreads(totalSecWithGrow)

            // Verify we still have enough RAM for adjusted weaken
            const adjustedTotalRam = growThreads * growScriptRam + weakenNeededWithGrow * weakenScriptRam
            if (adjustedTotalRam <= currentTotalRam) {
              weakenThreads = weakenNeededWithGrow
            } else {
              // Adjusted weaken doesn't fit, just weaken to min without grow
              weakenThreads = weakenToMinThreads
              growThreads = 0
            }
          } else {
            // No RAM left for grow, just weaken to min
            weakenThreads = weakenToMinThreads
          }
        } else {
          // Can't even weaken to min in one go, use all RAM for weaken
          const maxWeakenThreads = Math.floor(currentTotalRam / weakenScriptRam)
          weakenThreads = Math.max(1, maxWeakenThreads)
        }
      }
    } else if (needsWeaken) {
      // Only need weaken
      const weakenThreadsNeeded = calcWeakenThreads(currentExcessSec)
      const maxWeakenThreads = Math.floor(currentTotalRam / weakenScriptRam)
      weakenThreads = Math.min(weakenThreadsNeeded, maxWeakenThreads)
    } else if (needsMoney) {
      // Only need grow (security already at min)
      const simServer = { ...server, hackDifficulty: simSec, moneyAvailable: simMoney }
      const growThreadsNeeded = Math.ceil(ns.formulas.hacking.growThreads(simServer, player, moneyMax, myCores))
      const growSecurityIncrease = ns.growthAnalyzeSecurity(growThreadsNeeded, undefined, myCores)

      // Need to offset grow security increase
      const weakenThreadsNeeded = calcWeakenThreads(growSecurityIncrease)
      const totalRamNeeded = growThreadsNeeded * growScriptRam + weakenThreadsNeeded * weakenScriptRam

      if (totalRamNeeded <= currentTotalRam) {
        growThreads = growThreadsNeeded
        weakenThreads = weakenThreadsNeeded
      } else {
        // Can't do full grow - calculate per-server to ensure grow+weaken fit together
        // For each server, find max grow threads that fit with their weaken on that server
        let totalGrow = 0
        let totalWeaken = 0

        for (const node of nodes) {
          const nodeRam = ns.getServerMaxRam(node) - ns.getServerUsedRam(node)

          // Binary search for max grow on this server that fits with its weaken
          let low = 1
          let high = Math.floor(nodeRam / growScriptRam)
          let bestNodeGrow = 0
          let bestNodeWeaken = 0

          while (low <= high) {
            const mid = Math.floor((low + high) / 2)
            const nodeGrowSecIncrease = ns.growthAnalyzeSecurity(mid, undefined, myCores)
            const nodeWeakenNeeded = calcWeakenThreads(nodeGrowSecIncrease)
            const nodeRamNeeded = mid * growScriptRam + nodeWeakenNeeded * weakenScriptRam

            if (nodeRamNeeded <= nodeRam) {
              // This fits on this server, try for more
              bestNodeGrow = mid
              bestNodeWeaken = nodeWeakenNeeded
              low = mid + 1
            } else {
              // Too much, try less
              high = mid - 1
            }
          }

          totalGrow += bestNodeGrow
          totalWeaken += bestNodeWeaken

          // Stop if we've reached our goal
          if (totalGrow >= growThreadsNeeded) {
            totalGrow = growThreadsNeeded
            // Recalculate total weaken needed for the actual grow amount
            const actualGrowSecIncrease = ns.growthAnalyzeSecurity(totalGrow, undefined, myCores)
            totalWeaken = calcWeakenThreads(actualGrowSecIncrease)
            break
          }
        }

        growThreads = totalGrow
        weakenThreads = totalWeaken
      }
    }

    // If we can't make progress, break
    if (growThreads === 0 && weakenThreads === 0) {
      log(`[Prep Sim] ERROR: No progress possible - insufficient RAM`)
      break
    }

    // Simulate distribution and build capacity table
    const distribution = simulateDistribution(growThreads, weakenThreads)
    const actualGrowThreads = distribution.actualGrowThreads
    const actualWeakenThreads = distribution.actualWeakenThreads

    // Build and log capacity table
    const table = buildCapacityTable(distribution.nodeCapacities, iterations)
    log(table)

    // Update simulated state with actual distributed threads
    if (actualGrowThreads > 0) {
      const simServer = { ...server, hackDifficulty: simSec, moneyAvailable: simMoney }
      const growMultiplier = ns.formulas.hacking.growPercent(simServer, actualGrowThreads, player, myCores)
      simMoney = Math.min(moneyMax, simMoney * growMultiplier)
      const growSecurityIncrease = ns.growthAnalyzeSecurity(actualGrowThreads, undefined, myCores)
      simSec += growSecurityIncrease

      // Calculate and track XP gain from grow
      const growXp = calculateOperationXp(simServer, player, actualGrowThreads, ns)
      xpKahan = kahanAdd(xpKahan, growXp)
    }

    if (actualWeakenThreads > 0) {
      const weakenAmount = 0.05 * actualWeakenThreads * (1 + (myCores - 1) / 16)
      simSec = Math.max(baseSecurity, simSec - weakenAmount)

      // Calculate and track XP gain from weaken
      const simServer = { ...server, hackDifficulty: simSec, moneyAvailable: simMoney }
      const weakenXp = calculateOperationXp(simServer, player, actualWeakenThreads, ns)
      xpKahan = kahanAdd(xpKahan, weakenXp)
    }

    // Update player with accumulated XP and recalculate level
    const previousLevel = player.skills.hacking
    player = updatePlayerWithKahanXp(player, xpKahan, ns)
    if (player.skills.hacking > previousLevel) {
      log(`  Player leveled up! ${previousLevel} -> ${player.skills.hacking}`)
    }
  }

  // Calculate total time based on weaken time (longest operation)
  const weakenTime = ns.formulas.hacking.weakenTime(server, player)
  const totalTime = weakenTime * iterations

  log(
    `\n[Prep Sim] Complete - ${iterations} iterations, estimated time: ${ns.tFormat(totalTime)}, final player level: ${player.skills.hacking}`
  )

  // Display verbose output if requested
  if (showVerbose) {
    ns.tprint(verboseOutput)
  }

  return totalTime
}

/**
 * Prepare a server using multiple nodes for distributed RAM
 * Prioritization logic:
 * 1. If we can run both weaken (to offset current security + grow security) and grow in one iteration, do both
 * 2. Otherwise, prioritize weaken to min security first
 * 3. If we have RAM left after weakening to min, add grow operations and adjust weaken threads to offset the grow security increase
 */
export async function prepareServerMultiNode(ns: NS, nodes: string[], target: string) {
  const moneyMax = ns.getServerMaxMoney(target)
  const baseSecurity = ns.getServerMinSecurityLevel(target)
  const secTolerance = 0
  const moneyTolerance = 1

  // Use cores from first node (assume all nodes have same cores)
  const myCores = ns.getServer(nodes[0]).cpuCores

  const growScriptRam = ns.getScriptRam("/hacking/grow.js")
  const weakenScriptRam = ns.getScriptRam("/hacking/weaken.js")

  const totalAvailableRam = nodes.reduce((sum, node) => {
    return sum + (ns.getServerMaxRam(node) - ns.getServerUsedRam(node))
  }, 0)

  ns.tprint(
    `Prep: Starting multi-node preparation with ${ns.formatRam(totalAvailableRam)} total available RAM across ${nodes.length} nodes`
  )

  // Loop until server is prepared
  while (true) {
    const player = ns.getPlayer()
    const serverActual = ns.getServer(target)
    const currentMoney = serverActual.moneyAvailable ?? 0
    const currentSec = serverActual.hackDifficulty ?? 0

    // Check if preparation is complete
    if (currentMoney >= moneyMax * moneyTolerance && currentSec <= baseSecurity + secTolerance) {
      ns.tprint(
        `Prep: Complete - Money: ${ns.formatNumber(currentMoney)}/${ns.formatNumber(moneyMax)}, Security: ${currentSec.toFixed(2)}/${baseSecurity}`
      )
      break
    }

    // Calculate total available RAM across all nodes
    const currentTotalRam = nodes.reduce((sum, node) => {
      return sum + (ns.getServerMaxRam(node) - ns.getServerUsedRam(node))
    }, 0)

    let growThreads = 0
    let weakenThreads = 0

    const currentExcessSec = currentSec - baseSecurity
    const needsMoney = currentMoney < moneyMax * moneyTolerance
    const needsWeaken = currentExcessSec > secTolerance

    // Helper to calculate weaken threads needed for a given security reduction
    const calcWeakenThreads = (secToReduce: number): number => {
      if (secToReduce <= 0) return 0
      return Math.ceil(secToReduce / (0.05 * (1 + (myCores - 1) / 16)))
    }

    // Strategy 1: Try to do both weaken and grow in one go (ideal case)
    if (needsMoney && needsWeaken) {
      // Calculate ideal threads
      const growThreadsNeeded = Math.ceil(ns.formulas.hacking.growThreads(serverActual, player, moneyMax, myCores))
      const growSecurityIncrease = ns.growthAnalyzeSecurity(growThreadsNeeded, undefined, myCores)
      const totalSecToReduce = currentExcessSec + growSecurityIncrease
      const weakenThreadsNeeded = calcWeakenThreads(totalSecToReduce)

      const totalRamNeeded = growThreadsNeeded * growScriptRam + weakenThreadsNeeded * weakenScriptRam

      // Can we do both?
      if (totalRamNeeded <= currentTotalRam) {
        growThreads = growThreadsNeeded
        weakenThreads = weakenThreadsNeeded
      } else {
        // Can't do both - prioritize weaken to min security first
        const weakenToMinThreads = calcWeakenThreads(currentExcessSec)
        const weakenToMinRam = weakenToMinThreads * weakenScriptRam

        if (weakenToMinRam <= currentTotalRam) {
          // We can weaken to min, check if we have RAM left for grow
          const remainingRam = currentTotalRam - weakenToMinRam
          const maxGrowThreads = Math.floor(remainingRam / growScriptRam)

          if (maxGrowThreads > 0) {
            // Add grow operations, but recalculate weaken to offset grow security
            growThreads = Math.min(growThreadsNeeded, maxGrowThreads)
            const growSecIncrease = ns.growthAnalyzeSecurity(growThreads, undefined, myCores)
            const totalSecWithGrow = currentExcessSec + growSecIncrease
            const weakenNeededWithGrow = calcWeakenThreads(totalSecWithGrow)

            // Verify we still have enough RAM for adjusted weaken
            const adjustedTotalRam = growThreads * growScriptRam + weakenNeededWithGrow * weakenScriptRam
            if (adjustedTotalRam <= currentTotalRam) {
              weakenThreads = weakenNeededWithGrow
            } else {
              // Adjusted weaken doesn't fit, just weaken to min without grow
              weakenThreads = weakenToMinThreads
              growThreads = 0
            }
          } else {
            // No RAM left for grow, just weaken to min
            weakenThreads = weakenToMinThreads
          }
        } else {
          // Can't even weaken to min in one go, use all RAM for weaken
          const maxWeakenThreads = Math.floor(currentTotalRam / weakenScriptRam)
          weakenThreads = Math.max(1, maxWeakenThreads)
        }
      }
    } else if (needsWeaken) {
      // Only need weaken
      const weakenThreadsNeeded = calcWeakenThreads(currentExcessSec)
      const maxWeakenThreads = Math.floor(currentTotalRam / weakenScriptRam)
      weakenThreads = Math.min(weakenThreadsNeeded, maxWeakenThreads)
    } else if (needsMoney) {
      // Only need grow (security already at min)
      const growThreadsNeeded = Math.ceil(ns.formulas.hacking.growThreads(serverActual, player, moneyMax, myCores))
      const growSecurityIncrease = ns.growthAnalyzeSecurity(growThreadsNeeded, undefined, myCores)

      // Need to offset grow security increase
      const weakenThreadsNeeded = calcWeakenThreads(growSecurityIncrease)
      const totalRamNeeded = growThreadsNeeded * growScriptRam + weakenThreadsNeeded * weakenScriptRam

      if (totalRamNeeded <= currentTotalRam) {
        growThreads = growThreadsNeeded
        weakenThreads = weakenThreadsNeeded
      } else {
        // Can't do full grow, calculate what we can fit
        const maxGrowThreads = Math.floor(currentTotalRam / growScriptRam)
        if (maxGrowThreads > 0) {
          growThreads = Math.min(growThreadsNeeded, maxGrowThreads)

          // Recalculate weaken for actual grow threads
          const actualGrowSecIncrease = ns.growthAnalyzeSecurity(growThreads, undefined, myCores)
          const actualWeakenNeeded = calcWeakenThreads(actualGrowSecIncrease)
          const ramAfterGrow = currentTotalRam - growThreads * growScriptRam
          weakenThreads = Math.min(actualWeakenNeeded, Math.floor(ramAfterGrow / weakenScriptRam))
        }
        // If maxGrowThreads is 0, we can't grow at all - leave both at 0
      }
    }

    // Distribute threads across nodes
    const pids: number[] = []

    // Helper function to distribute threads across nodes
    const distributeThreads = (threads: number, scriptRam: number, scriptPath: string) => {
      let remaining = threads
      for (const node of nodes) {
        if (remaining === 0) break
        const availableRam = ns.getServerMaxRam(node) - ns.getServerUsedRam(node)
        const maxThreads = Math.floor(availableRam / scriptRam)
        const threadsToRun = Math.min(remaining, maxThreads)
        if (threadsToRun > 0) {
          const pid = ns.exec(scriptPath, node, threadsToRun, target, 0)
          if (pid > 0) pids.push(pid)
          remaining -= threadsToRun
        }
      }
      return remaining
    }

    // Launch operations
    distributeThreads(growThreads, growScriptRam, "/hacking/grow.js")
    distributeThreads(weakenThreads, weakenScriptRam, "/hacking/weaken.js")

    // Wait for all launched operations to complete
    if (pids.length > 0) {
      const growTime = growThreads > 0 ? ns.formulas.hacking.growTime(serverActual, player) : 0
      const weakenTime = weakenThreads > 0 ? ns.formulas.hacking.weakenTime(serverActual, player) : 0
      const estimatedTime = Math.max(growTime, weakenTime)
      await ns.sleep(estimatedTime)

      while (pids.some((pid) => ns.isRunning(pid))) {
        await ns.sleep(100)
      }
    } else {
      // No operations could be launched (not enough RAM), wait a bit and retry
      await ns.sleep(500)
    }
  }

  return { moneyMax, baseSecurity, secTolerance, myCores }
}

export async function prepareServer(ns: NS, host: string, target: string) {
  const moneyMax = ns.getServerMaxMoney(target)
  const baseSecurity = ns.getServerMinSecurityLevel(target)
  const secTolerance = 0
  const moneyTolerance = 1

  const myCores = ns.getServer(host).cpuCores

  const growScriptRam = ns.getScriptRam("/hacking/grow.js")
  const weakenScriptRam = ns.getScriptRam("/hacking/weaken.js")
  const availableRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host)

  ns.tprint(`Prep: Starting preparation with ${ns.formatRam(availableRam)} available RAM`)

  // Loop until server is prepared
  while (true) {
    // Update server and player state at the start of each iteration
    const player = ns.getPlayer()
    const serverActual = ns.getServer(target)
    const currentMoney = serverActual.moneyAvailable ?? 0
    const currentSec = serverActual.hackDifficulty ?? 0

    // Check if preparation is complete
    if (currentMoney >= moneyMax * moneyTolerance && currentSec <= baseSecurity + secTolerance) {
      ns.tprint(
        `Prep: Complete - Money: ${ns.formatNumber(currentMoney)}/${ns.formatNumber(moneyMax)}, Security: ${currentSec.toFixed(2)}/${baseSecurity}`
      )
      break
    }

    const currentAvailableRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host)

    let growThreads = 0
    let weakenThreads = 0

    // Calculate threads needed for grow
    if (currentMoney < moneyMax * moneyTolerance) {
      const growThreadsNeeded = Math.ceil(ns.formulas.hacking.growThreads(serverActual, player, moneyMax, myCores))
      const maxGrowThreads = Math.floor(currentAvailableRam / growScriptRam)
      growThreads = Math.min(growThreadsNeeded, maxGrowThreads)
    }

    // Calculate threads needed for weaken using remaining RAM
    // Need to reduce current excess security PLUS security added by grow
    const currentExcessSec = currentSec - baseSecurity
    const growSecurityIncrease = growThreads > 0 ? ns.growthAnalyzeSecurity(growThreads, undefined, myCores) : 0
    const totalSecToReduce = currentExcessSec + growSecurityIncrease

    if (totalSecToReduce > secTolerance) {
      const weakenThreadsNeeded = Math.max(1, Math.ceil(totalSecToReduce / (0.05 * (1 + (myCores - 1) / 16))))
      const ramAfterGrow = currentAvailableRam - growThreads * growScriptRam
      const maxWeakenThreads = Math.floor(ramAfterGrow / weakenScriptRam)
      weakenThreads = Math.min(weakenThreadsNeeded, maxWeakenThreads)
    }

    // Launch both operations immediately (no delay between them)
    const pids: number[] = []

    if (growThreads > 0) {
      const pid = ns.exec("/hacking/grow.js", host, growThreads, target, 0)
      if (pid > 0) pids.push(pid)
    }

    if (weakenThreads > 0) {
      const pid = ns.exec("/hacking/weaken.js", host, weakenThreads, target, 0)
      if (pid > 0) pids.push(pid)
    }

    // Wait for all launched operations to complete
    if (pids.length > 0) {
      // Calculate wait time based on which operations we actually launched
      const growTime = growThreads > 0 ? ns.formulas.hacking.growTime(serverActual, player) : 0
      const weakenTime = weakenThreads > 0 ? ns.formulas.hacking.weakenTime(serverActual, player) : 0

      // If we only ran grow (no weaken due to insufficient RAM), only wait for grow time
      // Otherwise wait for the longer of the two operations
      const estimatedTime = Math.max(growTime, weakenTime)
      await ns.sleep(estimatedTime)

      // Then verify all scripts have actually finished
      while (pids.some((pid) => ns.isRunning(pid))) {
        await ns.sleep(100)
      }
    } else {
      // No operations could be launched (not enough RAM), wait a bit and retry
      await ns.sleep(500)
    }
  }

  return { moneyMax, baseSecurity, secTolerance, myCores }
}

export interface ServerPrepInfo {
  name: string
  weakenTime: number
}

export function getServersToPrep(
  ns: NS,
  targetServer: string,
  targetWeakenTime: number,
  enableParallel: boolean,
  totalMaxRam: number,
  prepScriptRam: number
): ServerPrepInfo[] {
  const serversToPrep: ServerPrepInfo[] = [{ name: targetServer, weakenTime: targetWeakenTime }]

  if (!enableParallel) {
    return serversToPrep
  }

  const player = ns.getPlayer()
  const knownServers = new Set<string>()

  crawl(ns, knownServers)

  const otherServers: ServerPrepInfo[] = []
  for (const serverName of knownServers) {
    if (serverName === targetServer) continue

    const srv = ns.getServer(serverName)
    if (!srv.hasAdminRights || !srv.moneyMax || srv.requiredHackingSkill! > player.skills.hacking) continue

    // Check if server needs prep
    const securityDiff = (srv.hackDifficulty ?? 0) - (srv.minDifficulty ?? 0)
    const moneyRatio = (srv.moneyAvailable ?? 0) / (srv.moneyMax ?? 1)
    const needsPrep = securityDiff > 0 || moneyRatio < 1

    if (needsPrep) {
      const serverWeakenTime = ns.formulas.hacking.weakenTime(srv, player)
      // Only include servers with weaken time less than or equal to target's weaken time
      if (serverWeakenTime <= targetWeakenTime) {
        otherServers.push({ name: serverName, weakenTime: serverWeakenTime })
      }
    }
  }

  // Sort by weaken time (shortest first)
  otherServers.sort((a, b) => a.weakenTime - b.weakenTime)

  // Check how many other servers we can fit
  let totalPrepRamNeeded = prepScriptRam
  for (const srv of otherServers) {
    const nextRamNeeded = totalPrepRamNeeded + prepScriptRam
    if (nextRamNeeded <= totalMaxRam * 0.9) {
      serversToPrep.push(srv)
      totalPrepRamNeeded = nextRamNeeded
    } else {
      break
    }
  }

  return serversToPrep
}
