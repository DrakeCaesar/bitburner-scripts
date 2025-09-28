import { NS, Person, Player, Server } from "@ns"

export function prepForHack(server: Server, player: Player) {
  const serverCopy = { ...server }
  serverCopy.moneyAvailable = serverCopy.moneyMax!
  serverCopy.hackDifficulty = serverCopy.minDifficulty
  return { server: serverCopy, player }
}

export function prepForWeaken(server: Server, player: Player, hackThreads: number, ns: NS) {
  const serverCopy = { ...server }
  serverCopy.hackDifficulty = serverCopy.minDifficulty! + ns.hackAnalyzeSecurity(hackThreads, undefined)

  return { server: serverCopy, player }
}

export function prepForGrow(server: Server, player: Player, hackThreshold: number) {
  const serverCopy = { ...server }
  serverCopy.moneyAvailable = serverCopy.moneyMax! * hackThreshold
  serverCopy.hackDifficulty = serverCopy.minDifficulty

  return { server: serverCopy, player }
}

export function prepForWeaken2(server: Server, player: Player, growThreads: number, ns: NS, myCores: number) {
  const serverCopy = { ...server }
  serverCopy.hackDifficulty = serverCopy.minDifficulty! + ns.growthAnalyzeSecurity(growThreads, undefined, myCores)
  return { server: serverCopy, player }
}

export function calculateHackThreads(server: Server, player: Person, moneyMax: number, hackThreshold: number, ns: NS) {
  const hackPct = ns.formulas.hacking.hackPercent(server, player)
  return Math.ceil((moneyMax - moneyMax * hackThreshold) / (hackPct * moneyMax))
}

export function calculateWeakenThreads(server: Server, player: Player, myCores: number) {
  const addedSecurity = server.hackDifficulty! - server.minDifficulty!
  return Math.max(1, Math.ceil(addedSecurity / (0.05 * (1 + (myCores - 1) / 16))))
}

export function calculateGrowThreads(server: Server, player: Person, moneyMax: number, myCores: number, ns: NS) {
  return Math.ceil(ns.formulas.hacking.growThreads(server, player, moneyMax, myCores))
}

export function calculateWeakenThreads2(server: Server, player: Player, myCores: number) {
  return calculateWeakenThreads(server, player, myCores)
}

export function getDelta(opTime: number, index: number) {
  return opTime / (2.5 + 2 * index)
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
  const secTolerance = 0.01
  const moneyTolerance = 0.99
  const prepWeakenDelay = 100

  const player = ns.getPlayer()
  const myCores = ns.getServer(host).cpuCores

  const serverActual = ns.getServer(target)
  const growThreads = Math.ceil(ns.formulas.hacking.growThreads(serverActual, player, moneyMax, myCores))
  if (growThreads > 0) {
    ns.exec("/hacking/grow.js", host, growThreads, target, 0)
  }

  await ns.sleep(prepWeakenDelay)

  const addedSecurity = ns.growthAnalyzeSecurity(growThreads, target, myCores)
  const currentSec = ns.getServerSecurityLevel(target)
  const expectedSecAfterGrow = currentSec + addedSecurity
  const secToReduce = expectedSecAfterGrow - baseSecurity
  const weakenThreadsPre = Math.max(1, Math.ceil(secToReduce / (0.05 * (1 + (myCores - 1) / 16))))

  if (weakenThreadsPre > 0) {
    ns.exec("/hacking/weaken.js", host, weakenThreadsPre, target, 0)
  }

  const growTime = ns.formulas.hacking.growTime(serverActual, player)
  const weakenTime = ns.formulas.hacking.weakenTime(serverActual, player)
  const waitTime = Math.max(growTime, weakenTime) + 200
  await ns.sleep(waitTime)

  return { moneyMax, baseSecurity, secTolerance, myCores }
}
