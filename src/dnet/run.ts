import { NS } from "@ns"
import { runCoordinator } from "./engine/coordinator.js"
import { createDashboard, renderDashboard } from "./ui/dashboard.js"
import { openTailLog } from "@/libraries/scriptLogUiLayout.js"

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")
  ns.clearLog()
  openTailLog(ns, "dnet v2")

  const log = createDashboard()
  let lastRender = 0

  await runCoordinator(ns, {
    onProgress: async (snap) => {
      const now = Date.now()
      if (now - lastRender < 400) return
      lastRender = now
      await renderDashboard(ns, log, snap)
    },
    onError: (message) => {
      log.clearPanels()
      log.tab("overview").text(`ERROR: ${message}`)
    },
  })
}

export function autocomplete(_data: unknown, _args: unknown): string[] {
  return []
}
