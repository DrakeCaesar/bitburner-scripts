import { NS } from "@ns"
import {
  calculateGrowThreads,
  calculateHackThreads,
  calculateWeakenThreads,
  calculateWeakenThreads2,
  copyRequiredScripts,
  getDelta,
  killOtherInstances,
  prepareServer,
  prepForGrow,
  prepForHack,
  prepForWeaken,
  prepForWeaken2,
} from "./batchCalculations.js"
import { initBatchVisualiser, logBatchOperation, nextBatch, setBatchInterval } from "./batchVisualiser.js"

export async function main(ns: NS) {
  const host = (ns.args[0] as string) ?? ns.getHostname()
  const target = ns.args[1] as string

  await killOtherInstances(ns)
  ns.killall(host)
  await copyRequiredScripts(ns, host)
  initBatchVisualiser()

  const { moneyMax, baseSecurity, secTolerance, myCores } = await prepareServer(ns, host, target)
  const hackThreshold = 0.25

  let batchCounter = 0
  const server = ns.getServer(target)
  while (true) {
    const player = ns.getPlayer()

    const { server: hackServer, player: hackPlayer } = prepForHack(server, player)
    const hackThreads = calculateHackThreads(hackServer, hackPlayer, moneyMax, hackThreshold, ns)

    const { server: weakenServer, player: weakenPlayer } = prepForWeaken(server, player, hackThreads, ns)
    const weakenThreads1 = calculateWeakenThreads(weakenServer, weakenPlayer, myCores)

    const { server: growServer, player: growPlayer } = prepForGrow(server, player, hackThreshold)
    const growThreads = calculateGrowThreads(growServer, growPlayer, moneyMax, myCores, ns)

    const { server: weaken2Server, player: weaken2Player } = prepForWeaken2(server, player, growThreads, ns, myCores)
    const weakenThreads2 = calculateWeakenThreads2(weaken2Server, weaken2Player, myCores)

    const hackTime = ns.formulas.hacking.hackTime(hackServer, hackPlayer)
    const weaken1Time = ns.formulas.hacking.weakenTime(weaken2Server, weaken2Player)
    const growTime = ns.formulas.hacking.growTime(growServer, growPlayer)
    const weaken2Time = ns.formulas.hacking.weakenTime(weakenServer, weakenPlayer)

    const maxWeakenTime = Math.max(weaken1Time, weaken2Time)
    const batchDelay = getDelta(maxWeakenTime, 0)

    if (batchCounter === 0) {
      setBatchInterval(batchDelay * 4)
    }

    const sleepHack = maxWeakenTime - hackTime
    const sleepWeaken1 = maxWeakenTime - weaken1Time
    const sleepGrow = maxWeakenTime - growTime
    const sleepWeaken2 = maxWeakenTime - weaken2Time

    const currentTime = Date.now()
    const hackStart = currentTime
    const hackEnd = hackStart + hackTime + sleepHack
    const weaken1Start = currentTime + batchDelay
    const weaken1End = weaken1Start + weaken1Time + sleepWeaken1
    const growStart = currentTime + 2 * batchDelay
    const growEnd = growStart + growTime + sleepGrow
    const weaken2Start = currentTime + 3 * batchDelay
    const weaken2End = weaken2Start + weaken2Time + sleepWeaken2

    const hackOpId = logBatchOperation("H", hackStart, hackEnd, batchCounter)
    const weaken1OpId = logBatchOperation("W", weaken1Start, weaken1End, batchCounter)
    const growOpId = logBatchOperation("G", growStart, growEnd, batchCounter)
    const weaken2OpId = logBatchOperation("W", weaken2Start, weaken2End, batchCounter)

    ns.exec("/hacking/hack.js", host, hackThreads, target, sleepHack, hackOpId)
    await ns.sleep(batchDelay)

    ns.exec("/hacking/weaken.js", host, weakenThreads1, target, sleepWeaken1, weaken1OpId)
    await ns.sleep(batchDelay)

    ns.exec("/hacking/grow.js", host, growThreads, target, sleepGrow, growOpId)
    await ns.sleep(batchDelay)

    ns.exec("/hacking/weaken.js", host, weakenThreads2, target, sleepWeaken2, weaken2OpId)
    await ns.sleep(batchDelay)

    batchCounter++
    nextBatch()
  }
}
