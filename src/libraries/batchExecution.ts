import { NS, Player, Server } from "@ns"
import {
  calculateGrowThreads,
  calculateHackThreads,
  calculateOperationXp,
  calculateWeakThreads,
  createKahanSum,
  growServerInstance,
  hackServerInstance,
  kahanAdd,
  updatePlayerWithKahanXp,
  wkn1ServerInstance,
  wkn2ServerInstance,
} from "./batchCalculations.js"
import { distributeOperationsAcrossNodes } from "./serverManagement.js"

export interface BatchConfig {
  target: string
  server: Server
  player: Player
  hackThreshold: number
  batchDelay: number
  myCores: number
  nodes: string[]
  totalMaxRam: number
  ramThreshold: number
  nodeRamLimit: number
}

export function calculateBatchThreads(ns: NS, config: BatchConfig) {
  const { server, player, hackThreshold, myCores, nodeRamLimit } = config
  const moneyMax = server.moneyMax!

  const hackScriptRam = ns.getScriptRam("/hacking/hack.js")
  const weakenScriptRam = ns.getScriptRam("/hacking/weaken.js")
  const growScriptRam = ns.getScriptRam("/hacking/grow.js")

  // Try progressively higher thresholds (steal less money) until operations fit in nodeRamLimit
  let actualThreshold = hackThreshold
  const maxIterations = 1000 // Prevent infinite loops

  for (let i = 0; i < maxIterations; i++) {
    const { server: hackServer, player: hackPlayer } = hackServerInstance(server, player)
    const hackThreads = calculateHackThreads(hackServer, hackPlayer, moneyMax, actualThreshold, ns)

    const { server: wkn1Server, player: wkn1Player } = wkn1ServerInstance(server, player, hackThreads, ns)
    const wkn1Threads = calculateWeakThreads(wkn1Server, wkn1Player, myCores)

    const { server: growServer, player: growPlayer } = growServerInstance(server, player, actualThreshold)
    const growThreads = calculateGrowThreads(growServer, growPlayer, moneyMax, myCores, ns)

    const { server: wkn2Server, player: wkn2Player } = wkn2ServerInstance(server, player, growThreads, ns, myCores)
    const wkn2Threads = calculateWeakThreads(wkn2Server, wkn2Player, myCores)

    const hackServerRam = hackScriptRam * hackThreads
    const wkn1ServerRam = weakenScriptRam * wkn1Threads
    const growServerRam = growScriptRam * growThreads
    const wkn2ServerRam = weakenScriptRam * wkn2Threads

    const maxOperationRam = hackServerRam + wkn1ServerRam + growServerRam + wkn2ServerRam
    // const maxOperationRam = Math.max(hackServerRam, wkn1ServerRam, growServerRam, wkn2ServerRam)
    // Check if all operations fit in the smallest node
    if (maxOperationRam <= nodeRamLimit) {
      const totalBatchRam = hackServerRam + wkn1ServerRam + growServerRam + wkn2ServerRam
      return {
        hackThreads,
        wkn1Threads,
        growThreads,
        wkn2Threads,
        totalBatchRam,
        actualThreshold,
      }
    }

    // Increase threshold to steal less (move 50% closer to 1)
    const remaining = 1 - actualThreshold
    if (remaining < 0.00001) break // Stop if we're extremely close to 1
    actualThreshold = actualThreshold + remaining * 0.5
  }

  // If we get here, even threshold very close to 1 doesn't fit
  throw new Error(
    `Cannot find a hack threshold that fits in minimum node RAM (${nodeRamLimit} GB). Consider upgrading servers.`
  )
}

