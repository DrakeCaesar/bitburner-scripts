/** @param {import("..").NS} ns */
export async function main(ns) {
  // Usage: run batch.js <target>
  const target = ns.args[0]
  const host = ns.getHostname()
  const moneyMax = ns.getServerMaxMoney(target)
  const securityMin = ns.getServerMinSecurityLevel(target)

  // Thresholds and tolerances.
  const growThreshold = 0.8 // (used for batch calculations)
  const hackThreshold = 0.25 // target: after hacking, money should fall to 25% of max.
  const secTolerance = 0.01 // allowed deviation in security
  const TOLERANCE = 0.01 // for comparing predicted percentages

  // Helper: Determine maximum number of threads available for a given script.
  function getMaxThreads(script) {
    const availableRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host)
    return Math.floor(availableRam / ns.getScriptRam(script))
  }

  // --- Get Server & Player Info ---
  const serverObj = ns.getServer(target)
  const player = ns.getPlayer()
  const myCores = ns.getServer(host).cpuCores

  /***********************
   * RESET PHASE         *
   ***********************/
  // Reset the target by ensuring its money is nearly 100% and its security is near the minimum.
  async function resetServer() {
    ns.tprint(`Resetting ${target} to full money and minimum security...`)
    // Loop until both conditions are met.
    while (
      ns.getServerMoneyAvailable(target) < moneyMax * 0.99 ||
      ns.getServerSecurityLevel(target) > securityMin + secTolerance
    ) {
      if (ns.getServerSecurityLevel(target) > securityMin + secTolerance) {
        // Only run weaken if security is high.
        let excess = ns.getServerSecurityLevel(target) - securityMin
        let threads = 1
        while (ns.weakenAnalyze(threads) < excess) {
          threads++
        }
        threads = Math.min(threads, getMaxThreads("/hacking/weaken.js"))
        if (threads > 0) {
          let weakenTime = ns.formulas.hacking.weakenTime(serverObj, player)
          ns.tprint(
            `Reset: Running weaken with ${threads} thread(s) for ${target}`
          )
          await runOp("/hacking/weaken.js", threads, weakenTime, "reset-weaken")
        }
      } else if (ns.getServerMoneyAvailable(target) < moneyMax * 0.99) {
        // Only run grow if money is low.
        const currentMoney = ns.getServerMoneyAvailable(target)
        const desiredMoney = moneyMax
        let threads = Math.ceil(
          ns.formulas.hacking.growThreads(
            serverObj,
            player,
            desiredMoney,
            myCores
          )
        )
        threads = Math.min(threads, getMaxThreads("/hacking/grow.js"))
        if (threads > 0) {
          let growTime = ns.formulas.hacking.growTime(serverObj, player)
          ns.tprint(
            `Reset: Running grow with ${threads} thread(s) for ${target}`
          )
          await runOp("/hacking/grow.js", threads, growTime, "reset-grow")
        }
      } else {
        break
      }
      await ns.sleep(100)
    }
    ns.tprint(
      `Reset complete: ${target} is at full money and minimum security.`
    )
  }

  /***********************
   * RUN OP FUNCTION     *
   ***********************/
  /**
   * Runs a script on the target and, after waiting for it to complete,
   * prints the updated status. If a predicted percentage is provided,
   * compares it to the actual percentage.
   *
   * @param {string} script - The script to run (e.g. "/hacking/hack.js")
   * @param {number} threads - Number of threads for the operation.
   * @param {number} runtime - Expected runtime (in ms) for the op.
   * @param {string} action - A label for the op (e.g. "hack", "grow", "weaken").
   * @param {number|null} predictedPct - (Optional) Predicted % of money (0–100)
   */
  async function runOp(script, threads, runtime, action, predictedPct = null) {
    ns.run(script, threads, target)
    await ns.sleep(runtime + 100)

    const actualMoneyPct = (ns.getServerMoneyAvailable(target) / moneyMax) * 100
    const secDiff = ns.getServerSecurityLevel(target) - securityMin
    let predictionMessage = ""
    if (predictedPct !== null) {
      if (Math.abs(actualMoneyPct - predictedPct) < TOLERANCE) {
        predictionMessage = " (MATCH)"
      } else {
        predictionMessage = ` (MISMATCH: predicted ${predictedPct.toFixed(2)}%, actual ${actualMoneyPct.toFixed(2)}%)`
      }
    }

    ns.tprint(
      `${target.padEnd(18)} | ${action.padEnd(12)} | t ${String(threads).padStart(6)} | S ${securityMin.toFixed(2)} + ${secDiff.toFixed(2).padStart(6)} | $ ${actualMoneyPct.toFixed(2).padEnd(8)}% | T ${ns.tFormat(runtime)}${predictionMessage}`
    )
  }

  // Run the reset phase.
  await resetServer()

  /***********************
   * CALCULATE THREADS   *
   ***********************/
  // At this point the server is "reset" (money near 100% and security near minimum).
  // ** Hack Threads **
  const hackPct = ns.formulas.hacking.hackPercent(serverObj, player)
  const hackThreads = Math.ceil((1 - hackThreshold) / hackPct)
  const predictedMoneyAfterHack = moneyMax * (1 - hackPct * hackThreads)
  const hackSecIncrease = ns.hackAnalyzeSecurity(hackThreads)
  const hackWeakenThreads = Math.ceil(hackSecIncrease / ns.weakenAnalyze(1))

  // ** Grow Threads **
  // Simulate the hacked state: money becomes hackThreshold * moneyMax.
  let hackedServer = Object.assign({}, serverObj)
  hackedServer.moneyAvailable = moneyMax * hackThreshold
  const growThreads = Math.ceil(
    ns.formulas.hacking.growThreads(hackedServer, player, moneyMax, myCores)
  )
  const predictedMoneyAfterGrow = ns.formulas.hacking.growAmount(
    hackedServer,
    player,
    growThreads,
    myCores
  )
  const GROW_SEC_INCREASE_PER_THREAD = 0.004
  const growSecIncrease = GROW_SEC_INCREASE_PER_THREAD * growThreads
  const growWeakenThreads = Math.ceil(growSecIncrease / ns.weakenAnalyze(1))

  /***********************
   * CALCULATE TIMINGS   *
   ***********************/
  const T_hack = ns.formulas.hacking.hackTime(serverObj, player)
  const T_grow = ns.formulas.hacking.growTime(serverObj, player)
  const T_weaken = ns.formulas.hacking.weakenTime(serverObj, player)

  /***********************
   * SCHEDULE THE BATCH  *
   ***********************/
  // Choose a common finish time for the batch.
  const currentTime = Date.now()
  const buffer = 200 // extra ms to ensure all ops complete
  const finishTime = currentTime + T_weaken + buffer
  // Offsets (in ms) to force a finishing order:
  // Desired finish order: hack → hack-weaken → grow → grow-weaken.
  const offsetHackWeaken = 50
  const offsetGrow = 100
  const offsetGrowWeaken = 150
  // Calculate delays so that each operation finishes (startTime + opTime) near finishTime.
  const delay_hack = finishTime - T_hack - currentTime
  const delay_hackWeaken =
    finishTime - T_weaken - currentTime + offsetHackWeaken
  const delay_grow = finishTime - T_grow - currentTime + offsetGrow
  const delay_growWeaken =
    finishTime - T_weaken - currentTime + offsetGrowWeaken

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
  // Each script expects: first parameter = target, second parameter = optional delay (ms).
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
