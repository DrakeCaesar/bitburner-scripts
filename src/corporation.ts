import { NS } from "@ns"
import { ensureCorporationCreated } from "./libraries/corporation/manager.js"
import { CORP_LOG_LAYOUT, ensureFarmlandDivision, renderCorporationDashboard } from "./libraries/corporation/display.js"
import { manageFarmlandSupplies } from "./libraries/corporation/supplies.js"
import { initScriptLogTail } from "./libraries/scriptLogUi.js"

const TICK_MS = 5000

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")

  if (!ns.corporation.hasCorporation() && ns.getResetInfo().bitNodeOptions.disableCorporation) {
    ns.tprint("Corporation is disabled on this BitNode.")
    return
  }

  initScriptLogTail(ns, "dracorp", CORP_LOG_LAYOUT)

  while (true) {
    try {
      const { lines: supplyLines, supplies } = manageFarmlandSupplies(ns)
      const statusLines = [...ensureCorporationCreated(ns), ...ensureFarmlandDivision(ns), ...supplyLines]
      await renderCorporationDashboard(ns, statusLines, supplies)
    } catch (err) {
      ns.clearLog()
      ns.print(`ERROR: ${String(err)}`)
    }

    await ns.sleep(TICK_MS)
  }
}
