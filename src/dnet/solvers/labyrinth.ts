/**
 * Labyrinth solver public API for dnet v2.
 * Import-then-export only (no export-from): viteburner rewrites top-level imports, not re-exports.
 */
import {
  anyWorkRemaining,
  applyLabreport,
  applyMoveResult,
  buildLabyrinthSnapshots,
  labyrinthSolver,
  needsLabreport,
  planMove,
  repairState,
} from "./labyrinth/explore.js"
import { buildMapGrid, globalFrontierRemaining } from "./labyrinth/map.js"
import type {
  LabreportPayload,
  LabyrinthSnapshot,
  LabyrinthState,
} from "./labyrinth/types.js"
import type { MapGrid, MapGridChar } from "./labyrinth/map.js"

export {
  anyWorkRemaining,
  applyLabreport,
  applyMoveResult,
  buildLabyrinthSnapshots,
  buildMapGrid,
  globalFrontierRemaining,
  labyrinthSolver,
  needsLabreport,
  planMove,
  repairState,
}

export type { LabreportPayload, LabyrinthSnapshot, LabyrinthState, MapGrid, MapGridChar }
