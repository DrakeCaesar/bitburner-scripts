/** @param {import("..").NS} ns */
export async function main(ns) {
  // Usage: run batch.js <target>
  const target = ns.args[0]
  const host = ns.getHostname()
  const moneyMax = ns.getServerMaxMoney(target)
  const securityMin =
    ns.getServerMaxMoney(target) > 0 ? ns.getServerMinSecurityLevel(target) : 1 // just a fallback; normally moneyMax > 0

  // --- Settings & Helpers ---
  // For a batch, we assume the server starts at full money and minimal security.
  // After hacking, we want the server's money to drop to hackThreshold * moneyMax.
  const hackThreshold = 0.25 // (i.e. hack until 25% remains)

  // Helper: Determine maximum threads available for a given script on the host.
  function getMaxThreads(script) {
    const availableRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host)
    return Math.floor(availableRam / ns.getScriptRam(script))
  }

  // --- Get Server & Player Info ---
  const serverObj = ns.getServer(target)
  const player = ns.getPlayer()
  const myCores = ns.getServer(host).cpuCores

  /***********************
   * CALCULATE THREADS   *
   ***********************/
  // ** Hack Threads **
  // To drop money from 100% to hackThreshold%,
  // you must steal (1 - hackThreshold) fraction of money.
  const hackPct = ns.formulas.hacking.hackPercent(serverObj, player)
  const hackThreads = Math.ceil((1 - hackThreshold) / hackPct)
  // Predicted money after hack: ideally equals moneyMax*hackThreshold.
  const predictedMoneyAfterHack = moneyMax * (1 - hackPct * hackThreads)

  // ** Hack-Weaken Threads **
  const hackSecIncrease = ns.hackAnalyzeSecurity(hackThreads)
  const hackWeakenThreads = Math.ceil(hackSecIncrease / ns.weakenAnalyze(1))

  // ** Grow Threads **
  // We simulate the hacked state by cloning the server object and setting its money to moneyMax*hackThreshold.
  let hackedServer = Object.assign({}, serverObj)
  hackedServer.moneyAvailable = moneyMax * hackThreshold
  const growThreads = Math.ceil(
    ns.formulas.hacking.growThreads(hackedServer, player, moneyMax, myCores)
  )
  // Predicted money after grow (should be ~moneyMax):
  const predictedMoneyAfterGrow = ns.formulas.hacking.growAmount(
    hackedServer,
    player,
    growThreads,
    myCores
  )

  // ** Grow-Weaken Threads **
  // Since ns.growAnalyzeSecurity is no longer available, we assume a constant increase per thread.
  const GROW_SEC_INCREASE_PER_THREAD = 0.004
  const growSecIncrease = GROW_SEC_INCREASE_PER_THREAD * growThreads
  const growWeakenThreads = Math.ceil(growSecIncrease / ns.weakenAnalyze(1))

  /***********************
   * CALCULATE TIMINGS   *
   ***********************/
  // Use the Formulas API to get predicted times.
  const T_hack = ns.formulas.hacking.hackTime(serverObj, player)
  const T_grow = ns.formulas.hacking.growTime(serverObj, player)
  const T_weaken = ns.formulas.hacking.weakenTime(serverObj, player)

  /***********************
   * SCHEDULE THE BATCH  *
   ***********************/
  // We choose a common finish time for the batch.
  const currentTime = Date.now()
  const buffer = 200 // extra ms to ensure all ops complete
  const finishTime = currentTime + T_weaken + buffer

  // Offsets (in ms) to force a finishing order:
  // We want hack to finish first, then hack-weaken, then grow, then grow-weaken.
  const offsetHackWeaken = 50
  const offsetGrow = 100
  const offsetGrowWeaken = 150

  // Calculate delays so that:
  // startTime + operationTime ≈ finishTime (with the offsets applied)
  const delay_hack = finishTime - T_hack - currentTime
  const delay_hackWeaken =
    finishTime - T_weaken - currentTime + offsetHackWeaken
  const delay_grow = finishTime - T_grow - currentTime + offsetGrow
  const delay_growWeaken =
    finishTime - T_weaken - currentTime + offsetGrowWeaken

  // Print Batch Details (for debugging)
  ns.tprint(`Batch for ${target}:`)
  ns.tprint(
    ` Hack: ${hackThreads} thread(s) [predicted money left: ${((predictedMoneyAfterHack / moneyMax) * 100).toFixed(2)}%] | Time: ${T_hack.toFixed(0)} ms`
  )
  ns.tprint(
    ` Hack-Weaken: ${hackWeakenThreads} thread(s) | Time: ${T_weaken.toFixed(0)} ms`
  )
  ns.tprint(
    ` Grow: ${growThreads} thread(s) [predicted money after grow: ${((Math.min(predictedMoneyAfterGrow, moneyMax) / moneyMax) * 100).toFixed(2)}%] | Time: ${T_grow.toFixed(0)} ms`
  )
  ns.tprint(
    ` Grow-Weaken: ${growWeakenThreads} thread(s) | Time: ${T_weaken.toFixed(0)} ms`
  )
  ns.tprint(
    ` Delays (ms): hack: ${delay_hack.toFixed(0)}, hackWeaken: ${delay_hackWeaken.toFixed(0)}, grow: ${delay_grow.toFixed(0)}, growWeaken: ${delay_growWeaken.toFixed(0)}`
  )

  /***********************
   * LAUNCH THE BATCH    *
   ***********************/
  // Each script now expects: first argument = target, second argument = optional delay (ms, defaulting to 0)
  ns.exec("/hacking/hack.js", host, hackThreads, target, delay_hack)
  ns.exec(
    "/hacking/weaken.js",
    host,
    hackWeakenThreads,
    target,
    delay_hackWeaken
  )
  ns.exec("/hacking/grow.js", host, growThreads, target, delay_grow)
  ns.exec(
    "/hacking/weaken.js",
    host,
    growWeakenThreads,
    target,
    delay_growWeaken
  )

  ns.tprint("Batch launched.")
}
