import type { SolverState } from "../types.js"

export type LabyrinthWallSide = "north" | "east" | "south" | "west"
export type LabyrinthDir = "n" | "e" | "s" | "w"
export type LabyrinthPhase = "labreport" | "move" | "done"

export interface LabyrinthCellWalls {
  /** True only after labreport() at this cell. */
  seen: boolean
  north: boolean | null
  east: boolean | null
  south: boolean | null
  west: boolean | null
}

export interface LabyrinthWalls {
  north: boolean
  east: boolean
  south: boolean
  west: boolean
}

export interface LabyrinthSession {
  path: LabyrinthDir[]
  coords: [number, number] | null
  /** Last known cell (kept while coords cleared during labreport). */
  lastCoords: [number, number] | null
  walls: LabyrinthWalls | null
  phase: LabyrinthPhase
}

export interface LabyrinthState extends SolverState {
  type: "labyrinth"
  map: Record<string, LabyrinthCellWalls>
  sessions: Record<string, LabyrinthSession>
  /** workerHost -> in-flight command (labreport or move dir) awaiting a reply. */
  pending: Record<string, string>
  /** unexplored cell key -> workerHost exploring that frontier cell. */
  claims: Record<string, string>
  /** Goal cell from labradar "X" (shared across workers). */
  goal?: [number, number] | null
  /** Radar bucket keys already scanned while goal was unknown. */
  radarBuckets?: Record<string, true>
}

export interface LabreportPayload {
  workerHost: string
  coords: [number, number]
  north: boolean
  east: boolean
  south: boolean
  west: boolean
}

export interface LabyrinthSnapshot {
  hostname: string
  status: string
  pendingWorker: string | null
  pendingCommand: string | null
  state: LabyrinthState
}
