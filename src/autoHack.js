/** @param {import("..").NS} ns */
export async function main(ns) {
  const target = ns.args[0]
  const moneyMax = ns.getServerMaxMoney(target)
  const securityMin = ns.getServerMinSecurityLevel(target)
  const current = ns.getHostname()

  // A small tolerance so we don’t get stuck due to floating point issues.
  const secTolerance = 0.01

  while (true) {
    // -------------------------
    // PHASE 1: WEAKEN until security is at minimum
    // -------------------------
    while (ns.getServerSecurityLevel(target) > securityMin + secTolerance) {
      let secCur = ns.getServerSecurityLevel(target)
      let excessSec = secCur - securityMin
      // Calculate minimum threads needed so that weakenAnalyze(threads) >= excessSec
      let threads = 1
      while (ns.weakenAnalyze(threads) < excessSec) {
        threads++
      }
      // Cap threads based on available RAM
      let availableRam =
        ns.getServerMaxRam(current) - ns.getServerUsedRam(current)
      let weakenRam = ns.getScriptRam("/hacking/weaken.js")
      let maxThreads = Math.floor(availableRam / weakenRam)
      threads = Math.min(threads, maxThreads)
      if (threads <= 0) {
        ns.print("Not enough RAM for weaken. Sleeping 1 sec.")
        await ns.sleep(1000)
        continue
      }
      let runtime = ns.getWeakenTime(target)
      ns.run("/hacking/weaken.js", threads, target)
      let moneyPct = String(
        Math.floor((ns.getServerMoneyAvailable(target) / moneyMax) * 100) + "%"
      ).padStart(4)
      let secDisplay = (secCur - securityMin).toFixed(2).padStart(6)
      let msg =
        target.padEnd(18) +
        " | weaken | t " +
        String(threads).padStart(4) +
        " | S " +
        String(securityMin.toFixed(2)).padStart(3) +
        " + " +
        secDisplay +
        " | $ " +
        moneyPct +
        " | T " +
        ns.tFormat(runtime).padStart(30)
      ns.tprint(msg)
      ns.print(msg)
      await ns.sleep(runtime + 100)
    }

    // -------------------------
    // PHASE 2: GROW until money is at least 90% of max
    // -------------------------
    while (ns.getServerMoneyAvailable(target) < moneyMax * 0.9) {
      let moneyCur = ns.getServerMoneyAvailable(target)
      // Determine growth factor and threads needed to reach max money
      let growthFactor = moneyMax / moneyCur
      let threads = Math.ceil(ns.growthAnalyze(target, growthFactor))
      let availableRam =
        ns.getServerMaxRam(current) - ns.getServerUsedRam(current)
      let growRam = ns.getScriptRam("/hacking/grow.js")
      let maxThreads = Math.floor(availableRam / growRam)
      threads = Math.min(threads, maxThreads)
      if (threads <= 0) {
        ns.print("Not enough RAM for grow. Sleeping 1 sec.")
        await ns.sleep(1000)
        continue
      }
      let runtime = ns.getGrowTime(target)
      ns.run("/hacking/grow.js", threads, target)
      let moneyPct = String(
        Math.floor((ns.getServerMoneyAvailable(target) / moneyMax) * 100) + "%"
      ).padStart(4)
      let secDisplay = (ns.getServerSecurityLevel(target) - securityMin)
        .toFixed(2)
        .padStart(6)
      let msg =
        target.padEnd(18) +
        " | grow   | t " +
        String(threads).padStart(4) +
        " | S " +
        String(securityMin.toFixed(2)).padStart(3) +
        " + " +
        secDisplay +
        " | $ " +
        moneyPct +
        " | T " +
        ns.tFormat(runtime).padStart(30)
      ns.tprint(msg)
      ns.print(msg)
      await ns.sleep(runtime + 100)
    }

    // -------------------------
    // PHASE 3: WEAKEN again to bring security down (growth raises security)
    // -------------------------
    while (ns.getServerSecurityLevel(target) > securityMin + secTolerance) {
      let secCur = ns.getServerSecurityLevel(target)
      let excessSec = secCur - securityMin
      let threads = 1
      while (ns.weakenAnalyze(threads) < excessSec) {
        threads++
      }
      let availableRam =
        ns.getServerMaxRam(current) - ns.getServerUsedRam(current)
      let weakenRam = ns.getScriptRam("/hacking/weaken.js")
      let maxThreads = Math.floor(availableRam / weakenRam)
      threads = Math.min(threads, maxThreads)
      if (threads <= 0) {
        ns.print("Not enough RAM for weaken. Sleeping 1 sec.")
        await ns.sleep(1000)
        continue
      }
      let runtime = ns.getWeakenTime(target)
      ns.run("/hacking/weaken.js", threads, target)
      let moneyPct = String(
        Math.floor((ns.getServerMoneyAvailable(target) / moneyMax) * 100) + "%"
      ).padStart(4)
      let secDisplay = (secCur - securityMin).toFixed(2).padStart(6)
      let msg =
        target.padEnd(18) +
        " | weaken | t " +
        String(threads).padStart(4) +
        " | S " +
        String(securityMin.toFixed(2)).padStart(3) +
        " + " +
        secDisplay +
        " | $ " +
        moneyPct +
        " | T " +
        ns.tFormat(runtime).padStart(30)
      ns.tprint(msg)
      ns.print(msg)
      await ns.sleep(runtime + 100)
    }

    // -------------------------
    // PHASE 4: HACK until money is reduced to 25% of max
    // -------------------------
    while (ns.getServerMoneyAvailable(target) > moneyMax * 0.25) {
      let moneyCur = ns.getServerMoneyAvailable(target)
      // Calculate the amount we want to remove so that the remaining money is 25% of max.
      let hackAmount = moneyCur - moneyMax * 0.25
      let threads = Math.ceil(ns.hackAnalyzeThreads(target, hackAmount))
      let availableRam =
        ns.getServerMaxRam(current) - ns.getServerUsedRam(current)
      let hackRam = ns.getScriptRam("/hacking/hack.js")
      let maxThreads = Math.floor(availableRam / hackRam)
      threads = Math.min(threads, maxThreads)
      if (threads <= 0) {
        ns.print("Not enough RAM for hack. Sleeping 1 sec.")
        await ns.sleep(1000)
        continue
      }
      let runtime = ns.getHackTime(target)
      ns.run("/hacking/hack.js", threads, target)
      let moneyPct = String(
        Math.floor((ns.getServerMoneyAvailable(target) / moneyMax) * 100) + "%"
      ).padStart(4)
      let secDisplay = (ns.getServerSecurityLevel(target) - securityMin)
        .toFixed(2)
        .padStart(6)
      let msg =
        target.padEnd(18) +
        " | hack   | t " +
        String(threads).padStart(4) +
        " | S " +
        String(securityMin.toFixed(2)).padStart(3) +
        " + " +
        secDisplay +
        " | $ " +
        moneyPct +
        " | T " +
        ns.tFormat(runtime).padStart(30)
      ns.tprint(msg)
      ns.print(msg)
      await ns.sleep(runtime + 100)
    }
  }
}
