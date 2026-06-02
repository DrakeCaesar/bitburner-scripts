import { NS } from "@ns"
import {
  buildFactionWorkRows,
  buildFactionWorkTableConfig,
  gatherAugmentTargets,
  getTargetFavor,
  parseFactionWorkPriority,
  prioritizeTargets,
  startFactionWork,
  type FactionWorkPriority,
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

const CHECK_INTERVAL_MS = 1_000

const FACTION_WORK_LAYOUT: Partial<TableLayout> = {
  tableWidthPx: 720,
  fontSizePx: 12,
}

async function renderFactionWorkTable(ns: NS, priority: FactionWorkPriority): Promise<void> {
  const player = ns.getPlayer()
  const targetFavor = getTargetFavor(ns)
  const allTargets = gatherAugmentTargets(ns, player.factions)
  const prioritized = prioritizeTargets(allTargets, targetFavor, priority)
  const best = prioritized[0] ?? null
  const rows = buildFactionWorkRows(ns, player.factions, allTargets, prioritized, best, priority)
  const table = buildFactionWorkTableConfig(ns, rows, best, priority)

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
  const priority = parseFactionWorkPriority(ns)
  const tailTitle = priority === "augments" ? "Faction Work (augments)" : "Faction Work"
  initScriptLogTail(ns, tailTitle, FACTION_WORK_LAYOUT)

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
    const prioritized = prioritizeTargets(allTargets, targetFavor, priority)
    const bestTarget = prioritized[0]

    await renderFactionWorkTable(ns, priority)

    if (!bestTarget) {
      return
    }

    const currentRep = ns.singularity.getFactionRep(bestTarget.faction)
    if (currentRep >= bestTarget.requiredRep) {
      continue
    }

    const focus = ns.singularity.isFocused()
    const { ok, workType } = startFactionWork(ns, bestTarget.faction, focus)
    if (!ok) {
      const types = ns.singularity.getFactionWorkTypes(bestTarget.faction)
      const tried = workType ?? types[0]
      ns.print(
        `ERROR: Failed to work for ${bestTarget.faction}` +
          (tried != null ? ` (${tried})` : types.length > 0 ? ` (offered: ${types.join(", ")})` : " (no work)")
      )
    }

    await ns.sleep(CHECK_INTERVAL_MS)
  }
}
