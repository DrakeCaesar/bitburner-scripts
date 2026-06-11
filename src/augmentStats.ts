import { NS } from "@ns"
import {
  buildAugmentCatalogTableConfig,
  buildAugmentStatsTableConfig,
} from "./libraries/augmentStatsDisplay.js"
import { createTabbedTailLog, openTailLog, type TabDefinition } from "./libraries/scriptLogUiLayout.js"

const AUGMENT_STATS_TABS: TabDefinition[] = [
  { id: "planner", label: "Planner" },
  { id: "catalog", label: "All Augments" },
]

const REFRESH_MS = 1_000

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")
  openTailLog(ns, "Augment Stats")

  const tabbedLog = createTabbedTailLog(AUGMENT_STATS_TABS)

  while (true) {
    tabbedLog.clearPanels()

    const { summary, ...table } = buildAugmentStatsTableConfig(ns)
    tabbedLog.tab("planner").text(summary).table(table)

    const { summary: catalogSummary, ...catalogTable } = buildAugmentCatalogTableConfig(ns)
    tabbedLog.tab("catalog").text(catalogSummary).table(catalogTable)

    await tabbedLog.render(ns)
    await ns.sleep(REFRESH_MS)
  }
}
