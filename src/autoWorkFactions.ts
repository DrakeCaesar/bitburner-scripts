import { NS } from "@ns"
import {
  buildFactionWorkRows,
  buildFactionWorkTableConfig,
  gatherAugmentTargets,
  getTargetFavor,
  prioritizeTargets,
} from "./libraries/factionWork.js"
import {
  applyTailSize,
  buildReactTable,
  estimateReactTableHeightPx,
  estimateReactTableWidthPx,
  initScriptLogTail,
  renderScriptLog,
  type TableLayout,
} from "./libraries/scriptLogUi.js"

const CHECK_INTERVAL_MS = 10_000

const FACTION_WORK_LAYOUT: Partial<TableLayout> = {
  tableWidthPx: 720,
  fontSizePx: 12,
}

async function renderFactionWorkTable(ns: NS): Promise<void> {
  const player = ns.getPlayer()
  const targetFavor = getTargetFavor(ns)
  const allTargets = gatherAugmentTargets(ns, player.factions)
  const prioritized = prioritizeTargets(allTargets, targetFavor)
  const best = prioritized[0] ?? null
  const rows = buildFactionWorkRows(ns, player.factions, allTargets, prioritized, best)
  const table = buildFactionWorkTableConfig(ns, rows, best)

  const tableConfig = { layout: FACTION_WORK_LAYOUT, ...table }
  const renderLayout = {
    ...FACTION_WORK_LAYOUT,
    tailTableWidthPx: estimateReactTableWidthPx(tableConfig),
    tailContentHeightPx: estimateReactTableHeightPx(tableConfig),
  }
  applyTailSize(ns, renderLayout)
  await renderScriptLog(ns, buildReactTable(tableConfig), renderLayout)
}

export async function main(ns: NS) {
  ns.disableLog("ALL")
  initScriptLogTail(ns, "Faction Work", FACTION_WORK_LAYOUT)

  while (true) {
    const player = ns.getPlayer()

    if (player.factions.length === 0) {
      ns.clearLog()
      ns.print("ERROR: You are not in any factions yet!")
      await ns.sleep(CHECK_INTERVAL_MS)
      continue
    }

    const targetFavor = getTargetFavor(ns)
    const allTargets = gatherAugmentTargets(ns, player.factions)
    const prioritized = prioritizeTargets(allTargets, targetFavor)
    const bestTarget = prioritized[0]

    await renderFactionWorkTable(ns)

    if (!bestTarget) {
      return
    }

    const currentRep = ns.singularity.getFactionRep(bestTarget.faction)
    if (currentRep >= bestTarget.requiredRep) {
      continue
    }

    const focus = ns.singularity.isFocused()
    const working = ns.singularity.workForFaction(bestTarget.faction, "hacking", focus)
    if (!working) {
      ns.print(`ERROR: Failed to work for ${bestTarget.faction}. Faction may not offer hacking contracts.`)
    }

    await ns.sleep(CHECK_INTERVAL_MS)
  }
}
