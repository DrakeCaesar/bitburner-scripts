/** @param {import("..").NS} ns */
export async function main(ns) {
  const target = ns.args[0]
  const moneyMax = ns.getServerMaxMoney(target)
  const securityMin = ns.getServerMinSecurityLevel(target)
  const host = ns.getHostname()

  // Thresholds and tolerances.
  const secTolerance = 0.01 // Allowable margin above the minimum security.
  const growThreshold = 0.9 // Grow until the server reaches 90% of max money.
  const hackThreshold = 0.25 // Hack until the server falls to 25% of max money.

  /**
   * Runs a script, prints status, and waits until its runtime is over.
   *
   * @param {string} script The script to run.
   * @param {number} threads The number of threads to use.
   * @param {number} runtime The estimated runtime.
   * @param {string} action A label for the action (weaken, grow, hack).
   */
  async function runOperation(script, threads, runtime, action) {
    ns.run(script, threads, target)
    const moneyPct =
      Math.floor((ns.getServerMoneyAvailable(target) / moneyMax) * 100) + "%"
    const currentSec = ns.getServerSecurityLevel(target)
    const secDisplay = (currentSec - securityMin).toFixed(2)
    const message = `${target.padEnd(18)} | ${action.padEnd(6)} | t ${String(threads).padStart(4)} | S ${securityMin.toFixed(2)} + ${secDisplay.padStart(6)} | $ ${moneyPct.padStart(4)} | T ${ns.tFormat(runtime)}`
    ns.tprint(message)
    ns.print(message)
    await ns.sleep(runtime + 100)
  }

  /**
   * Phase 1 & 3: Weaken until security is at its minimum.
   */
  async function weakenPhase() {
    while (ns.getServerSecurityLevel(target) > securityMin + secTolerance) {
      const currentSec = ns.getServerSecurityLevel(target)
      const excessSec = currentSec - securityMin

      // Determine the threads needed so that weakenAnalyze(threads) >= excessSec.
      let threads = 1
      while (ns.weakenAnalyze(threads) < excessSec) {
        threads++
      }

      // Limit threads based on available RAM.
      const availableRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host)
      const scriptRam = ns.getScriptRam("/hacking/weaken.js")
      const maxThreads = Math.floor(availableRam / scriptRam)
      threads = Math.min(threads, maxThreads)

      if (threads <= 0) {
        ns.print("Not enough RAM for weaken. Sleeping for 1 second.")
        await ns.sleep(1000)
        continue
      }

      const runtime = ns.getWeakenTime(target)
      await runOperation("/hacking/weaken.js", threads, runtime, "weaken")
    }
  }

  /**
   * Phase 2: Grow until money reaches at least 90% of the maximum.
   */
  async function growPhase() {
    while (ns.getServerMoneyAvailable(target) < moneyMax * growThreshold) {
      const currentMoney = ns.getServerMoneyAvailable(target)
      // Determine the growth factor needed.
      const growthFactor = moneyMax / currentMoney
      let threads = Math.ceil(ns.growthAnalyze(target, growthFactor))

      // Limit threads based on available RAM.
      const availableRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host)
      const scriptRam = ns.getScriptRam("/hacking/grow.js")
      const maxThreads = Math.floor(availableRam / scriptRam)
      threads = Math.min(threads, maxThreads)

      if (threads <= 0) {
        ns.print("Not enough RAM for grow. Sleeping for 1 second.")
        await ns.sleep(1000)
        continue
      }

      const runtime = ns.getGrowTime(target)
      await runOperation("/hacking/grow.js", threads, runtime, "grow")
    }
  }

  /**
   * Phase 4: Hack until money falls to 25% of the maximum.
   */
  async function hackPhase() {
    while (ns.getServerMoneyAvailable(target) > moneyMax * hackThreshold) {
      const currentMoney = ns.getServerMoneyAvailable(target)
      // Calculate how much money to remove to reach the target threshold.
      const hackAmount = currentMoney - moneyMax * hackThreshold
      let threads = Math.ceil(ns.hackAnalyzeThreads(target, hackAmount))

      // Limit threads based on available RAM.
      const availableRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host)
      const scriptRam = ns.getScriptRam("/hacking/hack.js")
      const maxThreads = Math.floor(availableRam / scriptRam)
      threads = Math.min(threads, maxThreads)

      if (threads <= 0) {
        ns.print("Not enough RAM for hack. Sleeping for 1 second.")
        await ns.sleep(1000)
        continue
      }

      const runtime = ns.getHackTime(target)
      await runOperation("/hacking/hack.js", threads, runtime, "hack")
    }
  }

  // Main loop: run the phases sequentially in a cycle.
  while (true) {
    // Phase 1: Weaken until security is minimal.
    await weakenPhase()

    // Phase 2: Grow until money is at least 90% of maximum.
    await growPhase()

    // Phase 3: Weaken again to counteract the security increase from growing.
    await weakenPhase()

    // Phase 4: Hack until money falls to 25% of maximum.
    await hackPhase()
  }
}
