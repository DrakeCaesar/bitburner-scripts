/**
 * Labyrinth solver public API for dnet.
 * Import-then-export only (no export-from): viteburner rewrites top-level imports, not re-exports.
 */
import {
  anyWorkRemaining,
  applyLabreport,
  applyMoveResult,
  buildLabyrinthSnapshots,
  ensureWorkerSession,
  exploredCellCount,
  labyrinthSolver,
  needsLabreport,
  planMove,
  repairState,
} from "./labyrinth/explore.js"
import { buildMapGrid, globalFrontierRemaining, sessionDisplayCoords } from "./labyrinth/map.js"
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
  ensureWorkerSession,
  exploredCellCount,
  globalFrontierRemaining,
  labyrinthSolver,
  needsLabreport,
  planMove,
  repairState,
  sessionDisplayCoords,
}

export type { LabreportPayload, LabyrinthSnapshot, LabyrinthState, MapGrid, MapGridChar }
