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
  prepForWkn1,
  prepForWkn2,
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

    const { server: hackServ, player: hackPlay } = prepForHack(server, player)
    const hackThreads = calculateHackThreads(hackServ, hackPlay, moneyMax, hackThreshold, ns)

    const { server: wkn1Serv, player: wkn1Play } = prepForWkn1(server, player, hackThreads, ns)
    const wkn1Threads = calculateWeakenThreads(wkn1Serv, wkn1Play, myCores)

    const { server: growServ, player: growPlay } = prepForGrow(server, player, hackThreshold)
    const growThreads = calculateGrowThreads(growServ, growPlay, moneyMax, myCores, ns)

    const { server: wkn2Serv, player: wkn2Play } = prepForWkn2(server, player, growThreads, ns, myCores)
    const wkn2Threads = calculateWeakenThreads2(wkn2Serv, wkn2Play, myCores)

    const hackTime = ns.formulas.hacking.hackTime(hackServ, hackPlay)
    const wkn1Time = ns.formulas.hacking.weakTime(wkn2Serv, wkn2Play)
    const growTime = ns.formulas.hacking.growTime(growServ, growPlay)
    const wkn2Time = ns.formulas.hacking.weakTime(wkn1Serv, wkn1Play)

    const maxWeakenTime = Math.max(wkn1Time, wkn2Time)
    const batchDelay = getDelta(maxWeakenTime, 0)

    if (batchCounter === 0) {
      setBatchInterval(batchDelay * 4)
    }

    const hackSleep = maxWeakenTime - hackTime
    const wkn1Sleep = maxWeakenTime - wkn1Time
    const growSleep = maxWeakenTime - growTime
    const wkn2Sleep = maxWeakenTime - wkn2Time

    const currentTime = Date.now()
    const hackStr = currentTime
    const hackEnd = hackStr + hackTime + hackSleep
    const wkn1Str = currentTime + batchDelay
    const wkn1End = wkn1Str + wkn1Time + wkn1Sleep
    const growStr = currentTime + 2 * batchDelay
    const growEnd = growStr + growTime + growSleep
    const wkn2Str = currentTime + 3 * batchDelay
    const wkn2End = wkn2Str + wkn2Time + wkn2Sleep

    const hackOpId = logBatchOperation("H", hackStr, hackEnd, batchCounter)
    const wkn1OpId = logBatchOperation("W", wkn1Str, wkn1End, batchCounter)
    const growOpId = logBatchOperation("G", growStr, growEnd, batchCounter)
    const wkn2OpId = logBatchOperation("W", wkn2Str, wkn2End, batchCounter)

    ns.exec("/hacking/hack.js", host, hackThreads, target, hackSleep, hackOpId)
    await ns.sleep(batchDelay)

    ns.exec("/hacking/weaken.js", host, wkn1Threads, target, wkn1Sleep, wkn1OpId)
    await ns.sleep(batchDelay)

    ns.exec("/hacking/grow.js", host, growThreads, target, growSleep, growOpId)
    await ns.sleep(batchDelay)

    ns.exec("/hacking/weaken.js", host, wkn2Threads, target, wkn2Sleep, wkn2OpId)
    await ns.sleep(batchDelay)

    batchCounter++
    nextBatch()
  }
}