export function calculateBatchTimings(ns: NS, server: Server, player: Player, batchDelay: number) {
  const weakenTime = ns.formulas.hacking.weakenTime(server, player)
  const hackTime = ns.formulas.hacking.hackTime(server, player)
  const growTime = ns.formulas.hacking.growTime(server, player)

  // Adjust batch delay if it's too large for the weaken time
  // We need at least 4 * batchDelay for all operations to fit
  const minWeakenTime = 4 * batchDelay
  const effectiveBatchDelay = weakenTime < minWeakenTime ? Math.floor(weakenTime / 5) : batchDelay

  // Calculate additional delays to ensure proper timing
  // Operations should finish in order: Hack -> Weaken1 -> Grow -> Weaken2
  const hackAdditionalMsec = Math.max(0, weakenTime - effectiveBatchDelay - hackTime)
  const wkn1AdditionalMsec = 0
  const growAdditionalMsec = Math.max(0, weakenTime + effectiveBatchDelay - growTime)
  const wkn2AdditionalMsec = 2 * effectiveBatchDelay

  return {
    weakenTime,
    hackTime,
    growTime,
    hackAdditionalMsec,
    wkn1AdditionalMsec,
    growAdditionalMsec,
    wkn2AdditionalMsec,
    effectiveBatchDelay,
  }
}

