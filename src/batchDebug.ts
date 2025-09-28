import { NS, Person, Player, Server } from "@ns"
import { clearVisualization, initBatchVisualiser, logBatchOperation, nextBatch } from "./batchVisualiser.js"

// Store for tracking operation timings from the individual scripts
interface PendingOperation {
  type: "H" | "W" | "G"
  batchId: number
  expectedStart: number
  expectedEnd: number
}

export async function main(ns: NS) {
  // Initialize the real-time visualiser
  const visualiser = initBatchVisualiser()
  clearVisualization() // Start fresh

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
  const growThreads = Math.ceil(ns.formulas.hacking.growThreads(serverActual, player, moneyMax, myCores))
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
  const weakenThreadsPre = Math.max(1, Math.ceil(secToReduce / (0.05 * (1 + (myCores - 1) / 16))))

  if (weakenThreadsPre > 0) {
    ns.tprint(`Prep: Executing weaken with ${weakenThreadsPre} threads on ${target}.`)
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
  ns.tprint(`Prep complete on ${target}: ${postMoney} money, ${postSec} security.`)

  function prepForHack(server: Server, player: Player) {
    server.moneyAvailable = server.moneyMax!
    server.hackDifficulty = server.minDifficulty
    return { server, player }
  }
  function prepForWeaken(server: Server, player: Player, hackThreads: number) {
    server.hackDifficulty = server.minDifficulty! + ns.hackAnalyzeSecurity(hackThreads, undefined)

    return { server, player }
  }
  function prepForGrow(server: Server, player: Player) {
    server.moneyAvailable = server.moneyMax! * hackThreshold
    server.hackDifficulty = server.minDifficulty

    return { server, player }
  }
  function prepForWeaken2(server: Server, player: Player, growThreads: number) {
    server.hackDifficulty = server.minDifficulty! + ns.growthAnalyzeSecurity(growThreads, undefined, myCores)

    return { server, player }
  }

  function calculateHackThreads(server: Server, player: Person) {
    const hackPct = ns.formulas.hacking.hackPercent(server, player)
    return Math.ceil((moneyMax - moneyMax * hackThreshold) / (hackPct * moneyMax))
  }
  function calculateWeakenThreads(server: Server, player: Player) {
    const addedSecurity = server.hackDifficulty! - server.minDifficulty!
    return Math.max(1, Math.ceil(addedSecurity / (0.05 * (1 + (myCores - 1) / 16))))
  }
  function calculateGrowThreads(server: Server, player: Person) {
    return Math.ceil(ns.formulas.hacking.growThreads(server, player, moneyMax, myCores))
  }
  function calculateWeakenThreads2(server: Server, player: Player) {
    return calculateWeakenThreads(server, player)
  }

  // Background task to parse tprint logs and update visualization
  async function parseLogsForVisualization() {
    const logFile = "/tmp/batch_timings.txt"

    while (true) {
      try {
        if (ns.fileExists(logFile)) {
          const logContent = ns.read(logFile)
          const lines = logContent.split("\n").filter((line) => line.trim())

          for (const line of lines) {
            try {
              // Parse log entries like: ("H", 1739062605984, 1739062612737),
              const match = line.match(/\("([HWG])", (\d+), (\d+)\)/)
              if (match) {
                const [, type, start, end] = match
                logBatchOperation(
                  type as "H" | "W" | "G",
                  parseInt(start),
                  parseInt(end),
                  Math.floor(parseInt(start) / 10000) // Simple batch ID based on time
                )
              }
            } catch (e) {
              // Ignore parsing errors for individual lines
            }
          }

          // Clear the log file to avoid re-processing
          ns.write(logFile, "", "w")
        }
      } catch (e) {
        // Ignore file access errors
      }

      await ns.sleep(100) // Check every 100ms
    }
  }

  // Start the log parsing in the background (simulated)
  // Note: In a real implementation, you'd need a separate script for this
  // parseLogsForVisualization() // Commented out as it would block

  let batchCounter = 0
  ns.tprint("Entering main batching loop.")
  const server = ns.getServer(target)

  while (true) {
    const player = ns.getPlayer()

    const { server: hackServer, player: hackPlayer } = prepForHack(server, player)
    const hackThreads = calculateHackThreads(hackServer, hackPlayer)

    const { server: weakenServer, player: weakenPlayer } = prepForWeaken(server, player, hackThreads)
    const weakenThreads1 = calculateWeakenThreads(weakenServer, weakenPlayer)

    const { server: growServer, player: growPlayer } = prepForGrow(server, player)
    const growThreads = calculateGrowThreads(growServer, growPlayer)

    const { server: weaken2Server, player: weaken2Player } = prepForWeaken2(server, player, growThreads)
    const weakenThreads2 = calculateWeakenThreads2(weaken2Server, weaken2Player)

    function getDelta(opTime: number, index: number) {
      return opTime / (2.5 + 2 * index)
    }

    const hackTime = ns.formulas.hacking.hackTime(hackServer, hackPlayer)
    const weakenTime = ns.formulas.hacking.weakenTime(weakenServer, weakenPlayer)
    const growTime = ns.formulas.hacking.growTime(growServer, growPlayer)
    const weaken2Time = ns.formulas.hacking.weakenTime(weaken2Server, weaken2Player)

    if (weakenTime !== weaken2Time) {
      ns.tprint(`Weaken times do not match: ${weakenTime} vs ${weaken2Time}`)
    }

    const batchDelay = getDelta(weakenTime, 2)

    const sleepHack = weakenTime - hackTime
    const sleepWeaken1 = 0
    const sleepGrow = weakenTime - growTime
    const sleepWeaken2 = 0

    // Calculate predicted completion times for visualization
    const currentTime = Date.now()
    const hackStart = currentTime
    const hackEnd = hackStart + hackTime + sleepHack
    const weaken1Start = currentTime + batchDelay
    const weaken1End = weaken1Start + weakenTime + sleepWeaken1
    const growStart = currentTime + 2 * batchDelay
    const growEnd = growStart + growTime + sleepGrow
    const weaken2Start = currentTime + 3 * batchDelay
    const weaken2End = weaken2Start + weakenTime + sleepWeaken2

    // Log predicted operations to visualiser (these will show as bars)
    logBatchOperation("H", hackStart, hackEnd, batchCounter)
    logBatchOperation("W", weaken1Start, weaken1End, batchCounter)
    logBatchOperation("G", growStart, growEnd, batchCounter)
    logBatchOperation("W", weaken2Start, weaken2End, batchCounter)

    // Print batch info for debugging
    ns.tprint(
      `Batch ${batchCounter}: hack ${hackThreads}, weaken1 ${weakenThreads1}, grow ${growThreads}, weaken2 ${weakenThreads2}`
    )

    ns.exec("/hacking/hack.js", host, hackThreads, target, sleepHack)
    await ns.sleep(batchDelay)
    ns.exec("/hacking/weaken.js", host, weakenThreads1, target, sleepWeaken1)
    await ns.sleep(batchDelay)
    ns.exec("/hacking/grow.js", host, growThreads, target, sleepGrow)
    await ns.sleep(batchDelay)
    ns.exec("/hacking/weaken.js", host, weakenThreads2, target, sleepWeaken2)
    await ns.sleep(batchDelay)

    batchCounter++
    nextBatch() // Advance to next batch in visualiser

    // Optional: slow down the loop to make visualization more readable
    if (batchCounter > 0 && batchCounter % 5 === 0) {
      await ns.sleep(1000) // Pause every 5 batches for 1 second
    }
  }
}
