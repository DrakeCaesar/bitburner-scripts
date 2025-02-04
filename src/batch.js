/** @param {import("..").NS} ns */
export async function main(ns) {
  const target = ns.args[0]
  const host = ns.getHostname()

  // Basic server parameters.
  const moneyMax = ns.getServerMaxMoney(target)
  const baseSecurity = ns.getServerMinSecurityLevel(target)

  // Tolerances and delay values.
  const secTolerance = 0.01 // acceptable security deviation
  const moneyTolerance = 0.99 // we want at least 99% of max money
  const prepWeakenDelay = 100 // Delay (in ms) after launching grow before weakening

  // Get current player's stats.
  const player = ns.getPlayer()
  const myCores = ns.getServer(host).cpuCores

  /******************************************************************
   * PREP PHASE (Pre-Batching)
   *
   * Instead of a loop, we perform one linear set of operations:
   *  1. Calculate the number of grow threads needed to bring the
   *     server to 100% money.
   *  2. Exec grow (if needed).
   *  3. After a short delay, calculate the extra security that will be
   *     added by grow and exec weaken (if needed) to bring the server back
   *     to its base security.
   *  4. Wait for both scripts to finish and confirm that the server is
   *     prepped.
   ******************************************************************/

  // 1. Calculate the number of grow threads needed to get to 100% money.
  const serverActual = ns.getServer(target)
  let growThreads = Math.ceil(
    ns.formulas.hacking.growThreads(
      serverActual,
      player,
      moneyMax, // target 100% money
      myCores
    )
  )
  if (growThreads > 0) {
    ns.tprint(
      `Pre-Batch: Launching grow with ${growThreads} thread(s) to reach 100% money on ${target}.`
    )
    // 2. Exec grow.
    ns.exec("/hacking/grow.js", host, growThreads, target, 0)
  } else {
    ns.tprint(
      `Pre-Batch: Grow not needed because ${target} is already at 100% money.`
    )
  }

  // 3. Wait a short delay before launching weaken.
  await ns.sleep(prepWeakenDelay)

  // Estimate the security increase due to grow.
  const addedSecurity = ns.growthAnalyzeSecurity(growThreads, target, myCores)
  const currentSec = ns.getServerSecurityLevel(target)
  const expectedSecAfterGrow = currentSec + addedSecurity

  // Calculate the number of weaken threads required to bring security to base.
  const secToReduce = expectedSecAfterGrow - baseSecurity
  let weakenThreads = 0
  while (ns.weakenAnalyze(++weakenThreads, myCores) < secToReduce) {
    // Increment until the reduction meets or exceeds secToReduce.
  }
  if (weakenThreads > 0) {
    ns.tprint(
      `Pre-Batch: Launching weaken with ${weakenThreads} thread(s) to reduce security to base (${baseSecurity}).`
    )
    ns.exec("/hacking/weaken.js", host, weakenThreads, target, 0)
  } else {
    ns.tprint(
      `Pre-Batch: Weaken not needed because security is already at base.`
    )
  }

  // 4. Wait for both grow and weaken to finish.
  const growTime = ns.formulas.hacking.growTime(serverActual, player)
  const weakenTime = ns.formulas.hacking.weakenTime(serverActual, player)
  const waitTime = Math.max(growTime, weakenTime) + 200
  ns.tprint(
    `Pre-Batch: Waiting ${waitTime} ms for grow and weaken to finish...`
  )
  await ns.sleep(waitTime)

  // Validate that the server is prepped.
  const postMoney = ns.getServerMoneyAvailable(target)
  const postSec = ns.getServerSecurityLevel(target)
  if (postMoney < moneyMax * moneyTolerance) {
    ns.tprint(
      `WARNING: Pre-Batch money not at target. Got ${postMoney} (target ${moneyMax}).`
    )
  }
  if (postSec > baseSecurity + secTolerance) {
    ns.tprint(
      `WARNING: Pre-Batch security not at base. Got ${postSec} (target ${baseSecurity}).`
    )
  }
  ns.tprint(
    `Pre-Batch complete: ${target} now has ${postMoney} money and ${postSec} security.`
  )

  /******************************************************************
   * MAIN BATCH LOOP (Assumes Server is Prepped)
   *
   * Since the server is now at 100% money and base security, we assume
   * that the batching scripts below do not need a thread count check.
   ******************************************************************/

  const batchDelay = 200
  let batchCounter = 0

  // Helper: Returns an idealized server for formula calculations.
  function getServerAndPlayer() {
    const server = ns.getServer(target)
    server.moneyAvailable = moneyMax
    server.hackDifficulty = baseSecurity
    return { server, player: ns.getPlayer() }
  }

  // Helper: Calculate weaken threads based on current (real) security.
  function calculateWeakenThreads() {
    const excess = ns.getServerSecurityLevel(target) - baseSecurity
    let threads = 1
    while (ns.weakenAnalyze(threads, myCores) < excess) {
      threads++
    }
    return threads
  }

  // Helper: Calculate grow threads to bring money to 100%.
  function calculateGrowThreads() {
    const { server, player } = getServerAndPlayer()
    return Math.ceil(
      ns.formulas.hacking.growThreads(server, player, moneyMax, myCores)
    )
  }

  // Helper: Calculate hack threads to hack money above a threshold.
  const hackThreshold = 0.25 // leave 25% behind
  function calculateHackThreads() {
    const { server, player } = getServerAndPlayer()
    const hackPct = ns.formulas.hacking.hackPercent(server, player)
    return Math.ceil(
      (moneyMax - moneyMax * hackThreshold) / (hackPct * moneyMax)
    )
  }

  ns.tprint("Entering main batching loop.")
  while (true) {
    const { server, player } = getServerAndPlayer()

    const hackThreads = calculateHackThreads()
    const weakenThreads1 = calculateWeakenThreads()
    const growThreads = calculateGrowThreads()
    const weakenThreads2 = calculateWeakenThreads()

    const hackTime = ns.formulas.hacking.hackTime(server, player)
    const weakenTime = ns.formulas.hacking.weakenTime(server, player)
    const growTime = ns.formulas.hacking.growTime(server, player)

    // Calculate sleep offsets for proper ordering.
    const sleepHack = weakenTime - hackTime - 3 * batchDelay
    const sleepWeaken1 = batchCounter * batchDelay * 4
    const sleepGrow =
      weakenTime - growTime - batchDelay + batchCounter * batchDelay * 4
    const sleepWeaken2 = batchDelay + batchCounter * batchDelay * 4

    ns.exec("/hacking/hack.js", host, hackThreads, target, sleepHack)
    ns.exec("/hacking/weaken.js", host, weakenThreads1, target, sleepWeaken1)
    ns.exec("/hacking/grow.js", host, growThreads, target, sleepGrow)
    ns.exec("/hacking/weaken.js", host, weakenThreads2, target, sleepWeaken2)

    batchCounter++
    await ns.sleep(batchDelay)
  }
}
