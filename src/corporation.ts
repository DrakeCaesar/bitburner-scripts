import { NS } from "@ns"
import { ensureCorporationCreated } from "./libraries/corporation/manager.js"
import { CORP_LOG_LAYOUT, ensureFarmlandDivision, renderCorporationDashboard } from "./libraries/corporation/display.js"
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
      const statusLines = [...ensureCorporationCreated(ns), ...ensureFarmlandDivision(ns)]
      await renderCorporationDashboard(ns, statusLines)
    } catch (err) {
      ns.clearLog()
      ns.print(`ERROR: ${String(err)}`)
    }

    await ns.sleep(TICK_MS)
  }
}
