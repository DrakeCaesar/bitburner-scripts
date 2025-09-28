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
  ns.tprint("Entering main batching loop.")
  const server = ns.getServer(target)
  while (true) {
    const player = ns.getPlayer()

    ns.tprint(`\n=== BATCH ${batchCounter} PREDICTIONS ===`)
    ns.tprint(
      `Base server state: money=${server.moneyAvailable}, security=${server.hackDifficulty}, minSec=${server.minDifficulty}`
    )

    const { server: hackServer, player: hackPlayer } = prepForHack(server, player)
    ns.tprint(`PrepForHack: money=${hackServer.moneyAvailable}, security=${hackServer.hackDifficulty}`)
    const hackThreads = calculateHackThreads(hackServer, hackPlayer, moneyMax, hackThreshold, ns)
    ns.tprint(`Hack threads calculated: ${hackThreads}`)

    const { server: weakenServer, player: weakenPlayer } = prepForWeaken(server, player, hackThreads, ns)
    ns.tprint(
      `PrepForWeaken1: security=${weakenServer.hackDifficulty} (base=${server.minDifficulty} + hackSec=${ns.hackAnalyzeSecurity(hackThreads, undefined)})`
    )
    const weakenThreads1 = calculateWeakenThreads(weakenServer, weakenPlayer, myCores)
    ns.tprint(`Weaken1 threads calculated: ${weakenThreads1}`)

    const { server: growServer, player: growPlayer } = prepForGrow(server, player, hackThreshold)
    ns.tprint(`PrepForGrow: money=${growServer.moneyAvailable}, security=${growServer.hackDifficulty}`)
    const growThreads = calculateGrowThreads(growServer, growPlayer, moneyMax, myCores, ns)
    ns.tprint(`Grow threads calculated: ${growThreads}`)

    const { server: weaken2Server, player: weaken2Player } = prepForWeaken2(server, player, growThreads, ns, myCores)
    ns.tprint(
      `PrepForWeaken2: security=${weaken2Server.hackDifficulty} (base=${server.minDifficulty} + growSec=${ns.growthAnalyzeSecurity(growThreads, undefined, myCores)})`
    )
    const weakenThreads2 = calculateWeakenThreads2(weaken2Server, weaken2Player, myCores)
    ns.tprint(`Weaken2 threads calculated: ${weakenThreads2}`)

    const hackTime = ns.formulas.hacking.hackTime(hackServer, hackPlayer)
    const weakenTime = ns.formulas.hacking.weakenTime(weakenServer, weakenPlayer)
    const growTime = ns.formulas.hacking.growTime(growServer, growPlayer)
    const weaken2Time = ns.formulas.hacking.weakenTime(weaken2Server, weaken2Player)

    ns.tprint(
      `Operation times: hack=${hackTime}ms, weaken1=${weakenTime}ms, grow=${growTime}ms, weaken2=${weaken2Time}ms`
    )

    if (weakenTime !== weaken2Time) {
      ns.tprint(`Weaken times do not match: ${weakenTime} vs ${weaken2Time}`)
    }

    const batchDelay = getDelta(weakenTime, 0)
    ns.tprint(`Batch delay calculated: ${batchDelay}ms`)

    // Set the batch interval in the visualizer on first calculation
    if (batchCounter === 0) {
      setBatchInterval(batchDelay * 4) // Total time for one complete batch (4 operations)
    }

    const sleepHack = weakenTime - hackTime
    const sleepWeaken1 = 0
    const sleepGrow = weakenTime - growTime
    const sleepWeaken2 = 0

    ns.tprint(
      `Sleep times: hack=${sleepHack}ms, weaken1=${sleepWeaken1}ms, grow=${sleepGrow}ms, weaken2=${sleepWeaken2}ms`
    )

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

    ns.tprint(
      `Expected completion order: hack=${hackEnd}, weaken1=${weaken1End}, grow=${growEnd}, weaken2=${weaken2End}`
    )
    ns.tprint(`=== END BATCH ${batchCounter} PREDICTIONS ===\n`)

    // Log operations to visualiser (predicting when they'll complete) and get operation IDs
    const hackOpId = logBatchOperation("H", hackStart, hackEnd, batchCounter)
    const weaken1OpId = logBatchOperation("W", weaken1Start, weaken1End, batchCounter)
    const growOpId = logBatchOperation("G", growStart, growEnd, batchCounter)
    const weaken2OpId = logBatchOperation("W", weaken2Start, weaken2End, batchCounter)

    // Check security before hack operation
    const preHackSec = ns.getServerSecurityLevel(target)
    const expectedHackSec = hackServer.hackDifficulty! // Should be baseSecurity
    const hackSecDifference = Math.abs(preHackSec - expectedHackSec)
    if (hackSecDifference > secTolerance) {
      ns.tprint(
        `SECURITY CHECK (Hack): Expected ${expectedHackSec.toFixed(3)}, Actual ${preHackSec.toFixed(3)}, Difference ${hackSecDifference.toFixed(3)}`
      )
    }

    ns.exec("/hacking/hack.js", host, hackThreads, target, sleepHack, hackOpId)
    await ns.sleep(batchDelay)

    // Check security before first weaken operation
    const preWeaken1Sec = ns.getServerSecurityLevel(target)
    const expectedWeaken1Sec = weakenServer.hackDifficulty!
    const weaken1SecDifference = Math.abs(preWeaken1Sec - expectedWeaken1Sec)
    if (weaken1SecDifference > secTolerance) {
      ns.tprint(
        `SECURITY CHECK (Weaken1): Expected ${expectedWeaken1Sec.toFixed(3)}, Actual ${preWeaken1Sec.toFixed(3)}, Difference ${weaken1SecDifference.toFixed(3)}`
      )
    }

    ns.exec("/hacking/weaken.js", host, weakenThreads1, target, sleepWeaken1, weaken1OpId)
    await ns.sleep(batchDelay)

    // Check security before grow operation
    const preGrowSec = ns.getServerSecurityLevel(target)
    const expectedGrowSec = growServer.hackDifficulty! // Should be baseSecurity
    const growSecDifference = Math.abs(preGrowSec - expectedGrowSec)
    if (growSecDifference > secTolerance) {
      ns.tprint(
        `SECURITY CHECK (Grow): Expected ${expectedGrowSec.toFixed(3)}, Actual ${preGrowSec.toFixed(3)}, Difference ${growSecDifference.toFixed(3)}`
      )
    }

    ns.exec("/hacking/grow.js", host, growThreads, target, sleepGrow, growOpId)
    await ns.sleep(batchDelay)

    // Check security before second weaken operation
    const preWeaken2Sec = ns.getServerSecurityLevel(target)
    const expectedWeaken2Sec = weaken2Server.hackDifficulty!
    const weaken2SecDifference = Math.abs(preWeaken2Sec - expectedWeaken2Sec)
    if (weaken2SecDifference > secTolerance) {
      ns.tprint(
        `SECURITY CHECK (Weaken2): Expected ${expectedWeaken2Sec.toFixed(3)}, Actual ${preWeaken2Sec.toFixed(3)}, Difference ${weaken2SecDifference.toFixed(3)}`
      )
    }

    ns.exec("/hacking/weaken.js", host, weakenThreads2, target, sleepWeaken2, weaken2OpId)
    await ns.sleep(batchDelay)

    batchCounter++
    nextBatch() // Advance to next batch in visualiser
  }
}
