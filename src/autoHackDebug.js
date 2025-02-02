/** @param {import("..").NS} ns */
export async function main(ns) {
  const target = ns.args[0]
  const moneyMax = ns.getServerMaxMoney(target)
  const securityMin = ns.getServerMinSecurityLevel(target)
  const host = ns.getHostname()

  // Thresholds and tolerances.
  const growThreshold = 0.8
  const hackThreshold = 0.25
  const secTolerance = 0.01
  // Tolerance (in percentage points) for checking if prediction matches output.
  const TOLERANCE = 0.01

  // Helper function to determine the maximum number of threads available for a given script.
  function getMaxThreads(script) {
    const availableRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host)
    return Math.floor(availableRam / ns.getScriptRam(script))
  }

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
      `${target.padEnd(18)} | ${action.padEnd(6)} | t ${String(threads).padStart(4)} | S ${securityMin.toFixed(2)} + ${secDiff.toFixed(2).padStart(6)} | $ ${actualMoneyPct.toFixed(2).padEnd(8)}% | T ${ns.tFormat(runtime)}${predictionMessage}`
    )
  }

  async function weakenPhase() {
    const serverObj = ns.getServer(target)
    const player = ns.getPlayer()
    while (ns.getServerSecurityLevel(target) > securityMin + secTolerance) {
      let excess = ns.getServerSecurityLevel(target) - securityMin
      let threads = 1
      while (ns.weakenAnalyze(threads) < excess) {
        threads++
      }
      threads = Math.min(threads, getMaxThreads("/hacking/weaken.js"))
      if (threads <= 0) {
        ns.print("Not enough RAM for weaken.")
        await ns.sleep(1000)
        continue
      }
      const weakenTime = ns.formulas.hacking.weakenTime(serverObj, player)
      await runOp("/hacking/weaken.js", threads, weakenTime, "weaken")
    }
  }

  async function growPhase() {
    const serverObj = ns.getServer(target)
    const player = ns.getPlayer()
    const myCores = ns.getServer(host).cpuCores
    while (ns.getServerMoneyAvailable(target) < moneyMax * growThreshold) {
      const currentMoney = ns.getServerMoneyAvailable(target)
      const desiredMoney = moneyMax * growThreshold
      let threads = Math.ceil(
        ns.formulas.hacking.growThreads(
          serverObj,
          player,
          desiredMoney,
          myCores
        )
      )
      threads = Math.min(threads, getMaxThreads("/hacking/grow.js"))
      if (threads <= 0) {
        ns.print("Not enough RAM for grow.")
        await ns.sleep(1000)
        continue
      }

      // Calculate predicted money after grow.
      const predictedMoney = ns.formulas.hacking.growAmount(
        serverObj,
        player,
        threads,
        myCores
      )
      const predictedPct = Math.min((predictedMoney / moneyMax) * 100, 100)
      ns.tprint(
        `DEBUG (grow): Using ${threads} thread${threads > 1 ? "s" : ""} -> predicted money: ${predictedPct.toFixed(2)}% of max.`
      )
      const growTime = ns.formulas.hacking.growTime(serverObj, player)
      await runOp("/hacking/grow.js", threads, growTime, "grow", predictedPct)
    }
  }

  async function hackPhase() {
    const serverObj = ns.getServer(target)
    const player = ns.getPlayer()
    while (ns.getServerMoneyAvailable(target) > moneyMax * hackThreshold) {
      const currentMoney = ns.getServerMoneyAvailable(target)
      const hackPct = ns.formulas.hacking.hackPercent(serverObj, player)
      let threads = Math.ceil(
        (currentMoney - moneyMax * hackThreshold) / (hackPct * currentMoney)
      )
      threads = Math.min(threads, getMaxThreads("/hacking/hack.js"))
      if (threads <= 0) {
        ns.print("Not enough RAM for hack.")
        await ns.sleep(1000)
        continue
      }

      // Calculate predicted money remaining after hack.
      const predictedMoneyAfter = currentMoney * (1 - hackPct * threads)
      const predictedPct = Math.min((predictedMoneyAfter / moneyMax) * 100, 100)
      ns.tprint(
        `DEBUG (hack): Using ${threads} thread${threads > 1 ? "s" : ""} -> predicted money left: ${predictedPct.toFixed(2)}% of max.`
      )
      const hackTime = ns.formulas.hacking.hackTime(serverObj, player)
      await runOp("/hacking/hack.js", threads, hackTime, "hack", predictedPct)
    }
  }

  while (true) {
    await weakenPhase()
    await growPhase()
    await weakenPhase()
    await hackPhase()
  }
}
