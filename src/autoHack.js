/** @param {import("..").NS} ns */
export async function main(ns) {
  const target = ns.args[0]
  const host = ns.getHostname()

  // Basic server parameters.
  const moneyMax = ns.getServerMaxMoney(target)
  const securityMin = ns.getServerMinSecurityLevel(target)

  // Thresholds.
  const growThreshold = 1
  const hackThreshold = 0.25
  const secTolerance = 0.01

  /**
   * Returns the current server and player objects.
   */
  function getServerAndPlayer() {
    return { server: ns.getServer(target), player: ns.getPlayer() }
  }

  /**
   * Calculate the number of threads required to reduce security to near its minimum.
   */
  function calculateWeakenThreads() {
    const excess = ns.getServerSecurityLevel(target) - securityMin
    let threads = 1
    while (ns.weakenAnalyze(threads) < excess) {
      threads++
    }
    return threads
  }

  /**
   * Calculate the number of threads required to grow the server's money to the desired level.
   */
  function calculateGrowThreads() {
    const myCores = ns.getServer(host).cpuCores
    const desiredMoney = moneyMax * growThreshold
    const { server, player } = getServerAndPlayer()
    return Math.ceil(
      ns.formulas.hacking.growThreads(server, player, desiredMoney, myCores)
    )
  }

  /**
   * Calculate the number of threads required to hack the server down to the target threshold.
   */
  function calculateHackThreads() {
    const currentMoney = ns.getServerMoneyAvailable(target)
    const { server, player } = getServerAndPlayer()
    const hackPct = ns.formulas.hacking.hackPercent(server, player)
    return Math.ceil(
      (currentMoney - moneyMax * hackThreshold) / (hackPct * currentMoney)
    )
  }

  /**
   * Executes an operation by running the given script with the provided number of threads,
   * waiting for it to complete, and printing the resulting status.
   *
   * @param {string} script - The script to run (e.g. "/hacking/hack.js").
   * @param {number} threads - Number of threads to use.
   * @param {number} runtime - Expected runtime of the operation (in ms).
   * @param {string} action - Label for the operation ("hack", "grow", "weaken").
   */
  async function runOp(script, threads, runtime, action) {
    ns.run(script, threads, target)
    await ns.sleep(runtime + 100)

    const actualMoneyPct = (ns.getServerMoneyAvailable(target) / moneyMax) * 100
    const secDiff = ns.getServerSecurityLevel(target) - securityMin
    ns.tprint(
      `${target.padEnd(18)} | ${action.padEnd(6)} | t ${String(threads).padStart(4)} | S ${securityMin.toFixed(
        2
      )} + ${secDiff.toFixed(2).padStart(6)} | $ ${actualMoneyPct.toFixed(2).padEnd(8)}% | T ${ns.tFormat(runtime)}`
    )
  }

  /**
   * A generic helper to process a phase.
   *
   * @param {string} phaseName - Name of the phase ("weaken", "grow", or "hack").
   * @param {() => boolean} conditionFn - Returns true if the phase should continue.
   * @param {() => number} threadCalcFn - Calculates the number of threads needed.
   * @param {(server: NS.Server, player: NS.Player) => number} runtimeCalcFn - Calculates the operation runtime.
   * @param {string} script - The script to run for this phase.
   */
  async function processPhase(
    phaseName,
    conditionFn,
    threadCalcFn,
    runtimeCalcFn,
    script
  ) {
    while (conditionFn()) {
      const threads = threadCalcFn()
      const { server, player } = getServerAndPlayer()
      const runtime = runtimeCalcFn(server, player)
      await runOp(script, threads, runtime, phaseName)
    }
  }

  // Condition functions for each phase.
  const weakenCondition = () =>
    ns.getServerSecurityLevel(target) > securityMin + secTolerance
  const growCondition = () =>
    ns.getServerMoneyAvailable(target) < moneyMax * growThreshold
  const hackCondition = () =>
    ns.getServerMoneyAvailable(target) > moneyMax * hackThreshold

  // Main loop: repeatedly run the phases in sequence.
  while (true) {
    await processPhase(
      "weaken",
      weakenCondition,
      calculateWeakenThreads,
      (server, player) => ns.formulas.hacking.weakenTime(server, player),
      "/hacking/weaken.js"
    )
    await processPhase(
      "grow",
      growCondition,
      calculateGrowThreads,
      (server, player) => ns.formulas.hacking.growTime(server, player),
      "/hacking/grow.js"
    )
    await processPhase(
      "weaken",
      weakenCondition,
      calculateWeakenThreads,
      (server, player) => ns.formulas.hacking.weakenTime(server, player),
      "/hacking/weaken.js"
    )
    await processPhase(
      "hack",
      hackCondition,
      calculateHackThreads,
      (server, player) => ns.formulas.hacking.hackTime(server, player),
      "/hacking/hack.js"
    )
    ns.tprint(JSON.stringify(ns.getServer(target), null, 2))
  }
}
