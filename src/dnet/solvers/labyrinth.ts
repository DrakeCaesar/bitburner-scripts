/**
 * Labyrinth solver public API for dnet.
 * Import-then-export only (no export-from): viteburner rewrites top-level imports, not re-exports.
 */
import {
  anyWorkRemaining,
  applyLabreport,
  applyMoveResult,
  assignFrontierClaims,
  buildLabyrinthSnapshots,
  clearLabyrinthPending,
  ensureWorkerSession,
  exploredCellCount,
  labyrinthPendingMatches,
  labyrinthSolver,
  labyrinthWorkerPending,
  needsLabreport,
  planMove,
  pruneLabyrinthWorker,
  pruneLabyrinthWorkers,
  repairState,
  setLabyrinthPending,
} from "./labyrinth/explore.js"
import { buildMapGrid, frontierCells, globalFrontierRemaining, sessionDisplayCoords } from "./labyrinth/map.js"
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
  assignFrontierClaims,
  buildLabyrinthSnapshots,
  buildMapGrid,
  clearLabyrinthPending,
  ensureWorkerSession,
  exploredCellCount,
  frontierCells,
  globalFrontierRemaining,
  labyrinthPendingMatches,
  labyrinthSolver,
  labyrinthWorkerPending,
  needsLabreport,
  planMove,
  pruneLabyrinthWorker,
  pruneLabyrinthWorkers,
  repairState,
  sessionDisplayCoords,
  setLabyrinthPending,
}

export type {
  BuildMapGridOptions,
  LabreportPayload,
  LabyrinthSnapshot,
  LabyrinthState,
  MapGrid,
  MapGridChar,
}
