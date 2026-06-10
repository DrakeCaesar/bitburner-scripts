import { NS } from "@ns"
import { buildAugmentStatsTableConfig } from "./libraries/augmentStatsDisplay.js"
import {
  applyTailSize,
  buildReactTable,
  buildStack,
  buildTextBlock,
  estimateReactTableHeightPx,
  estimateReactTableWidthPx,
  initScriptLogTail,
  renderScriptLog,
  type TableLayout,
} from "./libraries/scriptLogUi.js"

const REFRESH_MS = 1_000

const AUGMENT_STATS_LAYOUT: Partial<TableLayout> = {
  fontSizePx: 10,
  paddingXPx: 4,
  headerRowHeightPx: 20,
  bodyRowHeightPx: 18,
  tableWidthPx: 1200,
}

const SUMMARY_LINES = 2

async function renderAugmentStatsView(ns: NS): Promise<void> {
  const { summary, ...table } = buildAugmentStatsTableConfig(ns)
  const tableConfig = { layout: AUGMENT_STATS_LAYOUT, ...table }
  const renderLayout = {
    ...AUGMENT_STATS_LAYOUT,
    tailTableWidthPx: estimateReactTableWidthPx(tableConfig),
    tailContentHeightPx:
      estimateReactTableHeightPx(tableConfig) + SUMMARY_LINES * (AUGMENT_STATS_LAYOUT.bodyRowHeightPx ?? 18),
  }

  applyTailSize(ns, renderLayout)
  await renderScriptLog(
    ns,
    buildStack([buildTextBlock(summary, AUGMENT_STATS_LAYOUT), buildReactTable(tableConfig)], AUGMENT_STATS_LAYOUT),
    renderLayout
  )
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")
  initScriptLogTail(ns, "Augment Stats", AUGMENT_STATS_LAYOUT)

  while (true) {
    await renderAugmentStatsView(ns)
    await ns.sleep(REFRESH_MS)
  }
}
