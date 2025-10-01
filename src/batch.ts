import { NS } from "@ns"
import {
  calculateGrowThreads,
  calculateHackThreads,
  calculateWeakThreads,
  copyRequiredScripts,
  growServerInstance,
  hackServerInstance,
  killOtherInstances,
  prepareServer,
  wkn1ServerInstance,
  wkn2ServerInstance,
} from "./batchCalculations.js"
import { initBatchVisualiser, logBatchOperation } from "./batchVisualiser.js"
import { findBestTarget } from "./findBestTarget.js"

export async function main(ns: NS) {
  const host = (ns.args[0] as string) ?? ns.getHostname()
  const playerHackLevel = ns.args[1] ? Number(ns.args[1]) : undefined

  // Find best target automatically
  const target = findBestTarget(ns, host, playerHackLevel)

  await killOtherInstances(ns)
  ns.killall(host)
  await copyRequiredScripts(ns, host)
  initBatchVisualiser()

  const player = ns.getPlayer()
  const serverMaxRam = ns.getServerMaxRam(host)
  const batchDelay = 10

  // Create a simulated prepared server (min security, max money) to optimize threshold
  const server = ns.getServer(target)
  server.hackDifficulty = server.minDifficulty
  server.moneyAvailable = server.moneyMax
  const moneyMax = server.moneyMax!
  const myCores = ns.getServer(host).cpuCores

  // Find optimal hack threshold by testing different values
  ns.tprint("Optimizing hack threshold...")
  let bestThreshold = 0.5
  let bestMoneyPerSecond = 0
  const steps = 100

  const ramThreshold = 0.9

  const weakenTime = ns.formulas.hacking.weakenTime(server, player)

  const hackScriptRam = ns.getScriptRam("/hacking/hack.js")
  const weakenScriptRam = ns.getScriptRam("/hacking/weaken.js")
  const growScriptRam = ns.getScriptRam("/hacking/grow.js")

  let bestCycleTime = 0

  for (let i = 1; i <= steps - 1; i++) {
    const testThreshold = i / steps

    // Calculate threads for this threshold
    const { server: hackServer, player: hackPlayer } = hackServerInstance(server, player)
    const hackThreads = calculateHackThreads(hackServer, hackPlayer, moneyMax, testThreshold, ns)

    const { server: wkn1Server, player: wkn1Player } = wkn1ServerInstance(server, player, hackThreads, ns)
    const wkn1Threads = calculateWeakThreads(wkn1Server, wkn1Player, myCores)

    const { server: growServer, player: growPlayer } = growServerInstance(server, player, testThreshold)
    const growThreads = calculateGrowThreads(growServer, growPlayer, moneyMax, myCores, ns)

    const { server: wkn2Server, player: wkn2Player } = wkn2ServerInstance(server, player, growThreads, ns, myCores)
    const wkn2Threads = calculateWeakThreads(wkn2Server, wkn2Player, myCores)

    // Calculate RAM usage
    const totalBatchRam =
      hackScriptRam * hackThreads +
      weakenScriptRam * wkn1Threads +
      growScriptRam * growThreads +
      weakenScriptRam * wkn2Threads

    const batches = Math.floor((serverMaxRam / totalBatchRam) * ramThreshold)

    // Calculate total money per cycle
    // hackThreshold is the fraction LEFT on server, so (1 - hackThreshold) is what we hack
    const moneyPerBatch = moneyMax * (1 - testThreshold)
    const totalMoneyPerCycle = moneyPerBatch * batches

    // Calculate cycle time: last batch's W2 finishes at weakenTime + 2*batchDelay + (batches-1)*batchDelay*4
    const lastBatchOffset = (batches - 1) * batchDelay * 4
    const cycleTime = weakenTime + 2 * batchDelay + lastBatchOffset // in milliseconds
    const moneyPerSecond = (totalMoneyPerCycle / cycleTime) * 1000

    if (moneyPerSecond > bestMoneyPerSecond) {
      bestMoneyPerSecond = moneyPerSecond
      bestThreshold = testThreshold
      bestCycleTime = cycleTime
    }
  }

  ns.tprint(`Optimal hack threshold: ${(bestThreshold * 100).toFixed(2)}% (${ns.formatNumber(bestMoneyPerSecond)}/sec)`)
  ns.tprint(`Estimated cycle time: ${bestCycleTime.toFixed(2)}ms`)

  // Now actually prepare the server
  await prepareServer(ns, host, target)

  // Now calculate with optimal threshold
  const hackThreshold = bestThreshold

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

  const batches = Math.floor((serverMaxRam / totalBatchRam) * ramThreshold)

  const hackTime = ns.formulas.hacking.hackTime(server, player)
  const growTime = ns.formulas.hacking.growTime(server, player)

  ns.tprint(`Using batch delay of ${batchDelay}ms`)

  const hackAdditionalMsec = weakenTime - batchDelay - hackTime
  const wkn1AdditionalMsec = 0
  const growAdditionalMsec = weakenTime + batchDelay - growTime
  const wkn2AdditionalMsec = 2 * batchDelay

  ns.tprint(
    `Batch RAM: ${totalBatchRam.toFixed(2)} GB - Threads (H:${hackThreads} W1:${wkn1Threads} G:${growThreads} W2:${wkn2Threads})`
  )
  ns.tprint(`Can run ${batches} batches in parallel on ${host} (${serverMaxRam} GB RAM)`)
  ns.tprint(`Weaken time: ${weakenTime.toFixed(0)}ms`)
  ns.tprint(`Batch interval: ${batchDelay * 4}ms`)

  const minSecurity = ns.getServerMinSecurityLevel(target)
  const preHackSecurityIncrease = ns.getServerSecurityLevel(target) - minSecurity
  if (preHackSecurityIncrease > 0) {
    ns.tprint(`WARNING: ${target} security above minimum by ${preHackSecurityIncrease.toFixed(2)}`)
  }

  const preGrowSecurityIncrease = ns.getServerSecurityLevel(target) - minSecurity
  if (preGrowSecurityIncrease > ns.hackAnalyzeSecurity(hackThreads, target)) {
    ns.tprint(`WARNING: ${target} security above minimum by ${preGrowSecurityIncrease.toFixed(2)}`)
  }

  // Launch all batches at once
  const currentTime = Date.now()
  let lastPid = 0

  for (let batchCounter = 0; batchCounter < batches; batchCounter++) {
    const batchOffset = batchCounter * batchDelay * 4

    const hackStr = currentTime
    const hackEnd = hackStr + hackTime + hackAdditionalMsec + batchOffset
    const wkn1Str = currentTime
    const wkn1End = wkn1Str + weakenTime + wkn1AdditionalMsec + batchOffset
    const growStr = currentTime
    const growEnd = growStr + growTime + growAdditionalMsec + batchOffset
    const wkn2Str = currentTime
    const wkn2End = wkn2Str + weakenTime + wkn2AdditionalMsec + batchOffset

    const hackOpId = logBatchOperation("H", hackStr, hackEnd, batchCounter)
    const wkn1OpId = logBatchOperation("W", wkn1Str, wkn1End, batchCounter)
    const growOpId = logBatchOperation("G", growStr, growEnd, batchCounter)
    const wkn2OpId = logBatchOperation("W", wkn2Str, wkn2End, batchCounter)

    ns.exec("/hacking/hack.js", host, hackThreads, target, hackAdditionalMsec + batchOffset, hackOpId)
    ns.exec("/hacking/weaken.js", host, wkn1Threads, target, wkn1AdditionalMsec + batchOffset, wkn1OpId)
    ns.exec("/hacking/grow.js", host, growThreads, target, growAdditionalMsec + batchOffset, growOpId)
    lastPid = ns.exec("/hacking/weaken.js", host, wkn2Threads, target, wkn2AdditionalMsec + batchOffset, wkn2OpId)
  }

  // Wait for the last script to finish
  while (ns.isRunning(lastPid)) {
    await ns.sleep(100)
  }

  const finalSecurity = ns.getServerSecurityLevel(target)
  const currentMoney = ns.getServerMoneyAvailable(target)
  const maxMoney = ns.getServerMaxMoney(target)
  const moneyPercent = (currentMoney / maxMoney) * 100

  ns.tprint("SUCCESS: All batches completed")
  ns.tprint(
    `Security: ${finalSecurity.toFixed(2)} / ${minSecurity.toFixed(2)} (+${(finalSecurity - minSecurity).toFixed(2)})`
  )
  ns.tprint(`Money: ${moneyPercent.toFixed(2)}% (${ns.formatNumber(currentMoney)} / ${ns.formatNumber(maxMoney)})`)
}
