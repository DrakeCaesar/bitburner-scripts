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
import { buildMapGrid, frontierCells, globalFrontierRemaining, LABRADAR_RANGE, mergeLabradarAscii, sessionDisplayCoords } from "./labyrinth/map.js"
import {
  applyLabradar,
  LABRADAR_GRID_SPACING,
  labradarWorkRemaining,
  markRadarBucket,
  needsLabradar,
  parseLabradarGoal,
  radarBucketKey,
} from "./labyrinth/radar.js"
import type {
  LabreportPayload,
  LabyrinthSnapshot,
  LabyrinthState,
} from "./labyrinth/types.js"
import type { MapGrid, MapGridChar, BuildMapGridOptions } from "./labyrinth/map.js"

export {
  anyWorkRemaining,
  applyLabreport,
  applyLabradar,
  applyMoveResult,
  assignFrontierClaims,
  buildLabyrinthSnapshots,
  buildMapGrid,
  clearLabyrinthPending,
  ensureWorkerSession,
  exploredCellCount,
  frontierCells,
  globalFrontierRemaining,
  LABRADAR_GRID_SPACING,
  LABRADAR_RANGE,
  labradarWorkRemaining,
  mergeLabradarAscii,
  labyrinthPendingMatches,
  labyrinthSolver,
  labyrinthWorkerPending,
  markRadarBucket,
  needsLabradar,
  needsLabreport,
  parseLabradarGoal,
  planMove,
  pruneLabyrinthWorker,
  pruneLabyrinthWorkers,
  radarBucketKey,
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
