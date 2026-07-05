import { NS } from "@ns"
import { killOtherInstances } from "./libraries/batchCalculations.js"
import {
  evaluateGoalTree,
  findActiveGoal,
  flattenGoalLines,
  type GoalStatus,
} from "./libraries/orchestrator/goalTree.js"
import { getWorldDaemonBackdoorGoal } from "./libraries/orchestrator/worldDemonGoals.js"
import { createTailLog, openTailLog } from "./libraries/scriptLogUiLayout.js"

const CHECK_INTERVAL_MS = 5_000

function statusLabel(status: GoalStatus): string {
  switch (status) {
    case "complete":
      return "done"
    case "active":
      return "now"
    case "blocked":
      return "hold"
    default:
      return "wait"
  }
}

/**
 * Top-level automation entry after augmentation install.
 *
 * Plans from the end goal downward. Background services (batch, factions, purchases)
 * live in libraries/orchestrator/backgroundServices.ts — not wired here yet.
 */
export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")
  await killOtherInstances(ns)
  openTailLog(ns, "Orchestrator")

  const rootGoal = getWorldDaemonBackdoorGoal()

  while (true) {
    const evaluated = evaluateGoalTree(ns, rootGoal)
    const active = findActiveGoal(evaluated)
    const log = createTailLog()

    log.text(`Run goal: ${evaluated.label}`)
    if (evaluated.status === "complete") {
      log.text("All prerequisites met — World Daemon ready.")
    } else if (active) {
      log.text(`Current stop: ${active.label} (${statusLabel(active.status)})`)
      if (active.detail) log.text(`  ${active.detail}`)
    }

    log.text("")
    log.text("Goal tree:")
    for (const line of flattenGoalLines(evaluated)) {
      const indent = "  ".repeat(line.depth + 1)
      log.text(
        `${indent}${line.label}: ${statusLabel(line.status)}` +
          (line.detail ? ` — ${line.detail}` : "")
      )
    }

    await log.render(ns)
    await ns.sleep(CHECK_INTERVAL_MS)
  }
}
