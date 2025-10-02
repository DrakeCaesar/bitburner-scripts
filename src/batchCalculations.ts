import { NS, Person, Player, Server } from "@ns"

export function hackServerInstance(server: Server, player: Player) {
  const serverCopy = { ...server }
  serverCopy.moneyAvailable = serverCopy.moneyMax!
  serverCopy.hackDifficulty = serverCopy.minDifficulty
  return { server: serverCopy, player }
}

export function wkn1ServerInstance(server: Server, player: Player, hackThreads: number, ns: NS) {
  const serverCopy = { ...server }
  serverCopy.hackDifficulty = serverCopy.minDifficulty! + ns.hackAnalyzeSecurity(hackThreads, undefined)

  return { server: serverCopy, player }
}

export function growServerInstance(server: Server, player: Player, hackThreshold: number) {
  const serverCopy = { ...server }
  serverCopy.moneyAvailable = serverCopy.moneyMax! * hackThreshold
  serverCopy.hackDifficulty = serverCopy.minDifficulty

  return { server: serverCopy, player }
}

export function wkn2ServerInstance(server: Server, player: Player, growThreads: number, ns: NS, myCores: number) {
  const serverCopy = { ...server }
  serverCopy.hackDifficulty = serverCopy.minDifficulty! + ns.growthAnalyzeSecurity(growThreads, undefined, myCores)
  return { server: serverCopy, player }
}

export function calculateHackThreads(server: Server, player: Person, moneyMax: number, hackThreshold: number, ns: NS) {
  const hackPct = ns.formulas.hacking.hackPercent(server, player)
  return Math.floor((moneyMax - moneyMax * hackThreshold) / (hackPct * moneyMax))
}

export function calculateWeakThreads(server: Server, player: Player, myCores: number) {
  const addedSecurity = server.hackDifficulty! - server.minDifficulty!
  return Math.max(1, Math.ceil(addedSecurity / (0.05 * (1 + (myCores - 1) / 16))))
}

export function calculateGrowThreads(server: Server, player: Person, moneyMax: number, myCores: number, ns: NS) {
  return Math.ceil(ns.formulas.hacking.growThreads(server, player, moneyMax, myCores))
}

export function getDelta(opTime: number, index: number) {
  return opTime / (2.5 + 2 * index)
}

export function getIndexFromDelta(opTime: number, targetDelta: number) {
  const index = (opTime / targetDelta - 2.5) / 2
  return Math.max(0, Math.round(index))
}

export function calculateOptimalDelta(maxWeakenTime: number, maxConcurrentBatches: number) {
  return maxWeakenTime / (maxConcurrentBatches * 4)
}

export async function killOtherInstances(ns: NS) {
  const currentScript = ns.getScriptName()
  const allServers = ns.getPurchasedServers().concat(["home"])

  for (const server of allServers) {
    const runningScripts = ns.ps(server)
    for (const script of runningScripts) {
      if (script.filename === currentScript && script.pid !== ns.pid) {
        ns.kill(script.pid)
      }
    }
  }
}

export async function copyRequiredScripts(ns: NS, host: string) {
  ns.scp("/hacking/hack.js", host)
  ns.scp("/hacking/grow.js", host)
  ns.scp("/hacking/weaken.js", host)
  ns.scp("/batchVisualizerStub.js", host)
}

export async function prepareServer(ns: NS, host: string, target: string) {
  const moneyMax = ns.getServerMaxMoney(target)
  const baseSecurity = ns.getServerMinSecurityLevel(target)
  const secTolerance = 0
  const moneyTolerance = 1
  const prepWeakenDelay = 100

  const player = ns.getPlayer()
  const myCores = ns.getServer(host).cpuCores

  const growScriptRam = ns.getScriptRam("/hacking/grow.js")
  const weakenScriptRam = ns.getScriptRam("/hacking/weaken.js")
  const availableRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host)

  ns.tprint(`Prep: Starting preparation with ${ns.formatRam(availableRam)} available RAM`)

  // Loop until server is prepared
  while (true) {
    const currentMoney = ns.getServerMoneyAvailable(target)
    const currentSec = ns.getServerSecurityLevel(target)

    // Check if preparation is complete
    if (currentMoney >= moneyMax * moneyTolerance && currentSec <= baseSecurity + secTolerance) {
      ns.tprint(
        `Prep: Complete - Money: ${ns.formatNumber(currentMoney)}/${ns.formatNumber(moneyMax)}, Security: ${currentSec.toFixed(2)}/${baseSecurity}`
      )
      break
    }

    const serverActual = ns.getServer(target)
    const currentAvailableRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host)

    // Grow if needed
    if (currentMoney < moneyMax * moneyTolerance) {
      const growThreadsNeeded = Math.ceil(ns.formulas.hacking.growThreads(serverActual, player, moneyMax, myCores))
      const maxGrowThreads = Math.floor(currentAvailableRam / growScriptRam)
      const growThreads = Math.min(growThreadsNeeded, maxGrowThreads)

      if (growThreads > 0) {
        ns.exec("/hacking/grow.js", host, growThreads, target, 0)
        await ns.sleep(prepWeakenDelay)
      }
    }

    // Weaken if needed
    if (currentSec > baseSecurity + secTolerance) {
      const secToReduce = currentSec - baseSecurity
      const weakenThreadsNeeded = Math.max(1, Math.ceil(secToReduce / (0.05 * (1 + (myCores - 1) / 16))))
      const currentAvailableRamAfterGrow = ns.getServerMaxRam(host) - ns.getServerUsedRam(host)
      const maxWeakenThreads = Math.floor(currentAvailableRamAfterGrow / weakenScriptRam)
      const weakenThreads = Math.min(weakenThreadsNeeded, maxWeakenThreads)

      if (weakenThreads > 0) {
        ns.exec("/hacking/weaken.js", host, weakenThreads, target, 0)
      }
    }

    // Wait for operations to complete
    const growTime = ns.formulas.hacking.growTime(serverActual, player)
    const weakenTime = ns.formulas.hacking.weakenTime(serverActual, player)
    const waitTime = Math.max(growTime, weakenTime) + 200
    await ns.sleep(waitTime)
  }

  return { moneyMax, baseSecurity, secTolerance, myCores }
}
