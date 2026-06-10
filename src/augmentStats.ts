import { NS } from "@ns"
import { buildAugmentStatsTableConfig } from "./libraries/augmentStatsDisplay.js"
import { createTailLog, openTailLog } from "./libraries/scriptLogUiLayout.js"

const REFRESH_MS = 1_000

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")
  openTailLog(ns, "Augment Stats")

  while (true) {
    const { summary, ...table } = buildAugmentStatsTableConfig(ns)
    await createTailLog().text(summary).table(table).render(ns)
    await ns.sleep(REFRESH_MS)
  }
}
