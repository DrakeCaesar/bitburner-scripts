import { NS } from "@ns"

interface Program {
  name: string
  cost: number
}

const PROGRAMS: Program[] = [
  { name: "BruteSSH.exe", cost: 500000 },
  { name: "FTPCrack.exe", cost: 1500000 },
  { name: "relaySMTP.exe", cost: 5000000 },
  { name: "HTTPWorm.exe", cost: 30000000 },
  { name: "SQLInject.exe", cost: 250000000 },
  { name: "ServerProfiler.exe", cost: 500000 },
  { name: "DeepscanV1.exe", cost: 500000 },
  { name: "DeepscanV2.exe", cost: 25000000 },
  { name: "AutoLink.exe", cost: 1000000 },
]

export function purchaseTorRouter(ns: NS): boolean {
  if (ns.hasTorRouter()) return false

  const torCost = 200000
  if (ns.getPlayer().money >= torCost) {
    if (ns.singularity.purchaseTor()) {
      ns.tprint("Purchased TOR router")
      return true
    }
  }
  return false
}

export function purchasePrograms(ns: NS): string[] {
  if (!ns.hasTorRouter()) return []

  const purchased: string[] = []
  const playerMoney = ns.getPlayer().money

  for (const program of PROGRAMS) {
    if (!ns.fileExists(program.name, "home")) {
      if (playerMoney >= program.cost) {
        if (ns.singularity.purchaseProgram(program.name)) {
          ns.tprint(`Purchased ${program.name}`)
          purchased.push(program.name)
        }
      }
    }
  }

  return purchased
}
