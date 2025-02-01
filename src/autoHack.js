/** @param {import("..").NS} ns */
export async function main(ns) {
  const target = ns.args[0],
    moneyMax = ns.getServerMaxMoney(target),
    securityMin = ns.getServerMinSecurityLevel(target),
    host = ns.getHostname()
  const growThreshold = 0.8,
    hackThreshold = 0.25,
    secTolerance = 0.01

  // Runs a script on the target and prints status with 2-decimal percentages.
  async function runOp(script, threads, runtime, action) {
    ns.run(script, threads, target)
    const moneyPct =
      ((ns.getServerMoneyAvailable(target) / moneyMax) * 100).toFixed(2) + "%"
    const secCur = ns.getServerSecurityLevel(target) - securityMin
    ns.tprint(
      `${target.padEnd(18)} | ${action.padEnd(6)} | t ${String(threads).padStart(4)} | S ${securityMin.toFixed(2)} + ${secCur.toFixed(2).padStart(6)} | $ ${moneyPct.padStart(8)} | T ${ns.tFormat(runtime)}`
    )
    await ns.sleep(runtime + 100)
  }

  async function weakenPhase() {
    while (ns.getServerSecurityLevel(target) > securityMin + secTolerance) {
      let excess = ns.getServerSecurityLevel(target) - securityMin,
        threads = 1
      while (ns.weakenAnalyze(threads) < excess) threads++
      const availableRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host),
        maxThreads = Math.floor(
          availableRam / ns.getScriptRam("/hacking/weaken.js")
        )
      threads = Math.min(threads, maxThreads)
      if (threads <= 0) {
        ns.print("Not enough RAM for weaken.")
        await ns.sleep(1000)
        continue
      }
      await runOp(
        "/hacking/weaken.js",
        threads,
        ns.getWeakenTime(target),
        "weaken"
      )
    }
  }

  async function growPhase() {
    while (ns.getServerMoneyAvailable(target) < moneyMax * growThreshold) {
      const currentMoney = ns.getServerMoneyAvailable(target),
        desiredMoney = moneyMax * growThreshold,
        serverObj = ns.getServer(target),
        player = ns.getPlayer(),
        myCores = ns.getServer(host).cpuCores
      let threads = Math.ceil(
        ns.formulas.hacking.growThreads(
          serverObj,
          player,
          desiredMoney,
          myCores
        )
      )
      const availableRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host),
        maxThreads = Math.floor(
          availableRam / ns.getScriptRam("/hacking/grow.js")
        )
      threads = Math.min(threads, maxThreads)
      if (threads <= 0) {
        ns.print("Not enough RAM for grow.")
        await ns.sleep(1000)
        continue
      }

      // Debug: Print predicted percentages with threads and threads - 1.
      const predictedPct =
          Math.min(
            ns.formulas.hacking.growAmount(
              serverObj,
              player,
              threads,
              myCores
            ) / moneyMax,
            1
          ) * 100,
        predictedPctLess =
          threads > 1
            ? Math.min(
                ns.formulas.hacking.growAmount(
                  serverObj,
                  player,
                  threads - 1,
                  myCores
                ) / moneyMax,
                1
              ) * 100
            : predictedPct
      ns.tprint(
        `DEBUG (grow): Using ${threads} threads -> predicted money: ${predictedPct.toFixed(2)}% of max.`
      )
      ns.tprint(
        `DEBUG (grow): Using ${threads - 1} threads -> predicted money: ${predictedPctLess.toFixed(2)}% of max.`
      )

      await runOp("/hacking/grow.js", threads, ns.getGrowTime(target), "grow")
    }
  }

  async function hackPhase() {
    while (ns.getServerMoneyAvailable(target) > moneyMax * hackThreshold) {
      const hackAmount =
        ns.getServerMoneyAvailable(target) - moneyMax * hackThreshold
      let threads = Math.ceil(ns.hackAnalyzeThreads(target, hackAmount))
      const availableRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host),
        maxThreads = Math.floor(
          availableRam / ns.getScriptRam("/hacking/hack.js")
        )
      threads = Math.min(threads, maxThreads)
      if (threads <= 0) {
        ns.print("Not enough RAM for hack.")
        await ns.sleep(1000)
        continue
      }
      await runOp("/hacking/hack.js", threads, ns.getHackTime(target), "hack")
    }
  }

  while (true) {
    await weakenPhase()
    await growPhase()
    await weakenPhase()
    await hackPhase()
  }
}
