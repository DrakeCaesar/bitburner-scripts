import { NS } from "@ns"
import { runCoordinator } from "./engine/coordinator.js"
import { createDashboard, renderDashboard } from "./ui/dashboard.js"
import { openTailLog, renderTabbedTailLog } from "@/libraries/scriptLogUiLayout.js"

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")
  ns.clearLog()
  openTailLog(ns, "dnet")

  const dashboard = createDashboard()
  let lastRender = 0

  const showError = async (message: string): Promise<void> => {
    dashboard.log.clearPanels()
    dashboard.log.tab("overview").text(`ERROR: ${message}`)
    await renderTabbedTailLog(ns, dashboard.log)
  }

  try {
    await runCoordinator(ns, {
      onProgress: async (snap) => {
        const now = Date.now()
        const tabRefresh = dashboard.log.hasPendingLayoutRefresh()
        if (!tabRefresh && now - lastRender < 400) return
        lastRender = now
        await renderDashboard(ns, dashboard, snap)
      },
      onError: showError,
    })
  } catch (err) {
    await showError(err instanceof Error ? err.message : String(err))
  }
}

export function autocomplete(_data: unknown, _args: unknown): string[] {
  return []
}
