import type { NS } from "@ns"

/** Empty node not clearly owned by either player (see ns.go.analysis.getControlledEmptyNodes). */
const DISPUTED_EMPTY = "?"

/**
 * True when the opponent just passed and all empty territory is settled.
 * Matches in-game "End Game" (passCount > 0 and no contested points).
 */
export function shouldPassToEndGame(ns: NS, lastOpponentMove: string | undefined): boolean {
  if (lastOpponentMove !== "pass") return false
  return !hasDisputedTerritory(ns)
}

function hasDisputedTerritory(ns: NS): boolean {
  const controlled = ns.go.analysis.getControlledEmptyNodes()
  for (const column of controlled) {
    if (column.includes(DISPUTED_EMPTY)) return true
  }
  return false
}
