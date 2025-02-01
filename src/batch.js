/** @param {import("..").NS} ns */
export async function main(ns) {
  // Usage: run batch.js target
  const target = ns.args[0]
  const host = ns.getHostname()
  const moneyMax = ns.getServerMaxMoney(target)
  const securityMin = ns.getServerMinSecurityLevel(target)

  // Batch thresholds:
  // After hacking, we want the server to fall to hackThreshold * moneyMax.
  const hackThreshold = 0.25 // i.e. hack until 25% remains

  // Number of batches to run.
  const NUM_BATCHES = 5

  for (let batch = 1; batch <= NUM_BATCHES; batch++) {
    ns.tprint(`=== Launching batch ${batch} ===`)

    // Get updated server and player objects.
    const serverObj = ns.getServer(target)
    const player = ns.getPlayer()
    const myCores = ns.getServer(host).cpuCores

    /***********************
     * CALCULATE THREADS   *
     ***********************/
    // --- Hack Threads ---
    // We want to steal enough money to drop the server from full (100%) to hackThreshold (25%).
    // hackThreads ≈ ceil((1 - hackThreshold) / hackPercent)
    const hackPct = ns.formulas.hacking.hackPercent(serverObj, player)
    const hackThreads = Math.ceil((1 - hackThreshold) / hackPct)
    const hackSecIncrease = ns.hackAnalyzeSecurity(hackThreads)
    const hackWeakenThreads = Math.ceil(hackSecIncrease / ns.weakenAnalyze(1))

    // --- Grow Threads ---
    // After hacking, the server's money is reduced to hackThreshold * moneyMax.
    // To restore it to full, we simulate a hacked server.
    let hackedServer = Object.assign({}, serverObj)
    hackedServer.moneyAvailable = moneyMax * hackThreshold
    const growThreads = Math.ceil(
      ns.formulas.hacking.growThreads(hackedServer, player, moneyMax, myCores)
    )
    // Since ns.growAnalyzeSecurity is no longer available, assume a constant security increase per grow thread.
    const GROW_SEC_INCREASE_PER_THREAD = 0.004
    const growSecIncrease = GROW_SEC_INCREASE_PER_THREAD * growThreads
    const growWeakenThreads = Math.ceil(growSecIncrease / ns.weakenAnalyze(1))

    /***********************
     * CALCULATE TIMINGS   *
     ***********************/
    const T_hack = ns.formulas.hacking.hackTime(serverObj, player)
    const T_grow = ns.formulas.hacking.growTime(serverObj, player)
    const T_weaken = ns.formulas.hacking.weakenTime(serverObj, player)

    // We choose a finish time for the batch.
    const currentTime = Date.now()
    const buffer = 200 // extra ms to ensure operations complete
    const finishTime = currentTime + T_weaken + buffer // use weaken time as baseline

    // Offsets to fine-tune the finish order:
    const offsetHackWeaken = 50
    const offsetGrow = 100
    const offsetGrowWeaken = 150

    // Calculate delays so that each operation finishes near finishTime:
    const delay_hack = finishTime - T_hack - currentTime
    const delay_hackWeaken =
      finishTime - T_weaken - currentTime + offsetHackWeaken
    const delay_grow = finishTime - T_grow - currentTime + offsetGrow
    const delay_growWeaken =
      finishTime - T_weaken - currentTime + offsetGrowWeaken

    ns.tprint(`Batch ${batch} parameters for target: ${target}`)
    ns.tprint(
      `Hack: ${hackThreads} thread(s), hack time: ${T_hack.toFixed(0)} ms`
    )
    ns.tprint(
      `Hack-Weaken: ${hackWeakenThreads} thread(s), weaken time: ${T_weaken.toFixed(0)} ms`
    )
    ns.tprint(
      `Grow: ${growThreads} thread(s), grow time: ${T_grow.toFixed(0)} ms`
    )
    ns.tprint(
      `Grow-Weaken: ${growWeakenThreads} thread(s), weaken time: ${T_weaken.toFixed(0)} ms`
    )
    ns.tprint(
      `Delays (ms): hack: ${delay_hack.toFixed(0)}, hackWeaken: ${delay_hackWeaken.toFixed(0)}, grow: ${delay_grow.toFixed(0)}, growWeaken: ${delay_growWeaken.toFixed(0)}`
    )

    /***********************
     * LAUNCH THE BATCH    *
     ***********************/
    // Note: the individual scripts expect (delay, target) as arguments.
    ns.exec("/hacking/hack.js", host, hackThreads, delay_hack, target)
    ns.exec(
      "/hacking/weaken.js",
      host,
      hackWeakenThreads,
      delay_hackWeaken,
      target
    )
    ns.exec("/hacking/grow.js", host, growThreads, delay_grow, target)
    ns.exec(
      "/hacking/weaken.js",
      host,
      growWeakenThreads,
      delay_growWeaken,
      target
    )

    ns.tprint(`Batch ${batch} launched.`)

    // Wait for the batch to finish before launching the next one.
    // We wait for the longest finishing time among the operations plus an extra buffer.
    const waitTime =
      Math.max(
        delay_hack + T_hack,
        delay_hackWeaken + T_weaken,
        delay_grow + T_grow,
        delay_growWeaken + T_weaken
      ) + 500
    ns.tprint(
      `Waiting ${waitTime.toFixed(0)} ms for batch ${batch} to complete...`
    )
    await ns.sleep(waitTime)
  }
  ns.tprint("All batches launched.")
}
