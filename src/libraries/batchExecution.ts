import { NS, Player, Server } from "@ns"
import { calculateGrowThreads, calculateHackThreads, calculateOperationXp, calculateWeakThreads, growServerInstance, hackServerInstance, updatePlayerWithXp, wkn1ServerInstance, wkn2ServerInstance } from "../batchCalculations.js"
import { findNodeWithRam } from "./serverManagement.js"

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
}

export function calculateBatchThreads(ns: NS, config: BatchConfig) {
  const { server, player, hackThreshold, myCores } = config
  const moneyMax = server.moneyMax!

  const { server: hackServer, player: hackPlayer } = hackServerInstance(server, player)
  const hackThreads = calculateHackThreads(hackServer, hackPlayer, moneyMax, hackThreshold, ns)

  const { server: wkn1Server, player: wkn1Player } = wkn1ServerInstance(server, player, hackThreads, ns)
  const wkn1Threads = calculateWeakThreads(wkn1Server, wkn1Player, myCores)

  const { server: growServer, player: growPlayer } = growServerInstance(server, player, hackThreshold)
  const growThreads = calculateGrowThreads(growServer, growPlayer, moneyMax, myCores, ns)

  const { server: wkn2Server, player: wkn2Player } = wkn2ServerInstance(server, player, growThreads, ns, myCores)
  const wkn2Threads = calculateWeakThreads(wkn2Server, wkn2Player, myCores)

  const hackServerRam = ns.getScriptRam("/hacking/hack.js") * hackThreads
  const wkn1ServerRam = ns.getScriptRam("/hacking/weaken.js") * wkn1Threads
  const growServerRam = ns.getScriptRam("/hacking/grow.js") * growThreads
  const wkn2ServerRam = ns.getScriptRam("/hacking/weaken.js") * wkn2Threads
  const totalBatchRam = hackServerRam + wkn1ServerRam + growServerRam + wkn2ServerRam

  return {
    hackThreads,
    wkn1Threads,
    growThreads,
    wkn2Threads,
    totalBatchRam,
  }
}

export function calculateBatchTimings(ns: NS, server: Server, player: Player, batchDelay: number) {
  const weakenTime = ns.formulas.hacking.weakenTime(server, player)
  const hackTime = ns.formulas.hacking.hackTime(server, player)
  const growTime = ns.formulas.hacking.growTime(server, player)

  const hackAdditionalMsec = weakenTime - batchDelay - hackTime
  const wkn1AdditionalMsec = 0
  const growAdditionalMsec = weakenTime + batchDelay - growTime
  const wkn2AdditionalMsec = 2 * batchDelay

  return {
    weakenTime,
    hackTime,
    growTime,
    hackAdditionalMsec,
    wkn1AdditionalMsec,
    growAdditionalMsec,
    wkn2AdditionalMsec,
  }
}

export async function executeBatches(ns: NS, config: BatchConfig, threads: ReturnType<typeof calculateBatchThreads>, timings: ReturnType<typeof calculateBatchTimings>, batchLimit?: number) {
  const { target, server, player, batchDelay, nodes, totalMaxRam, ramThreshold } = config
  const { hackThreads, wkn1Threads, growThreads, wkn2Threads, totalBatchRam } = threads
  const { hackAdditionalMsec, wkn1AdditionalMsec, growAdditionalMsec, wkn2AdditionalMsec } = timings

  const maxBatches = Math.floor((totalMaxRam / totalBatchRam) * ramThreshold)
  const batches = batchLimit !== undefined ? Math.min(batchLimit, maxBatches) : maxBatches

  const hackScriptRam = ns.getScriptRam("/hacking/hack.js")
  const weakenScriptRam = ns.getScriptRam("/hacking/weaken.js")
  const growScriptRam = ns.getScriptRam("/hacking/grow.js")

  let lastPid = 0
  let currentPlayer = { ...player }

  for (let batchCounter = 0; batchCounter < batches; batchCounter++) {
    const batchOffset = batchCounter * batchDelay * 4

    const hackXp = calculateOperationXp(server, currentPlayer, hackThreads, ns)
    const playerAfterHack = updatePlayerWithXp(currentPlayer, hackXp, ns)

    const wkn1Xp = calculateOperationXp(server, playerAfterHack, wkn1Threads, ns)
    const playerAfterWkn1 = updatePlayerWithXp(playerAfterHack, wkn1Xp, ns)

    const growXp = calculateOperationXp(server, playerAfterWkn1, growThreads, ns)
    const playerAfterGrow = updatePlayerWithXp(playerAfterWkn1, growXp, ns)

    const wkn2Xp = calculateOperationXp(server, playerAfterGrow, wkn2Threads, ns)
    const playerAfterWkn2 = updatePlayerWithXp(playerAfterGrow, wkn2Xp, ns)

    currentPlayer = playerAfterWkn2

    // Find nodes for each operation
    const hackNode = findNodeWithRam(ns, nodes, hackThreads * hackScriptRam)
    const wkn1Node = findNodeWithRam(ns, nodes, wkn1Threads * weakenScriptRam)
    const growNode = findNodeWithRam(ns, nodes, growThreads * growScriptRam)
    const wkn2Node = findNodeWithRam(ns, nodes, wkn2Threads * weakenScriptRam)

    if (!hackNode || !wkn1Node || !growNode || !wkn2Node) {
      ns.tprint(`ERROR: Not enough RAM to launch batch ${batchCounter}`)
      break
    }

    // Launch operations
    ns.exec(
      "/hacking/hack.js",
      hackNode,
      hackThreads,
      target,
      hackAdditionalMsec + batchOffset,
      0,
      playerAfterHack.skills.hacking,
      playerAfterHack.exp.hacking
    )
    ns.exec(
      "/hacking/weaken.js",
      wkn1Node,
      wkn1Threads,
      target,
      wkn1AdditionalMsec + batchOffset,
      0,
      playerAfterWkn1.skills.hacking,
      playerAfterWkn1.exp.hacking
    )
    ns.exec(
      "/hacking/grow.js",
      growNode,
      growThreads,
      target,
      growAdditionalMsec + batchOffset,
      0,
      playerAfterGrow.skills.hacking,
      playerAfterGrow.exp.hacking
    )
    lastPid = ns.exec(
      "/hacking/weaken.js",
      wkn2Node,
      wkn2Threads,
      target,
      wkn2AdditionalMsec + batchOffset,
      0,
      playerAfterWkn2.skills.hacking,
      playerAfterWkn2.exp.hacking
    )
  }

  // Wait for the last script to finish
  while (ns.isRunning(lastPid)) {
    await ns.sleep(100)
  }

  return batches
}
