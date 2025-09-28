import { NS, Person, Player, Server } from "@ns"

export function prepForHack(server: Server, player: Player) {
  server.moneyAvailable = server.moneyMax!
  server.hackDifficulty = server.minDifficulty
  return { server, player }
}

export function prepForWeaken(server: Server, player: Player, hackThreads: number, ns: NS) {
  server.hackDifficulty =
    server.minDifficulty! + ns.hackAnalyzeSecurity(hackThreads, undefined)

  return { server, player }
}

export function prepForGrow(server: Server, player: Player, hackThreshold: number) {
  server.moneyAvailable = server.moneyMax! * hackThreshold
  server.hackDifficulty = server.minDifficulty

  return { server, player }
}

export function prepForWeaken2(server: Server, player: Player, growThreads: number, ns: NS, myCores: number) {
  server.hackDifficulty =
    server.minDifficulty! +
    ns.growthAnalyzeSecurity(growThreads, undefined, myCores)

  return { server, player }
}

export function calculateHackThreads(server: Server, player: Person, moneyMax: number, hackThreshold: number, ns: NS) {
  const hackPct = ns.formulas.hacking.hackPercent(server, player)
  return Math.ceil(
    (moneyMax - moneyMax * hackThreshold) / (hackPct * moneyMax)
  )
}

export function calculateWeakenThreads(server: Server, player: Player, myCores: number) {
  const addedSecurity = server.hackDifficulty! - server.minDifficulty!
  return Math.max(
    1,
    Math.ceil(addedSecurity / (0.05 * (1 + (myCores - 1) / 16)))
  )
}

export function calculateGrowThreads(server: Server, player: Person, moneyMax: number, myCores: number, ns: NS) {
  return Math.ceil(
    ns.formulas.hacking.growThreads(server, player, moneyMax, myCores)
  )
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
        ns.tprint(
          `Killed other instance of ${currentScript} on ${server} (PID: ${script.pid})`
        )
      }
    }
  }
}

export async function copyRequiredScripts(ns: NS, host: string) {
  ns.scp("/hacking/hack.js", host)
  ns.scp("/hacking/grow.js", host)
  ns.scp("/hacking/weaken.js", host)
  ns.scp("/batchVisualizerStub.js", host)
  ns.tprint(`Copied scripts to ${host}`)
}

export async function prepareServer(ns: NS, host: string, target: string) {
  const moneyMax = ns.getServerMaxMoney(target)
  const baseSecurity = ns.getServerMinSecurityLevel(target)
  const secTolerance = 0.01
  const moneyTolerance = 0.99
  const prepWeakenDelay = 100

  const player = ns.getPlayer()
  const myCores = ns.getServer(host).cpuCores
  ns.tprint(`cores: ${myCores}`)

  const serverActual = ns.getServer(target)
  const growThreads = Math.ceil(
    ns.formulas.hacking.growThreads(serverActual, player, moneyMax, myCores)
  )
  if (growThreads > 0) {
    ns.tprint(`Prep: Executing grow with ${growThreads} threads on ${target}.`)
    ns.exec("/hacking/grow.js", host, growThreads, target, 0)
  } else {
    ns.tprint(`Prep: Grow not needed on ${target}.`)
  }

  await ns.sleep(prepWeakenDelay)

  const addedSecurity = ns.growthAnalyzeSecurity(growThreads, target, myCores)
  const currentSec = ns.getServerSecurityLevel(target)
  const expectedSecAfterGrow = currentSec + addedSecurity
  const secToReduce = expectedSecAfterGrow - baseSecurity
  const weakenThreadsPre = Math.max(
    1,
    Math.ceil(secToReduce / (0.05 * (1 + (myCores - 1) / 16)))
  )

  if (weakenThreadsPre > 0) {
    ns.tprint(
      `Prep: Executing weaken with ${weakenThreadsPre} threads on ${target}.`
    )
    ns.exec("/hacking/weaken.js", host, weakenThreadsPre, target, 0)
  } else {
    ns.tprint(`Prep: Weaken not needed on ${target} (security is at base).`)
  }

  const growTime = ns.formulas.hacking.growTime(serverActual, player)
  const weakenTime = ns.formulas.hacking.weakenTime(serverActual, player)
  const waitTime = Math.max(growTime, weakenTime) + 200
  ns.tprint(`Prep: Waiting ${waitTime} ms for grow/weaken to complete...`)
  await ns.sleep(waitTime)

  const postMoney = ns.getServerMoneyAvailable(target)
  const postSec = ns.getServerSecurityLevel(target)
  if (postMoney < moneyMax * moneyTolerance) {
    ns.tprint(`WARNING: Money is only ${postMoney} (target ${moneyMax}).`)
  }
  if (postSec > baseSecurity + secTolerance) {
    ns.tprint(`WARNING: Security is ${postSec} (target ${baseSecurity}).`)
  }
  ns.tprint(
    `Prep complete on ${target}: ${postMoney} money, ${postSec} security.`
  )

  return { moneyMax, baseSecurity, secTolerance, myCores }
}