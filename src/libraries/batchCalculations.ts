import { NS, Person, Player, Server } from "@ns"
import { crawl } from "./crawl.js"
import { buildTable } from "./tableBuilder.js"
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
    updatedPlayer.mults.hacking * ns.getBitNodeMultipliers().HackingLevelMultiplier
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
    updatedPlayer.mults.hacking * ns.getBitNodeMultipliers().HackingLevelMultiplier
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

/**
 * Calculate grow threads needed to reach target money, with configurable thread top-up.
 * The top-up ensures we don't fall short due to rounding or precision issues.
 * @param topUp - Multiplier or additive amount to apply. Default adds 1 thread.
 *                Examples: 1 (add 1 thread), 1.1 (multiply by 1.1), 1.05 (multiply by 1.05)
 */
export function calculateGrowThreads(
  server: Server,
  player: Person,
  moneyMax: number,
  myCores: number,
  ns: NS,
  topUp: number = 1.1
) {
  const baseThreads = ns.formulas.hacking.growThreads(server, player, moneyMax, myCores)
  if (topUp > 1 && topUp < 2) {
    return Math.ceil(baseThreads * topUp)
  } else {
    return Math.ceil(baseThreads + topUp)
  }
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
 * Prepare a server using multiple nodes for distributed RAM, or simulate it
 * When dryRun=true, simulates the prep process and returns timing estimates
 * When dryRun=false, executes the actual prep and optionally compares to predictions
 *
 * @param ns - Netscript API
 * @param nodes - Array of server names to use for prep operations
 * @param target - Target server to prepare
 * @param options - Configuration options
 * @param options.dryRun - If true, only simulates without executing (default: false)
 * @param options.showVerbose - If true and dryRun=true, displays detailed simulation output
 * @param options.predictedIterations - If provided and dryRun=false, compares actual vs predicted
 * @param options.debug - If true and dryRun=false, displays execution debug info
 */
export async function prepareServerMultiNode(
  ns: NS,
  nodes: string[],
  target: string,
  options: {
    dryRun?: boolean
    showVerbose?: boolean
    predictedIterations?: Array<{
      iteration: number
      time: number
      moneyBefore: number
      moneyAfter: number
      secBefore: number
      secAfter: number
      playerLevel: number
    }>
    debug?: boolean
  } = {}
): Promise<{
  totalTime: number
  iterationDetails: Array<{
    iteration: number
    time: number
    moneyBefore: number
    moneyAfter: number
    secBefore: number
    secAfter: number
    playerLevel: number
  }>
  moneyMax?: number
  baseSecurity?: number
  secTolerance?: number
  myCores?: number
}> {
  const { dryRun = false, showVerbose = false, predictedIterations, debug = false } = options
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
    return { totalTime: 0, iterationDetails: [] }
  }

  const myCores = ns.getServer(nodes[0]).cpuCores
  const growScriptRam = ns.getScriptRam("/hacking/grow.js")
  const weakenScriptRam = ns.getScriptRam("/hacking/weaken.js")

  // Accumulate verbose output
  let verboseOutput = ""
  const log = (msg: string) => {
    verboseOutput += msg + "\n"
    if (showVerbose) {
      ns.tprint(msg)
    }
  }

  // Helper to calculate weaken threads needed for a given security reduction
  const calcWeakenThreads = (secToReduce: number): number => {
    if (secToReduce <= 0) return 0
    return Math.ceil(secToReduce / (0.05 * (1 + (myCores - 1) / 16)))
  }

  // Helper to calculate optimal grow and weaken threads by simulating distribution across nodes
  // This ensures we calculate exactly what we can actually fit and execute
  const calculateThreadsWithDistribution = (
    currentServer: Server,
    currentPlayer: Player,
    currentExcessSec: number
  ): { growThreads: number; weakenThreads: number; nodeCapacities: NodeCapacity[] } => {
    const needsMoney = (currentServer.moneyAvailable ?? 0) < moneyMax * moneyTolerance
    const needsWeaken = currentExcessSec > secTolerance

    // If we need both money and weaken, use binary search to find optimal grow amount
    // that can be distributed across nodes with enough weaken to reach min security
    if (needsMoney && needsWeaken) {
      const growThreadsIdeal = calculateGrowThreads(currentServer, currentPlayer, moneyMax, myCores, ns)

      // Binary search for maximum grow threads that:
      // 1. Can be distributed across nodes
      // 2. Has enough weaken to reach minimum security
      let low = 0
      let high = growThreadsIdeal
      let bestResult: { grow: number; weaken: number; nodes: NodeCapacity[] } | null = null

      while (low <= high) {
        const mid = Math.floor((low + high) / 2)

        // Calculate weaken needed to reach min security with this grow amount
        const growSecIncrease = mid > 0 ? ns.growthAnalyzeSecurity(mid, undefined, myCores) : 0
        const totalSecToReduce = currentExcessSec + growSecIncrease
        const weakenNeeded = calcWeakenThreads(totalSecToReduce)

        // Try to distribute these threads across nodes
        const distribution = tryDistributeThreads(mid, weakenNeeded)

        // Check if we successfully distributed everything AND will reach min security
        const weakenAmount = 0.05 * distribution.actualWeakenThreads * (1 + (myCores - 1) / 16)
        const willReachMinSec = weakenAmount >= totalSecToReduce - 0.01

        if (
          distribution.actualGrowThreads === mid &&
          distribution.actualWeakenThreads === weakenNeeded &&
          willReachMinSec
        ) {
          // Success! Try for more grow
          bestResult = {
            grow: distribution.actualGrowThreads,
            weaken: distribution.actualWeakenThreads,
            nodes: distribution.nodeCapacities,
          }
          low = mid + 1
        } else {
          // Couldn't fit everything or won't reach min sec, try less grow
          high = mid - 1
        }
      }

      // If we found a valid solution, use it
      if (bestResult) {
        return {
          growThreads: bestResult.grow,
          weakenThreads: bestResult.weaken,
          nodeCapacities: bestResult.nodes,
        }
      }

      // Otherwise, do pure weaken
      const pureWeakenNeeded = calcWeakenThreads(currentExcessSec)
      const pureWeakenDist = tryDistributeThreads(0, pureWeakenNeeded)
      return {
        growThreads: 0,
        weakenThreads: pureWeakenDist.actualWeakenThreads,
        nodeCapacities: pureWeakenDist.nodeCapacities,
      }
    } else if (needsWeaken) {
      // Only need weaken
      const weakenNeeded = calcWeakenThreads(currentExcessSec)
      const distribution = tryDistributeThreads(0, weakenNeeded)
      return {
        growThreads: 0,
        weakenThreads: distribution.actualWeakenThreads,
        nodeCapacities: distribution.nodeCapacities,
      }
    } else if (needsMoney) {
      // Only need grow (security already at min) - must offset grow's security increase
      const growThreadsIdeal = calculateGrowThreads(currentServer, currentPlayer, moneyMax, myCores, ns)

      // Binary search for maximum grow threads that can be distributed with enough weaken to offset security
      let low = 0
      let high = growThreadsIdeal
      let bestResult: { grow: number; weaken: number; nodes: NodeCapacity[] } | null = null

      while (low <= high) {
        const mid = Math.floor((low + high) / 2)

        // Calculate weaken needed to offset this grow's security increase
        const growSecIncrease = mid > 0 ? ns.growthAnalyzeSecurity(mid, undefined, myCores) : 0
        const weakenNeeded = calcWeakenThreads(growSecIncrease)

        // Try to distribute these threads across nodes
        const distribution = tryDistributeThreads(mid, weakenNeeded)

        // Check if we successfully distributed everything AND will maintain min security
        const weakenAmount = 0.05 * distribution.actualWeakenThreads * (1 + (myCores - 1) / 16)
        const willMaintainMinSec = weakenAmount >= growSecIncrease - 0.01

        if (
          distribution.actualGrowThreads === mid &&
          distribution.actualWeakenThreads === weakenNeeded &&
          willMaintainMinSec
        ) {
          // Success! Try for more grow
          bestResult = {
            grow: distribution.actualGrowThreads,
            weaken: distribution.actualWeakenThreads,
            nodes: distribution.nodeCapacities,
          }
          low = mid + 1
        } else {
          // Couldn't fit everything or won't maintain min sec, try less grow
          high = mid - 1
        }
      }

      // Return best result found (or nothing if we couldn't fit any grow+weaken)
      if (bestResult) {
        return {
          growThreads: bestResult.grow,
          weakenThreads: bestResult.weaken,
          nodeCapacities: bestResult.nodes,
        }
      }

      // If we couldn't fit any grow with its required weaken, return empty
      return { growThreads: 0, weakenThreads: 0, nodeCapacities: [] }
    }

    // Nothing needed
    return { growThreads: 0, weakenThreads: 0, nodeCapacities: [] }
  }

  // Helper to try distributing grow and weaken threads across nodes
  // Returns what was actually distributed
  const tryDistributeThreads = (
    growThreadsTarget: number,
    weakenThreadsTarget: number
  ): {
    actualGrowThreads: number
    actualWeakenThreads: number
    nodeCapacities: NodeCapacity[]
  } => {
    const nodeCapacities: NodeCapacity[] = []
    let remainingGrow = growThreadsTarget
    let remainingWeaken = weakenThreadsTarget

    for (const node of nodes) {
      const totalRam = ns.getServerMaxRam(node)
      const usedRam = ns.getServerUsedRam(node)
      const availRam = totalRam - usedRam
      let nodeGrowThreads = 0
      let nodeWeakenThreads = 0

      if (remainingGrow > 0 || remainingWeaken > 0) {
        // Prioritize grow+weaken pairs, then fill remaining space
        const wantGrow = Math.min(remainingGrow, Math.floor(availRam / growScriptRam))
        const wantWeaken = Math.min(remainingWeaken, Math.floor(availRam / weakenScriptRam))

        // Can we fit both what we want?
        const ramForBoth = wantGrow * growScriptRam + wantWeaken * weakenScriptRam
        if (ramForBoth <= availRam) {
          // Yes, take everything we want
          nodeGrowThreads = wantGrow
          nodeWeakenThreads = wantWeaken
        } else if (remainingGrow > 0 && remainingWeaken > 0) {
          // Need to find a balance - binary search for max grow that leaves room for weaken
          let low = 0
          let high = wantGrow
          let bestGrow = 0
          let bestWeaken = 0

          while (low <= high) {
            const mid = Math.floor((low + high) / 2)
            const ramAfterGrow = availRam - mid * growScriptRam
            const weakenThatFits = Math.min(remainingWeaken, Math.floor(ramAfterGrow / weakenScriptRam))

            if (mid * growScriptRam + weakenThatFits * weakenScriptRam <= availRam) {
              bestGrow = mid
              bestWeaken = weakenThatFits
              low = mid + 1
            } else {
              high = mid - 1
            }
          }

          nodeGrowThreads = bestGrow
          nodeWeakenThreads = bestWeaken
        } else if (remainingGrow > 0) {
          // Only grow left
          nodeGrowThreads = wantGrow
        } else {
          // Only weaken left
          nodeWeakenThreads = wantWeaken
        }

        remainingGrow -= nodeGrowThreads
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
      actualGrowThreads: growThreadsTarget - remainingGrow,
      actualWeakenThreads: weakenThreadsTarget - remainingWeaken,
      nodeCapacities,
    }
  }

  // Interface for node capacity tracking
  interface NodeCapacity {
    name: string
    availRam: number
    growThreads: number
    weakenThreads: number
    usedRam: number
    totalRam: number
  }

  // Helper to build table from node capacities
  const buildCapacityTable = (nodeCapacities: NodeCapacity[], iteration: number): string => {
    // Add script cost info
    const scriptInfo = `Grow: ${ns.formatRam(growScriptRam)}/t, Weaken: ${ns.formatRam(weakenScriptRam)}/t`

    const fullTable = buildTable({
      title: `Iteration ${iteration} ═══ ${scriptInfo}`,
      columns: [
        { header: "Server", align: "left" },
        { header: "Avail", align: "right" },
        { header: "G", align: "right" },
        { header: "G RAM", align: "right" },
        { header: "W", align: "right" },
        { header: "W RAM", align: "right" },
        { header: "Left", align: "right" },
      ],
      rows: nodeCapacities.map((nc) => {
        const growRam = nc.growThreads * growScriptRam
        const weakenRam = nc.weakenThreads * weakenScriptRam
        const remaining = nc.availRam - growRam - weakenRam

        return [
          nc.name,
          ns.formatRam(nc.availRam),
          nc.growThreads.toString(),
          ns.formatRam(growRam),
          nc.weakenThreads.toString(),
          ns.formatRam(weakenRam),
          ns.formatRam(remaining),
        ]
      }),
    })

    return fullTable
  }

  // Branch based on dryRun mode
  if (dryRun) {
    // ========== SIMULATION MODE ==========
    // Initialize XP tracking with Kahan summation for accuracy
    let xpKahan = createKahanSum(player.exp.hacking)

    // Simulate prep iterations
    let simSec = currentSec
    let simMoney = currentMoney
    let iterations = 0
    const maxIterations = 100 // Safety limit
    let totalTime = 0 // Track cumulative time across iterations
    const iterationDetails: Array<{
      iteration: number
      time: number
      moneyBefore: number
      moneyAfter: number
      secBefore: number
      secAfter: number
      playerLevel: number
    }> = []

    log(
      `[Prep Sim] Starting simulation - Money: ${ns.formatNumber(simMoney)}/${ns.formatNumber(moneyMax)} (${((simMoney / moneyMax) * 100).toFixed(1)}%), Security: ${simSec.toFixed(2)}/${baseSecurity.toFixed(2)} (+${(simSec - baseSecurity).toFixed(2)}), Player Level: ${player.skills.hacking}`
    )

    while (
      (simMoney < moneyMax * moneyTolerance || simSec > baseSecurity + secTolerance) &&
      iterations < maxIterations
    ) {
      iterations++

      // Track state before this iteration
      const moneyBefore = simMoney
      const secBefore = simSec
      const playerLevelBefore = player.skills.hacking

      // Calculate iteration time BEFORE any state changes (this is when operations are launched)
      const iterationStartServer = { ...server, hackDifficulty: simSec, moneyAvailable: simMoney }
      const iterationTime = ns.formulas.hacking.weakenTime(iterationStartServer, player)

      log(
        `\n[Prep Sim] Iteration ${iterations} - Money: ${ns.formatNumber(simMoney)}/${ns.formatNumber(moneyMax)} (${((simMoney / moneyMax) * 100).toFixed(1)}%), Security: ${simSec.toFixed(2)}/${baseSecurity.toFixed(2)} (+${(simSec - baseSecurity).toFixed(2)}), Player Level: ${player.skills.hacking}`
      )

      // Calculate threads using distribution-aware helper
      const simServer = { ...server, hackDifficulty: simSec, moneyAvailable: simMoney }
      const currentExcessSec = simSec - baseSecurity
      const { growThreads, weakenThreads, nodeCapacities } = calculateThreadsWithDistribution(
        simServer,
        player,
        currentExcessSec
      )

      // If we can't make progress, break
      if (growThreads === 0 && weakenThreads === 0) {
        log(`[Prep Sim] ERROR: No progress possible - insufficient RAM`)
        break
      }

      const actualGrowThreads = growThreads
      const actualWeakenThreads = weakenThreads

      // Build and log capacity table
      const table = buildCapacityTable(nodeCapacities, iterations)
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
        player = updatePlayerWithXp(player, growXp, ns)
      }

      if (actualWeakenThreads > 0) {
        const weakenAmount = 0.05 * actualWeakenThreads * (1 + (myCores - 1) / 16)
        simSec = Math.max(baseSecurity, simSec - weakenAmount)

        // Calculate and track XP gain from weaken
        const simServer = { ...server, hackDifficulty: simSec, moneyAvailable: simMoney }
        const weakenXp = calculateOperationXp(simServer, player, actualWeakenThreads, ns)
        xpKahan = kahanAdd(xpKahan, weakenXp)
        player = updatePlayerWithXp(player, weakenXp, ns)
      }

      // Update player with accumulated XP and recalculate level
      // const previousLevel = player.skills.hacking
      // player = updatePlayerWithKahanXp(player, xpKahan, ns)
      // if (player.skills.hacking > previousLevel) {
      //   log(`  Player leveled up! ${previousLevel} -> ${player.skills.hacking}`)
      // }

      // Add iteration time to total (calculated at start of iteration)
      totalTime += iterationTime

      // Save iteration details
      iterationDetails.push({
        iteration: iterations,
        time: iterationTime,
        moneyBefore,
        moneyAfter: simMoney,
        secBefore,
        secAfter: simSec,
        playerLevel: playerLevelBefore, // Use level at start of iteration
      })
    }

    log(
      `\n[Prep Sim] Complete - ${iterations} iterations, estimated time: ${ns.tFormat(totalTime)}, final player level: ${player.skills.hacking}`
    )

    // Display verbose output if requested
    if (showVerbose) {
      ns.tprint(verboseOutput)
    }

    return { totalTime, iterationDetails, moneyMax, baseSecurity, secTolerance, myCores }
  } else {
    // ========== EXECUTION MODE ==========
    const totalAvailableRam = nodes.reduce((sum, node) => {
      return sum + (ns.getServerMaxRam(node) - ns.getServerUsedRam(node))
    }, 0)

    if (debug) {
      ns.tprint(
        `Prep: Starting multi-node preparation with ${ns.formatRam(totalAvailableRam)} total available RAM across ${nodes.length} nodes`
      )
    }

    // Track iterations for comparison
    let iterationCount = 0
    const iterationDetails: Array<{
      iteration: number
      time: number
      moneyBefore: number
      moneyAfter: number
      secBefore: number
      secAfter: number
      playerLevel: number
    }> = []

    // Loop until server is prepared
    while (true) {
      player = ns.getPlayer()
      const serverActual = ns.getServer(target)
      const currentMoneyActual = serverActual.moneyAvailable ?? 0
      const currentSecActual = serverActual.hackDifficulty ?? 0

      // Check if preparation is complete
      if (currentMoneyActual >= moneyMax * moneyTolerance && currentSecActual <= baseSecurity + secTolerance) {
        if (debug) {
          ns.tprint(
            `Prep: Complete - Money: ${ns.formatNumber(currentMoneyActual)}/${ns.formatNumber(moneyMax)}, Security: ${currentSecActual.toFixed(2)}/${baseSecurity}`
          )
        }
        break
      }

      iterationCount++
      const iterationStartTime = Date.now()
      const moneyBefore = currentMoneyActual
      const secBefore = currentSecActual
      const playerLevelBefore = player.skills.hacking

      // Calculate threads using distribution-aware helper
      const currentExcessSec = currentSecActual - baseSecurity
      const { growThreads, weakenThreads, nodeCapacities } = calculateThreadsWithDistribution(
        serverActual,
        player,
        currentExcessSec
      )

      const pids: number[] = []

      // Execute on each node based on distribution
      for (const nodeCapacity of nodeCapacities) {
        if (nodeCapacity.growThreads > 0) {
          const pid = ns.exec("/hacking/grow.js", nodeCapacity.name, nodeCapacity.growThreads, target, 0)
          if (pid > 0) pids.push(pid)
        }
        if (nodeCapacity.weakenThreads > 0) {
          const pid = ns.exec("/hacking/weaken.js", nodeCapacity.name, nodeCapacity.weakenThreads, target, 0)
          if (pid > 0) pids.push(pid)
        }
      }

      // Wait for all operations to complete
      if (pids.length > 0) {
        const growTime = growThreads > 0 ? ns.formulas.hacking.growTime(serverActual, player) : 0
        const weakenTime = weakenThreads > 0 ? ns.formulas.hacking.weakenTime(serverActual, player) : 0
        const estimatedTime = Math.max(growTime, weakenTime)
        await ns.sleep(estimatedTime - 20)

        while (pids.some((pid) => ns.isRunning(pid))) {
          await ns.sleep(1)
        }
      } else {
        await ns.sleep(500)
      }

      // Compare actual results with prediction
      const iterationEndTime = Date.now()
      const actualIterationTime = iterationEndTime - iterationStartTime
      const newMoney = ns.getServerMoneyAvailable(target)
      const newSec = ns.getServerSecurityLevel(target)
      const newPlayerLevel = ns.getPlayer().skills.hacking

      iterationDetails.push({
        iteration: iterationCount,
        time: actualIterationTime,
        moneyBefore,
        moneyAfter: newMoney,
        secBefore,
        secAfter: newSec,
        playerLevel: playerLevelBefore,
      })

      if (predictedIterations && iterationCount <= predictedIterations.length) {
        const predicted = predictedIterations[iterationCount - 1]
        if (predicted) {
          const moneyDiff = newMoney - predicted.moneyAfter
          const secDiff = newSec - predicted.secAfter
          const timeDiff = actualIterationTime - predicted.time
          const levelDiff = newPlayerLevel - predicted.playerLevel

          const remainingIterations = predictedIterations.length - iterationCount
          const estimatedTimeRemaining = predictedIterations
            .slice(iterationCount)
            .reduce((sum, iter) => sum + iter.time, 0)

          if (debug) {
            ns.tprint(
              `\n[Iteration ${iterationCount}/${predictedIterations.length}] Actual vs Predicted:\n` +
                `  Time: ${ns.tFormat(actualIterationTime)} vs ${ns.tFormat(predicted.time)} (diff: ${Math.abs(timeDiff).toFixed(0)}ms)\n` +
                `  Money: ${ns.formatNumber(newMoney)} vs ${ns.formatNumber(predicted.moneyAfter)} (diff: ${ns.formatNumber(Math.abs(moneyDiff))})\n` +
                `  Sec: ${newSec.toFixed(2)} vs ${predicted.secAfter.toFixed(2)} (diff: ${Math.abs(secDiff).toFixed(2)})\n` +
                `  Level: ${newPlayerLevel} vs ${predicted.playerLevel} (diff: ${Math.abs(levelDiff)})\n` +
                `  Estimated time remaining: ${ns.tFormat(estimatedTimeRemaining)} (${remainingIterations} iterations left)`
            )
          }
        }
      }
    }

    const totalTime = iterationDetails.reduce((sum, iter) => sum + iter.time, 0)
    return { totalTime, iterationDetails, moneyMax, baseSecurity, secTolerance, myCores }
  }
}

/**
 * Wrapper function for backward compatibility
 * Calls prepareServerMultiNode with dryRun=true
 */
export function calculatePrepTime(
  ns: NS,
  nodes: string[],
  target: string,
  showVerbose = false
): {
  totalTime: number
  iterationDetails: Array<{
    iteration: number
    time: number
    moneyBefore: number
    moneyAfter: number
    secBefore: number
    secAfter: number
    playerLevel: number
  }>
} {
  // Call the merged function in simulation mode
  const result = prepareServerMultiNode(ns, nodes, target, { dryRun: true, showVerbose })
  // Await is fine here since we're in an async context, but we need to handle the promise
  return result as any // TypeScript workaround - the function returns a Promise but callers expect sync
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
      const growThreadsNeeded = calculateGrowThreads(serverActual, player, moneyMax, myCores, ns)
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
