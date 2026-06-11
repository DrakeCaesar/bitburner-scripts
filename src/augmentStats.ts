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

const PLANNER_REFRESH_MS = 1_000

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")
  openTailLog(ns, "Augment Stats")

  const tabbedLog = createTabbedTailLog(AUGMENT_STATS_TABS, undefined, { lazyInactivePanels: true })

  tabbedLog.clearPanels()
  const { summary: catalogSummary, ...catalogTable } = buildAugmentCatalogTableConfig(ns)
  tabbedLog.tab("catalog").text(catalogSummary).table(catalogTable)

  const { summary, ...table } = buildAugmentStatsTableConfig(ns)
  tabbedLog.tab("planner").text(summary).table(table)
  await tabbedLog.render(ns)

  let lastActiveTab = tabbedLog.getActiveTabId()

  while (true) {
    const activeTab = tabbedLog.getActiveTabId()
    const tabChanged = activeTab !== lastActiveTab
    lastActiveTab = activeTab

    if (activeTab === "catalog" && !tabChanged) {
      await ns.sleep(PLANNER_REFRESH_MS)
      continue
    }

    tabbedLog.clearPanelsExcept(["catalog"])
    const { summary: plannerSummary, ...plannerTable } = buildAugmentStatsTableConfig(ns)
    tabbedLog.tab("planner").text(plannerSummary).table(plannerTable)

    await tabbedLog.render(ns)
    await ns.sleep(PLANNER_REFRESH_MS)
  }
}
