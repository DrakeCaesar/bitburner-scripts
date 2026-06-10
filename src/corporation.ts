import { NS } from "@ns"
import { ensureCorporationCreated } from "@/libraries/corporation/manager.js"
import { CORP_TABS, renderCorporationDashboard } from "@/libraries/corporation/display.js"
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
import { CorpPerfCollector, pushPerfHistory, type CorpPerfReport } from "@/libraries/corporation/perf.js"
import { captureCorporationSnapshot } from "@/libraries/corporation/simulation/snapshot.js"
import { validateCorpStage, type ValidationRun } from "@/libraries/corporation/simulation/validate.js"
import { createTabbedTailLog, openTailLog } from "@/libraries/scriptLogUiLayout.js"

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

  openTailLog(ns, "dracorp")

  const tabbedLog = createTabbedTailLog(CORP_TABS)
  const simHistory: ValidationRun[] = []
  const perfHistory: CorpPerfReport[] = []
  let simMismatchWarning: ValidationRun | null = null
  let perfCycle = 0

  while (true) {
    try {
      perfCycle += 1
      const perf = new CorpPerfCollector()
      perf.startLoop()

      const statusLines = perf.measure("setup", () => [
        ...asStringLines(ensureCorporationCreated(ns)),
        ...asStringLines(ensureFarmlandDivision(ns)),
        ...asStringLines(ensureTobaccoDivision(ns)),
        ...asStringLines(ensurePlantsExportToTobacco(ns)),
      ])

      const { lines: supplyLines, supplies } = perf.measure("supplies", () => {
        const farmland = manageFarmlandSupplies(ns)
        return {
          lines: [...asStringLines(manageTobaccoPlantsSupply(ns)), ...asStringLines(farmland.lines)],
          supplies: farmland.supplies,
        }
      })
      statusLines.push(...supplyLines)

      const operationLines = await perf.measureAsync("ops Farmland", () => manageFarmlandOperations(ns))
      const tobaccoLines = await perf.measureAsync("ops Tobacco", () => manageTobaccoOperations(ns))
      statusLines.push(...asStringLines(operationLines), ...asStringLines(tobaccoLines))

      const beforeStage = perf.measure("snapshot before", () => captureCorporationSnapshot(ns))

      let simRun: ValidationRun | null = null
      if (beforeStage) {
        simRun = await validateCorpStage(ns, beforeStage, perf)
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
        ...perf.measure("headcount Farmland", () => buildDivisionHeadcountPlanTables(ns, FARMLAND_DIVISION)),
        ...perf.measure("headcount Tobacco", () => buildDivisionHeadcountPlanTables(ns, TOBACCO_DIVISION)),
      ]
      if (simRun) {
        simMismatchWarning = simRun.result.allOk ? null : simRun
      }
      const perfReport = await renderCorporationDashboard(
        ns,
        tabbedLog,
        statusLines,
        supplies,
        simRun,
        simHistory,
        headcountPlans,
        simMismatchWarning,
        perf,
        perfCycle,
        perfHistory
      )
      pushPerfHistory(perfHistory, perfReport)
    } catch (err) {
      ns.clearLog()
      ns.print(`ERROR: ${String(err)}`)
      return
    }
  }
}
