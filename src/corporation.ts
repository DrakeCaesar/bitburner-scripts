import { NS } from "@ns"
import { ensureCorporationCreated } from "@/libraries/corporation/manager.js"
import { CORP_LOG_LAYOUT, CORP_TABS, renderCorporationDashboard } from "@/libraries/corporation/display.js"
import { ensureFarmlandDivision } from "@/libraries/corporation/expansion.js"
import { ensurePlantsExportToTobacco } from "@/libraries/corporation/materialExports.js"
import { buildDivisionHeadcountPlanTables } from "@/libraries/corporation/office.js"
import { FARMLAND_DIVISION } from "@/libraries/corporation/farmland.js"
import { TOBACCO_DIVISION } from "@/libraries/corporation/tobacco.js"
import { manageFarmlandOperations } from "@/libraries/corporation/operations.js"
import { manageFarmlandSupplies } from "@/libraries/corporation/supplies.js"
import { ensureTobaccoDivision } from "@/libraries/corporation/tobaccoSetup.js"
import { manageTobaccoOperations } from "@/libraries/corporation/tobaccoOperations.js"
import { manageTobaccoPlantsSupply } from "@/libraries/corporation/tobaccoSupplies.js"
import { captureCorporationSnapshot } from "@/libraries/corporation/simulation/snapshot.js"
import { validateCorpStage, type ValidationRun } from "@/libraries/corporation/simulation/validate.js"
import { TabbedScriptLogBuilder, initScriptLogTail } from "@/libraries/scriptLogUi.js"

const SIM_HISTORY_MAX = 12

function asStringLines(value: unknown): string[] {
  return Array.isArray(value) ? value : []
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")

  if (!ns.corporation.hasCorporation() && ns.getResetInfo().bitNodeOptions.disableCorporation) {
    ns.tprint("Corporation is disabled on this BitNode.")
    return
  }

  initScriptLogTail(ns, "dracorp", CORP_LOG_LAYOUT)

  const tabbedLog = new TabbedScriptLogBuilder(CORP_TABS, CORP_LOG_LAYOUT)
  const simHistory: ValidationRun[] = []
  let simMismatchWarning: ValidationRun | null = null

  while (true) {
    try {
      const statusLines = [
        ...asStringLines(ensureCorporationCreated(ns)),
        ...asStringLines(ensureFarmlandDivision(ns)),
        ...asStringLines(ensureTobaccoDivision(ns)),
        ...asStringLines(ensurePlantsExportToTobacco(ns)),
      ]

      const { lines: supplyLines, supplies } = manageFarmlandSupplies(ns)
      statusLines.push(...asStringLines(manageTobaccoPlantsSupply(ns)), ...asStringLines(supplyLines))

      const operationLines = await manageFarmlandOperations(ns)
      const tobaccoLines = await manageTobaccoOperations(ns)
      statusLines.push(...asStringLines(operationLines), ...asStringLines(tobaccoLines))

      const beforeStage = captureCorporationSnapshot(ns)

      let simRun: ValidationRun | null = null
      if (beforeStage) {
        simRun = await validateCorpStage(ns, beforeStage)
        if (simRun) {
          simHistory.unshift(simRun)
          if (simHistory.length > SIM_HISTORY_MAX) {
            simHistory.length = SIM_HISTORY_MAX
          }
        }
      } else {
        await ns.sleep(5000)
      }

      const headcountPlans = [
        ...buildDivisionHeadcountPlanTables(ns, FARMLAND_DIVISION),
        ...buildDivisionHeadcountPlanTables(ns, TOBACCO_DIVISION),
      ]
      if (simRun) {
        simMismatchWarning = simRun.result.allOk ? null : simRun
      }
      await renderCorporationDashboard(
        ns,
        tabbedLog,
        statusLines,
        supplies,
        simRun,
        simHistory,
        headcountPlans,
        simMismatchWarning
      )
    } catch (err) {
      ns.clearLog()
      ns.print(`ERROR: ${String(err)}`)
      return
    }
  }
}
