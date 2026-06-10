import { NS } from "@ns"
import { buildAugmentStatsTableConfig } from "./libraries/augmentStatsDisplay.js"
import { buildReactTable, buildStack, buildTextBlock, estimateReactTableHeightPx, estimateReactTableWidthPx, initScriptLogTail } from "./libraries/scriptLogUi.js"
import { estimateTextBlockHeightPx, renderTailContent, TAIL_LAYOUT } from "./libraries/scriptLogUiLayout.js"

const REFRESH_MS = 1_000
const SUMMARY_LINES = 2

async function renderAugmentStatsView(ns: NS): Promise<void> {
  const { summary, ...table } = buildAugmentStatsTableConfig(ns)
  const tableConfig = { layout: TAIL_LAYOUT, ...table }
  await renderTailContent(
    ns,
    buildStack([buildTextBlock(summary, TAIL_LAYOUT), buildReactTable(tableConfig)], TAIL_LAYOUT),
    TAIL_LAYOUT,
    {
      tailTableWidthPx: estimateReactTableWidthPx(tableConfig, TAIL_LAYOUT),
      tailContentHeightPx:
        estimateReactTableHeightPx(tableConfig, TAIL_LAYOUT) + estimateTextBlockHeightPx(SUMMARY_LINES, TAIL_LAYOUT),
    }
  )
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")
  initScriptLogTail(ns, "Augment Stats", TAIL_LAYOUT)

  while (true) {
    await renderAugmentStatsView(ns)
    await ns.sleep(REFRESH_MS)
  }
}
