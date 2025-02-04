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

  function getServerAndPlayer() {
    return { server: ns.getServer(target), player: ns.getPlayer() }
  }

  function calculateWeakenThreads() {
    const excess = ns.getServerSecurityLevel(target) - securityMin
    let threads = 1
    while (ns.weakenAnalyze(threads) < excess) {
      threads++
    }
    return threads
  }

  function calculateGrowThreads() {
    const myCores = ns.getServer(host).cpuCores
    const desiredMoney = moneyMax * growThreshold
    const { server, player } = getServerAndPlayer()
    return Math.ceil(
      ns.formulas.hacking.growThreads(server, player, desiredMoney, myCores)
    )
  }

  function calculateHackThreads() {
    const { server, player } = getServerAndPlayer()
    const hackPct = ns.formulas.hacking.hackPercent(server, player)
    return Math.ceil(
      (moneyMax - moneyMax * hackThreshold) / (hackPct * moneyMax)
    )
  }

  let batchCounter = 0

  while (true) {
    const { server, player } = getServerAndPlayer()

    const hackThreads = calculateHackThreads()
    const weakenThreads1 = calculateWeakenThreads()
    const growThreads = calculateGrowThreads()
    const weakenThreads2 = calculateWeakenThreads()

    const hackTime = ns.formulas.hacking.hackTime(server, player)
    const weakenTime = ns.formulas.hacking.weakenTime(server, player)
    const growTime = ns.formulas.hacking.growTime(server, player)

    // Calculate sleep offsets to align execution
    const sleepHack = weakenTime - hackTime - 3 * batchDelay
    const sleepWeaken1 = batchCounter * batchDelay * 4
    const sleepGrow =
      weakenTime - growTime - batchDelay + batchCounter * batchDelay * 4
    const sleepWeaken2 = batchDelay + batchCounter * batchDelay * 4

    // Execute HWGW batch in order
    ns.exec("/hacking/hack.js", host, hackThreads, target, sleepHack)
    ns.exec("/hacking/weaken.js", host, weakenThreads1, target, sleepWeaken1)
    ns.exec("/hacking/grow.js", host, growThreads, target, sleepGrow)
    ns.exec("/hacking/weaken.js", host, weakenThreads2, target, sleepWeaken2)

    batchCounter++
    await ns.sleep(batchDelay)
  }
}
