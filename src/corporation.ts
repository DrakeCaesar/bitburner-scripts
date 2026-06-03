import { NS } from "@ns"
import { maintainCorporation } from "./libraries/corporation/manager.js"

/** Automates corporation setup per in-game guide: Agriculture first, Smart Supply, staff, sell output. */
export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")

  if (!ns.corporation.hasCorporation() && ns.getResetInfo().bitNodeOptions.disableCorporation) {
    ns.tprint("Corporation is disabled on this BitNode.")
    return
  }

  while (true) {
    try {
      const lines = maintainCorporation(ns)
      ns.clearLog()
      for (const line of lines) {
        ns.print(line)
      }
    } catch (err) {
      ns.print(`ERROR: ${String(err)}`)
    }

    await ns.sleep(5000)
  }
}