export async function executeBatches(
  ns: NS,
  config: BatchConfig,
  threads: ReturnType<typeof calculateBatchThreads>,
  timings: ReturnType<typeof calculateBatchTimings>,
  batchLimit?: number
) {
  const { target, server, player, batchDelay, nodes, totalMaxRam, ramThreshold, myCores } = config
  const { totalBatchRam, actualThreshold } = threads
  const { hackAdditionalMsec, wkn1AdditionalMsec, growAdditionalMsec, wkn2AdditionalMsec, effectiveBatchDelay } =
    timings

  const maxBatches = Math.floor((totalMaxRam / totalBatchRam) * ramThreshold)
  const batches = batchLimit !== undefined ? Math.min(batchLimit, maxBatches) : maxBatches

  const hackScriptRam = ns.getScriptRam("/hacking/hack.js")
  const weakenScriptRam = ns.getScriptRam("/hacking/weaken.js")
  const growScriptRam = ns.getScriptRam("/hacking/grow.js")

  // Warn if batch delay was adjusted
  if (effectiveBatchDelay !== batchDelay) {
    ns.tprint(`WARNING: Batch delay adjusted from ${batchDelay}ms to ${effectiveBatchDelay}ms due to low weaken time`)
  }

  let lastPid = 0
  let currentPlayer = { ...player }
  const moneyMax = server.moneyMax!

  // Use Kahan summation to accumulate XP with minimal floating point error
  let xpKahan = createKahanSum(player.exp.hacking)

  for (let batchCounter = 0; batchCounter < batches; batchCounter++) {
    const batchOffset = batchCounter * effectiveBatchDelay * 4

    // Calculate hack threads and XP with current player state (e.g., level 10)
    const { server: hackServer, player: hackPlayer } = hackServerInstance(server, currentPlayer)
    const hackThreads = calculateHackThreads(hackServer, hackPlayer, moneyMax, actualThreshold, ns)
    const hackXp = calculateOperationXp(server, currentPlayer, hackThreads, ns)
    xpKahan = kahanAdd(xpKahan, hackXp)
    const playerAfterHack = updatePlayerWithKahanXp(currentPlayer, xpKahan, ns)

    // Calculate weaken1 threads and XP with player state after hack (e.g., level 11)
    const { server: wkn1Server, player: wkn1Player } = wkn1ServerInstance(server, playerAfterHack, hackThreads, ns)
    const wkn1Threads = calculateWeakThreads(wkn1Server, wkn1Player, myCores)
    const wkn1Xp = calculateOperationXp(server, playerAfterHack, wkn1Threads, ns)
    xpKahan = kahanAdd(xpKahan, wkn1Xp)
    const playerAfterWkn1 = updatePlayerWithKahanXp(currentPlayer, xpKahan, ns)

    // Calculate grow threads and XP with player state after weaken1 (e.g., level 12)
    const { server: growServer, player: growPlayer } = growServerInstance(server, playerAfterWkn1, actualThreshold)
    const growThreads = calculateGrowThreads(growServer, growPlayer, moneyMax, myCores, ns)
    const growXp = calculateOperationXp(server, playerAfterWkn1, growThreads, ns)
    xpKahan = kahanAdd(xpKahan, growXp)
    const playerAfterGrow = updatePlayerWithKahanXp(currentPlayer, xpKahan, ns)

    // Calculate weaken2 threads and XP with player state after grow (e.g., level 13)
    const { server: wkn2Server, player: wkn2Player } = wkn2ServerInstance(
      server,
      playerAfterGrow,
      growThreads,
      ns,
      myCores
    )
    const wkn2Threads = calculateWeakThreads(wkn2Server, wkn2Player, myCores)
    const wkn2Xp = calculateOperationXp(server, playerAfterGrow, wkn2Threads, ns)
    xpKahan = kahanAdd(xpKahan, wkn2Xp)
    const playerAfterWkn2 = updatePlayerWithKahanXp(currentPlayer, xpKahan, ns)

    currentPlayer = playerAfterWkn2

    // Find nodes for each operation
    // ns.tprint(
    //   `Launching batch ${batchCounter + 1}/${batches}: H:${hackThreads} W1:${wkn1Threads} G:${growThreads} W2:${wkn2Threads} (Total RAM: ${totalBatchRam.toFixed(2)} GB)`
    // )
    // print nodes and their ram
    // ns.tprint(`Nodes: ${nodes.map((n) => `${n} (${ns.getServerMaxRam(n)} GB)`).join(", ")}`)

    const hackTotalRam = hackThreads * hackScriptRam
    const wkn1TotalRam = wkn1Threads * weakenScriptRam
    const growTotalRam = growThreads * growScriptRam
    const wkn2TotalRam = wkn2Threads * weakenScriptRam

    // Distribute operations across available nodes using knapsack approach
    const operations = [
      {
        ram: hackTotalRam,
        scriptPath: "/hacking/hack.js",
        args: [
          target,
          hackAdditionalMsec + batchOffset,
          0,
          playerAfterHack.skills.hacking,
          playerAfterHack.exp.hacking,
        ],
        threads: hackThreads,
      },
      {
        ram: wkn1TotalRam,
        scriptPath: "/hacking/weaken.js",
        args: [
          target,
          wkn1AdditionalMsec + batchOffset,
          0,
          playerAfterWkn1.skills.hacking,
          playerAfterWkn1.exp.hacking,
        ],
        threads: wkn1Threads,
      },
      {
        ram: growTotalRam,
        scriptPath: "/hacking/grow.js",
        args: [
          target,
          growAdditionalMsec + batchOffset,
          0,
          playerAfterGrow.skills.hacking,
          playerAfterGrow.exp.hacking,
        ],
        threads: growThreads,
      },
      {
        ram: wkn2TotalRam,
        scriptPath: "/hacking/weaken.js",
        args: [
          target,
          wkn2AdditionalMsec + batchOffset,
          0,
          playerAfterWkn2.skills.hacking,
          playerAfterWkn2.exp.hacking,
        ],
        threads: wkn2Threads,
      },
    ]

    const assignments = distributeOperationsAcrossNodes(ns, nodes, operations)

    if (!assignments) {
      // ns.tprint(`Warning: Not enough RAM to launch batch ${batchCounter}`)
      break
    }

    // Launch operations on assigned nodes
    for (let i = 0; i < assignments.length; i++) {
      const { node, operation } = assignments[i]
      const pid = ns.exec(operation.scriptPath, node, operations[i].threads, ...operation.args)
      if (i === assignments.length - 1) {
        lastPid = pid
      }
    }
  }

  // Wait for the last script to finish
  while (ns.isRunning(lastPid)) {
    await ns.sleep(100)
  }

  return batches
}
