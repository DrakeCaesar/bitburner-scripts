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
    server.money = server.moneyMax
    server.addedSecurity = 0
    server.security = server.baseSecurity
    return { server, player }
  }
  function prepForWeaken(server, player, hackThreads) {
    server.addedSecurity = ns.hackAnalyzeSecurity(hackThreads)
    server.security = server.baseSecurity + server.addedSecurity

    return { server, player }
  }
  function prepForGrow(server, player) {
    server.moneyAvailable = server.moneyMax * hackThreshold
    server.addedSecurity = 0
    server.security = server.baseSecurity

    return { server, player }
  }
  function prepForWeaken2(server, player, growThreads) {
    server.addedSecurity = ns.growthAnalyzeSecurity(growThreads)
    server.security = server.baseSecurity + server.addedSecurity

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
    let threads = 1
    while (ns.weakenAnalyze(threads) < server.addedSecurity) {
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
    // ns.tprint(`Batch ${batchCounter}: grow ${growThreads}`)

    const { server: weaken2Server, player: weaken2Player } = prepForWeaken2(
      server,
      player,
      growThreads
    )
    const weakenThreads2 = calculateWeakenThreads2(weaken2Server, weaken2Player)

    function getDeltaInterval(hackTime, index) {
      if (index === 0) {
        return [hackTime, Infinity]
      } else {
        const lowerBound = hackTime / (2 * index + 1)
        const upperBound = hackTime / (2 * index)
        return [lowerBound, upperBound]
      }
    }

    function getDelta(hackTime, index) {
      if (index === 0) {
        // For index 0, the interval is [hackTime, Infinity), so we'll just return hackTime.
        return hackTime
      } else {
        const [lower, upper] = getDeltaInterval(hackTime, index)
        return (lower + upper) / 2
      }
    }

    // Calculate operation times.
    const hackTime = ns.formulas.hacking.hackTime(server, player)
    const weakenTime = ns.formulas.hacking.weakenTime(server, player)
    const growTime = ns.formulas.hacking.growTime(server, player)
    const batchDelay = getDelta(hackTime, 1)
    // ns.tprint(`
    //   Hack time: ${hackTime}
    //   Weaken time: ${weakenTime}
    //   Grow time: ${growTime}
    //   Batch delay: ${batchDelay}
    // `)

    // Calculate sleep offsets so that the operations land in the desired order.
    const sleepHack = weakenTime - hackTime - 3 * batchDelay
    const sleepWeaken1 = batchCounter * batchDelay * 4
    const sleepGrow =
      weakenTime - growTime - batchDelay + batchCounter * batchDelay * 4
    const sleepWeaken2 = batchDelay + batchCounter * batchDelay * 4

    // ns.tprint(
    //   `Batch ${batchCounter}: hack ${hackThreads}, weaken1 ${weakenThreads1}, grow ${growThreads}, weaken2 ${weakenThreads2}`
    // )

    ns.exec("/hacking/hack.js", host, hackThreads, target, sleepHack)
    ns.exec("/hacking/weaken.js", host, weakenThreads1, target, sleepWeaken1)
    ns.exec("/hacking/grow.js", host, growThreads, target, sleepGrow)
    ns.exec("/hacking/weaken.js", host, weakenThreads2, target, sleepWeaken2)

    batchCounter++
    await ns.sleep(batchDelay * 4)
  }
}
