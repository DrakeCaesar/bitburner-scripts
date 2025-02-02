/** @param {import("..").NS} ns */
export async function main(ns) {
  const target = ns.args[0]
  const moneyMax = ns.getServerMaxMoney(target)
  const securityMin = ns.getServerMinSecurityLevel(target)
  const host = ns.getHostname()

  // Thresholds and tolerances.
  const growThreshold = 1
  const hackThreshold = 0.25
  const secTolerance = 0.01

  /**
   * Runs a script on the target and, after waiting for it to complete,
   * prints the updated status.
   *
   * @param {string} script - The script to run (e.g. "/hacking/hack.js")
   * @param {number} threads - Number of threads for the operation.
   * @param {number} runtime - Expected runtime (in ms) for the op.
   * @param {string} action - A label for the op (e.g. "hack", "grow", "weaken").
   */
  async function runOp(script, threads, runtime, action) {
    ns.run(script, threads, target)
    await ns.sleep(runtime + 100)

    const actualMoneyPct = (ns.getServerMoneyAvailable(target) / moneyMax) * 100
    const secDiff = ns.getServerSecurityLevel(target) - securityMin
    ns.tprint(
      `${target.padEnd(18)} | ${action.padEnd(6)} | t ${String(threads).padStart(4)} | S ${securityMin.toFixed(2)} + ${secDiff.toFixed(2).padStart(6)} | $ ${actualMoneyPct.toFixed(2).padEnd(8)}% | T ${ns.tFormat(runtime)}`
    )
  }

  // Run weaken until the server's security level is near its minimum.
  async function weakenPhase() {
    const serverObj = ns.getServer(target)
    const player = ns.getPlayer()
    while (ns.getServerSecurityLevel(target) > securityMin + secTolerance) {
      const excess = ns.getServerSecurityLevel(target) - securityMin
      let threads = 1
      while (ns.weakenAnalyze(threads) < excess) {
        threads++
      }
      const weakenTime = ns.formulas.hacking.weakenTime(serverObj, player)
      await runOp("/hacking/weaken.js", threads, weakenTime, "weaken")
    }
  }

  // Grow the server's money until it reaches the desired threshold.
  async function growPhase() {
    const serverObj = ns.getServer(target)
    const player = ns.getPlayer()
    const myCores = ns.getServer(host).cpuCores
    while (ns.getServerMoneyAvailable(target) < moneyMax * growThreshold) {
      const desiredMoney = moneyMax * growThreshold
      let threads = Math.ceil(
        ns.formulas.hacking.growThreads(
          serverObj,
          player,
          desiredMoney,
          myCores
        )
      )
      const growTime = ns.formulas.hacking.growTime(serverObj, player)
      await runOp("/hacking/grow.js", threads, growTime, "grow")
    }
  }

  // Hack the server until its money is reduced to the target threshold.
  async function hackPhase() {
    const serverObj = ns.getServer(target)
    const player = ns.getPlayer()
    while (ns.getServerMoneyAvailable(target) > moneyMax * hackThreshold) {
      const currentMoney = ns.getServerMoneyAvailable(target)
      const hackPct = ns.formulas.hacking.hackPercent(serverObj, player)
      let threads = Math.ceil(
        (currentMoney - moneyMax * hackThreshold) / (hackPct * currentMoney)
      )
      const hackTime = ns.formulas.hacking.hackTime(serverObj, player)
      await runOp("/hacking/hack.js", threads, hackTime, "hack")
    }
  }

  // Main loop: repeatedly run the phases in sequence.
  while (true) {
    await weakenPhase()
    await growPhase()
    await weakenPhase()
    await hackPhase()
  }
}
