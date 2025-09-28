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