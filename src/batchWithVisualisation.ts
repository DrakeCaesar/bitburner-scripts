import { NS } from "@ns"
import {
  calculateGrowThreads,
  calculateHackThreads,
  calculateWeakThreads,
  copyRequiredScripts,
  getDelta,
  growServerInstance,
  hackServerInstance,
  killOtherInstances,
  prepareServer,
  wkn1ServerInstance,
  wkn2ServerInstance,
} from "./batchCalculations.js"
import { initBatchVisualiser, logBatchOperation, nextBatch, setBatchInterval } from "./batchVisualiser.js"

export async function main(ns: NS) {
  const host = (ns.args[0] as string) ?? ns.getHostname()
  const target = ns.args[1] as string

  await killOtherInstances(ns)
  ns.killall(host)
  await copyRequiredScripts(ns, host)
  initBatchVisualiser()

  const { moneyMax, myCores } = await prepareServer(ns, host, target)
  const hackThreshold = 0.25

  const server = ns.getServer(target)
  const player = ns.getPlayer()

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

  const serverMaxRam = ns.getServerMaxRam(host)
  const batches = Math.floor(serverMaxRam / totalBatchRam)

  const hackTime = ns.formulas.hacking.hackTime(hackServer, hackPlayer)
  const wkn1Time = ns.formulas.hacking.weakenTime(wkn2Server, wkn2Player)
  const growTime = ns.formulas.hacking.growTime(growServer, growPlayer)
  const wkn2Time = ns.formulas.hacking.weakenTime(wkn1Server, wkn1Player)

  const maxWeakenTime = Math.max(wkn1Time, wkn2Time)
  const batchDelay = getDelta(maxWeakenTime, 0)

  const hackSleep = maxWeakenTime - hackTime
  const wkn1Sleep = maxWeakenTime - wkn1Time
  const growSleep = maxWeakenTime - growTime
  const wkn2Sleep = maxWeakenTime - wkn2Time

  ns.tprint(
    `Batch RAM: ${totalBatchRam.toFixed(2)} GB - Threads (H:${hackThreads} W1:${wkn1Threads} G:${growThreads} W2:${wkn2Threads}) - RAM (H:${hackServerRam.toFixed(2)} W1:${wkn1ServerRam.toFixed(2)} G:${growServerRam.toFixed(2)} W2:${wkn2ServerRam.toFixed(2)})`
  )
  ns.tprint(`Can run ${batches} batches in parallel on ${host} (${serverMaxRam} GB RAM)`)
  ns.tprint(`Max weaken time: ${maxWeakenTime.toFixed(0)}ms, batch delay: ${batchDelay.toFixed(0)}ms`)

  setBatchInterval(batchDelay * 4)

  let batchCounter = 0
  while (true) {

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
