import type { ProgramName } from "@ns"
import { NS } from "@ns"

export const DARKSCAPE_NAVIGATOR: ProgramName = "DarkscapeNavigator.exe"
const DARKSCAPE_NAVIGATOR_COST = 50_000_000

interface Program {
  name: ProgramName
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
  { name: DARKSCAPE_NAVIGATOR, cost: DARKSCAPE_NAVIGATOR_COST },
]

import type { LogFn } from "./logFn.js"

export function purchaseTorRouter(ns: NS, logMessage?: LogFn): boolean {
  if (ns.hasTorRouter()) return false

  const torCost = 200000
  if (ns.getPlayer().money >= torCost) {
    if (ns.singularity.purchaseTor()) {
      logMessage?.("Purchased TOR router")
      return true
    }
  }
  return false
}

/** Buy DarkscapeNavigator.exe from the dark web when missing and affordable. Requires a TOR router. */
export function purchaseDarkscapeNavigator(ns: NS, logMessage?: LogFn): boolean {
  if (ns.fileExists(DARKSCAPE_NAVIGATOR, "home")) return true

  if (!ns.hasTorRouter()) {
    purchaseTorRouter(ns, logMessage)
  }
  if (!ns.hasTorRouter()) return false

  if (ns.getPlayer().money < DARKSCAPE_NAVIGATOR_COST) return false

  if (ns.singularity.purchaseProgram(DARKSCAPE_NAVIGATOR)) {
    logMessage?.(`Purchased ${DARKSCAPE_NAVIGATOR}`)
    return true
  }
  return false
}

export function purchasePrograms(ns: NS, logMessage?: LogFn): string[] {
  if (!ns.hasTorRouter()) return []

  const purchased: string[] = []
  const playerMoney = ns.getPlayer().money

  for (const program of PROGRAMS) {
    if (!ns.fileExists(program.name, "home")) {
      if (playerMoney >= program.cost) {
        if (ns.singularity.purchaseProgram(program.name)) {
          logMessage?.(`Purchased ${program.name}`)
          purchased.push(program.name)
        }
      }
    }
  }

  return purchased
}
