/** @param {import("..").NS} ns */
export async function main(ns) {
  // Basic parameters.
  const target = ns.args[0]
  const host = ns.getHostname()
  const moneyMax = ns.getServerMaxMoney(target)
  const baseSecurity = ns.getServerMinSecurityLevel(target)
  const secTolerance = 0.01 // acceptable security deviation
  const moneyTolerance = 0.99 // we want at least 99% of max money
  const prepWeakenDelay = 100 // Delay (in ms) after launching grow before weakening
  const batchDelay = 200 // Delay between batches
  const hackThreshold = 0.25 // leave 25% behind

  // Get basic player and host stats.
  const player = ns.getPlayer()
  const myCores = ns.getServer(host).cpuCores

  /******************************************************************
   * PRE-BATCH (PREP) PHASE
   *
   * Linear pre-batching: run grow and then weaken (if needed) to bring
   * the server to 100% money and base security.
   ******************************************************************/

  // (1) Calculate and execute grow.
  const serverActual = ns.getServer(target)
  let growThreads = Math.ceil(
    ns.formulas.hacking.growThreads(
      serverActual,
      player,
      moneyMax, // target: 100% money
      myCores
    )
  )
  if (growThreads > 0) {
    ns.tprint(
      `Pre-Batch: Executing grow with ${growThreads} thread(s) on ${target}.`
    )
    ns.exec("/hacking/grow.js", host, growThreads, target, 0)
  } else {
    ns.tprint(
      `Pre-Batch: Grow not needed on ${target} (already at 100% money).`
    )
  }

  // Wait a short delay before launching weaken.
  await ns.sleep(prepWeakenDelay)

  // (2) Estimate security increase from grow, then calculate and execute weaken.
  const addedSecurity = ns.growthAnalyzeSecurity(growThreads, target, myCores)
  const currentSec = ns.getServerSecurityLevel(target)
  const expectedSecAfterGrow = currentSec + addedSecurity
  const secToReduce = expectedSecAfterGrow - baseSecurity
  let weakenThreadsPre = 0
  while (ns.weakenAnalyze(++weakenThreadsPre, myCores) < secToReduce) {
    // Increment until the reduction meets or exceeds secToReduce.
  }
  if (weakenThreadsPre > 0) {
    ns.tprint(
      `Pre-Batch: Executing weaken with ${weakenThreadsPre} thread(s) on ${target}.`
    )
    ns.exec("/hacking/weaken.js", host, weakenThreadsPre, target, 0)
  } else {
    ns.tprint(
      `Pre-Batch: Weaken not needed on ${target} (security is at base).`
    )
  }

  // Wait for the longer of grow/weaken to finish (plus a small buffer).
  const growTime = ns.formulas.hacking.growTime(serverActual, player)
  const weakenTime = ns.formulas.hacking.weakenTime(serverActual, player)
  const waitTime = Math.max(growTime, weakenTime) + 200
  ns.tprint(`Pre-Batch: Waiting ${waitTime} ms for grow/weaken to complete...`)
  await ns.sleep(waitTime)

  // Confirm that the server is prepped.
  const postMoney = ns.getServerMoneyAvailable(target)
  const postSec = ns.getServerSecurityLevel(target)
  if (postMoney < moneyMax * moneyTolerance) {
    ns.tprint(`WARNING: Money is only ${postMoney} (target ${moneyMax}).`)
  }
  if (postSec > baseSecurity + secTolerance) {
    ns.tprint(`WARNING: Security is ${postSec} (target ${baseSecurity}).`)
  }
  ns.tprint(
    `Pre-Batch complete on ${target}: ${postMoney} money, ${postSec} security.`
  )

  /******************************************************************
   * THREAD CALCULATION & PREP FUNCTIONS
   *
   * Here we define four functions for thread calculation (one per op)
   * that accept server and player objects. We also define four “prep”
   * functions that modify the server and/or player objects before passing
   * them along. (Currently, the prep functions simply return the objects,
   * but you can insert any desired modifications.)
   ******************************************************************/

  // Prep functions: adjust server/player objects as needed.
  function prepForHack(server, player) {
    // Insert modifications for hack calculations here if needed.
    return { server, player }
  }
  function prepForWeaken(server, player) {
    // Insert modifications for weaken calculations here if needed.
    return { server, player }
  }
  function prepForGrow(server, player) {
    // Insert modifications for grow calculations here if needed.
    return { server, player }
  }
  function prepForWeaken2(server, player) {
    // Insert modifications for second weaken calculations here if needed.
    return { server, player }
  }

  // Thread calculation functions.
  function calculateHackThreads(server, player) {
    // Use the formulas to calculate hack threads.
    const hackPct = ns.formulas.hacking.hackPercent(server, player)
    return Math.ceil(
      (moneyMax - moneyMax * hackThreshold) / (hackPct * moneyMax)
    )
  }
  function calculateWeakenThreads(server, player) {
    // Calculate the number of threads needed to reduce security back to base.
    const excess = ns.getServerSecurityLevel(target) - baseSecurity
    let threads = 1
    while (ns.weakenAnalyze(threads, myCores) < excess) {
      threads++
    }
    return threads
  }
  function calculateGrowThreads(server, player) {
    // Calculate threads needed to grow money to 100%.
    return Math.ceil(
      ns.formulas.hacking.growThreads(server, player, moneyMax, myCores)
    )
  }
  // For the second weaken, we'll use the same calculation as for the first.
  function calculateWeakenThreads2(server, player) {
    return calculateWeakenThreads(server, player)
  }

  /******************************************************************
   * MAIN BATCH LOOP
   *
   * In the loop we get the live server and player objects, run them
   * through the appropriate prep functions, then pass them into the
   * corresponding thread calculation functions.
   ******************************************************************/

  let batchCounter = 0
  ns.tprint("Entering main batching loop.")
  while (true) {
    // Get live server/player.
    const server = ns.getServer(target)
    // For each op, run the corresponding prep function.
    const { server: hackServer, player: hackPlayer } = prepForHack(
      server,
      player
    )
    const { server: weakenServer, player: weakenPlayer } = prepForWeaken(
      server,
      player
    )
    const { server: growServer, player: growPlayer } = prepForGrow(
      server,
      player
    )
    const { server: weaken2Server, player: weaken2Player } = prepForWeaken2(
      server,
      player
    )

    // Calculate thread counts for each operation.
    const hackThreads = calculateHackThreads(hackServer, hackPlayer)
    const weakenThreads1 = calculateWeakenThreads(weakenServer, weakenPlayer)
    const growThreads = calculateGrowThreads(growServer, growPlayer)
    const weakenThreads2 = calculateWeakenThreads2(weaken2Server, weaken2Player)

    // Calculate operation times.
    const hackTime = ns.formulas.hacking.hackTime(server, player)
    const weakenTime = ns.formulas.hacking.weakenTime(server, player)
    const growTime = ns.formulas.hacking.growTime(server, player)

    // Calculate sleep offsets so that the operations land in the desired order.
    const sleepHack = weakenTime - hackTime - 3 * batchDelay
    const sleepWeaken1 = batchCounter * batchDelay * 4
    const sleepGrow =
      weakenTime - growTime - batchDelay + batchCounter * batchDelay * 4
    const sleepWeaken2 = batchDelay + batchCounter * batchDelay * 4

    // Launch the batch: hack, weaken, grow, weaken.
    ns.exec("/hacking/hack.js", host, hackThreads, target, sleepHack)
    ns.exec("/hacking/weaken.js", host, weakenThreads1, target, sleepWeaken1)
    ns.exec("/hacking/grow.js", host, growThreads, target, sleepGrow)
    ns.exec("/hacking/weaken.js", host, weakenThreads2, target, sleepWeaken2)

    batchCounter++
    await ns.sleep(batchDelay)
  }
}
