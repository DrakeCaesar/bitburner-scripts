/**
 * Labyrinth solver public API for dnet.
 * Import-then-export only (no export-from): viteburner rewrites top-level imports, not re-exports.
 */
import {
  applyLabradar,
  applyLabreport,
  applyLabyrinthResult,
  buildLabyrinthSnapshots,
  clearLabyrinthPending,
  DEFAULT_LABYRINTH_TUNING,
  ensureWorkerSession,
  exploredCellCount,
  labyrinthPendingMatches,
  labyrinthSolver,
  labyrinthWorkerPending,
  markRadarBucket,
  planLabyrinthAction,
  pruneLabyrinthWorker,
  pruneLabyrinthWorkers,
  repairState,
  setLabyrinthPending,
} from "./labyrinth/explore.js"
import type { LabyrinthAction, LabyrinthOutcome, LabyrinthTuning } from "./labyrinth/explore.js"
import { buildMapGrid, frontierCells, globalFrontierRemaining, sessionDisplayCoords } from "./labyrinth/map.js"
import { LABRADAR_RANGE, parseLabradarGoal } from "./labyrinth/parseGoal.js"
import type { LabreportPayload, LabyrinthSnapshot, LabyrinthState } from "./labyrinth/types.js"
import type { MapGrid, MapGridChar, BuildMapGridOptions } from "./labyrinth/map.js"

export {
  applyLabradar,
  applyLabreport,
  applyLabyrinthResult,
  buildLabyrinthSnapshots,
  buildMapGrid,
  clearLabyrinthPending,
  DEFAULT_LABYRINTH_TUNING,
  ensureWorkerSession,
  exploredCellCount,
  frontierCells,
  globalFrontierRemaining,
  LABRADAR_RANGE,
  labyrinthPendingMatches,
  labyrinthSolver,
  labyrinthWorkerPending,
  markRadarBucket,
  parseLabradarGoal,
  planLabyrinthAction,
  pruneLabyrinthWorker,
  pruneLabyrinthWorkers,
  repairState,
  sessionDisplayCoords,
  setLabyrinthPending,
}

export type {
  LabyrinthAction,
  LabyrinthOutcome,
  LabyrinthTuning,
  BuildMapGridOptions,
  LabreportPayload,
  LabyrinthSnapshot,
  LabyrinthState,
  MapGrid,
  MapGridChar,
}
