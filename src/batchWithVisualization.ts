import { NS, Person, Player, Server } from "@ns"
import {
  initBatchVisualizer,
  logBatchOperation,
  nextBatch,
} from "./batchVisualizer.js"

export async function main(ns: NS) {
  // Initialize the real-time visualizer
  const visualizer = initBatchVisualizer()

  const host = (ns.args[0] as string) ?? ns.getHostname()
  const target = ns.args[1] as string
  const moneyMax = ns.getServerMaxMoney(target)
  const baseSecurity = ns.getServerMinSecurityLevel(target)
  const secTolerance = 0.01
  const moneyTolerance = 0.99
  const prepWeakenDelay = 100
  const hackThreshold = 0.25

  const player = ns.getPlayer()
  const myCores = ns.getServer(host).cpuCores
  ns.tprint(`cores: ${myCores}`)

  const serverActual = ns.getServer(target)
  const growThreads = Math.ceil(
    ns.formulas.hacking.growThreads(serverActual, player, moneyMax, myCores)
  )
  if (growThreads > 0) {
    ns.tprint(`Prep: Executing grow with ${growThreads} threads on ${target}.`)
    ns.exec("/hacking/grow.js", host, growThreads, target, 0)
  } else {
    ns.tprint(`Prep: Grow not needed on ${target}.`)
  }

  await ns.sleep(prepWeakenDelay)

  const addedSecurity = ns.growthAnalyzeSecurity(growThreads, target, myCores)
  const currentSec = ns.getServerSecurityLevel(target)
  const expectedSecAfterGrow = currentSec + addedSecurity
  const secToReduce = expectedSecAfterGrow - baseSecurity
  const weakenThreadsPre = Math.max(
    1,
    Math.ceil(secToReduce / (0.05 * (1 + (myCores - 1) / 16)))
  )

  if (weakenThreadsPre > 0) {
    ns.tprint(
      `Prep: Executing weaken with ${weakenThreadsPre} threads on ${target}.`
    )
    ns.exec("/hacking/weaken.js", host, weakenThreadsPre, target, 0)
  } else {
    ns.tprint(`Prep: Weaken not needed on ${target} (security is at base).`)
  }

  const growTime = ns.formulas.hacking.growTime(serverActual, player)
  const weakenTime = ns.formulas.hacking.weakenTime(serverActual, player)
  const waitTime = Math.max(growTime, weakenTime) + 200
  ns.tprint(`Prep: Waiting ${waitTime} ms for grow/weaken to complete...`)
  await ns.sleep(waitTime)

  const postMoney = ns.getServerMoneyAvailable(target)
  const postSec = ns.getServerSecurityLevel(target)
  if (postMoney < moneyMax * moneyTolerance) {
    ns.tprint(`WARNING: Money is only ${postMoney} (target ${moneyMax}).`)
  }
  if (postSec > baseSecurity + secTolerance) {
    ns.tprint(`WARNING: Security is ${postSec} (target ${baseSecurity}).`)
  }
  ns.tprint(
    `Prep complete on ${target}: ${postMoney} money, ${postSec} security.`
  )

  function prepForHack(server: Server, player: Player) {
    server.moneyAvailable = server.moneyMax!
    server.hackDifficulty = server.minDifficulty
    return { server, player }
  }
  function prepForWeaken(server: Server, player: Player, hackThreads: number) {
    server.hackDifficulty =
      server.minDifficulty! + ns.hackAnalyzeSecurity(hackThreads, undefined)

    return { server, player }
  }
  function prepForGrow(server: Server, player: Player) {
    server.moneyAvailable = server.moneyMax! * hackThreshold
    server.hackDifficulty = server.minDifficulty

    return { server, player }
  }
  function prepForWeaken2(server: Server, player: Player, growThreads: number) {
    server.hackDifficulty =
      server.minDifficulty! +
      ns.growthAnalyzeSecurity(growThreads, undefined, myCores)

    return { server, player }
  }

  function calculateHackThreads(server: Server, player: Person) {
    const hackPct = ns.formulas.hacking.hackPercent(server, player)
    return Math.ceil(
      (moneyMax - moneyMax * hackThreshold) / (hackPct * moneyMax)
    )
  }
  function calculateWeakenThreads(server: Server, player: Player) {
    const addedSecurity = server.hackDifficulty! - server.minDifficulty!
    return Math.max(
      1,
      Math.ceil(addedSecurity / (0.05 * (1 + (myCores - 1) / 16)))
    )
  }
  function calculateGrowThreads(server: Server, player: Person) {
    return Math.ceil(
      ns.formulas.hacking.growThreads(server, player, moneyMax, myCores)
    )
  }
  function calculateWeakenThreads2(server: Server, player: Player) {
    return calculateWeakenThreads(server, player)
  }

  let batchCounter = 0
  ns.tprint("Entering main batching loop.")
  const server = ns.getServer(target)
  while (true) {
    const player = ns.getPlayer()

    const { server: hackServer, player: hackPlayer } = prepForHack(
      server,
      player
    )
    const hackThreads = calculateHackThreads(hackServer, hackPlayer)

    const { server: weakenServer, player: weakenPlayer } = prepForWeaken(
      server,
      player,
      hackThreads
    )
    const weakenThreads1 = calculateWeakenThreads(weakenServer, weakenPlayer)

    const { server: growServer, player: growPlayer } = prepForGrow(
      server,
      player
    )
    const growThreads = calculateGrowThreads(growServer, growPlayer)

    const { server: weaken2Server, player: weaken2Player } = prepForWeaken2(
      server,
      player,
      growThreads
    )
    const weakenThreads2 = calculateWeakenThreads2(weaken2Server, weaken2Player)

    function getDeltaShotgun(opTime: number, index: number) {
      return opTime / (2.5 + 2 * index)
    }

    const hackTime = ns.formulas.hacking.hackTime(hackServer, hackPlayer)
    const weakenTime = ns.formulas.hacking.weakenTime(
      weakenServer,
      weakenPlayer
    )
    const growTime = ns.formulas.hacking.growTime(growServer, growPlayer)
    const weaken2Time = ns.formulas.hacking.weakenTime(
      weaken2Server,
      weaken2Player
    )

    if (weakenTime !== weaken2Time) {
      ns.tprint(`Weaken times do not match: ${weakenTime} vs ${weaken2Time}`)
    }

    const batchDelay = getDeltaShotgun(weakenTime, 2)

    const sleepHack = weakenTime - hackTime
    const sleepWeaken1 = 0
    const sleepGrow = weakenTime - growTime
    const sleepWeaken2 = 0

    // Calculate expected completion times for visualization
    const currentTime = Date.now()
    const hackStart = currentTime
    const hackEnd = hackStart + hackTime + sleepHack
    const weaken1Start = currentTime + batchDelay
    const weaken1End = weaken1Start + weakenTime + sleepWeaken1
    const growStart = currentTime + 2 * batchDelay
    const growEnd = growStart + growTime + sleepGrow
    const weaken2Start = currentTime + 3 * batchDelay
    const weaken2End = weaken2Start + weakenTime + sleepWeaken2

    // Log operations to visualizer (predicting when they'll complete)
    logBatchOperation("H", hackStart, hackEnd, batchCounter)
    logBatchOperation("W", weaken1Start, weaken1End, batchCounter)
    logBatchOperation("G", growStart, growEnd, batchCounter)
    logBatchOperation("W", weaken2Start, weaken2End, batchCounter)

    ns.exec("/hacking/hack.js", host, hackThreads, target, sleepHack)
    await ns.sleep(batchDelay)
    ns.exec("/hacking/weaken.js", host, weakenThreads1, target, sleepWeaken1)
    await ns.sleep(batchDelay)
    ns.exec("/hacking/grow.js", host, growThreads, target, sleepGrow)
    await ns.sleep(batchDelay)
    ns.exec("/hacking/weaken.js", host, weakenThreads2, target, sleepWeaken2)
    await ns.sleep(batchDelay)

    batchCounter++
    nextBatch() // Advance to next batch in visualizer
  }
}
