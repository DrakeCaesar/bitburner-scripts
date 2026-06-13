import type { NS } from "@ns"

/**
 * True when the in-game "End Game" pass is available: opponent passed and it is our turn.
 *
 * Uses ns.go.getGameState().previousMove (null after a pass per API docs) instead of
 * tracking move strings or disputed territory — the UI enables End Game on passCount alone,
 * even if empty nodes are still contested or the opponent still has routers on the board.
 */
export function shouldPassToEndGame(ns: NS): boolean {
  if (ns.go.getCurrentPlayer() !== "Black") return false

  const { previousMove } = ns.go.getGameState()
  if (previousMove !== null) return false

  // previousMove is also null before the first move; require at least one prior board state.
  return ns.go.getMoveHistory().length > 0
}
