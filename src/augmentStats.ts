import { NS } from "@ns"
import { buildAugmentStatsTableConfig } from "./libraries/augmentStatsDisplay.js"
import { createTailLog, openTailLog, type TableLayout } from "./libraries/scriptLogUiLayout.js"

/** One-time F12 sizing report — open browser console after starting augmentStats.js */
const TAIL_SIZE_DEBUG: Partial<TableLayout> = {
  debugTailSizing: true,
  tailSizingDebugLabel: "augment-stats",
}

const REFRESH_MS = 1_000

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")
  openTailLog(ns, "Augment Stats")

  while (true) {
    const { summary, ...table } = buildAugmentStatsTableConfig(ns)
    await createTailLog(TAIL_SIZE_DEBUG).text(summary).table(table).render(ns)
    await ns.sleep(REFRESH_MS)
  }
}
