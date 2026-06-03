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
      if (simRun && !simRun.result.allOk) {
        tabbedLog.setActiveTab("sim")
      }
      await renderCorporationDashboard(ns, tabbedLog, statusLines, supplies, simRun, simHistory, headcountPlans)

      if (simRun && !simRun.result.allOk) {
        const failed = simRun.result.comparisons.filter((c) => !c.ok)
        ns.print(`SIM MISMATCH: stage ${simRun.stage} — stopping for debug (${failed.length} field(s) off)`)
        for (const c of failed) {
          ns.print(
            `  ${c.path}: predicted ${Number.isFinite(c.predicted) ? c.predicted.toFixed(3) : "—"}, ` +
              `actual ${Number.isFinite(c.actual) ? c.actual.toFixed(3) : "—"}`
          )
        }
        for (const note of simRun.result.notes) {
          ns.print(`  note: ${note}`)
        }
        return
      }
    } catch (err) {
      ns.clearLog()
      ns.print(`ERROR: ${String(err)}`)
      return
    }
  }
}
