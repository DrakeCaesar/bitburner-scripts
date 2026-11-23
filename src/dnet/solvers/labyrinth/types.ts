import type { SolverState } from "../types.js"

export type LabyrinthWallSide = "north" | "east" | "south" | "west"
export type LabyrinthDir = "n" | "e" | "s" | "w"
export type LabyrinthPhase = "labreport" | "move" | "done"

export interface LabyrinthCellWalls {
  /** True once all four walls are known. */
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
  /** Target cell key -> workerHost walking to it. */
  claims: Record<string, string>
  /** The end cell, once it is known (from the labyrinth's size or from labradar's "X"). */
  goal?: [number, number] | null
  /** The labyrinth's host name; its size and layout follow from it (geometry.ts). */
  host?: string
  /** Cells known not to be the end: stood on, or scanned by labradar without an "X". */
  notGoal?: Record<string, true>
  /** The layout's fixed walls (geometry.ts) have been written into the map. */
  prefilled?: boolean
  /** Times an observation contradicted the map and it was started over. */
  resets?: number
  /** Set after repeated contradictions: stop relying on geometry.ts. */
  geometryOff?: boolean
  /** Bumped whenever the map or a session changes; lets planning reuse its last answer. */
  revision?: number
  /** Positions (and, for labyrinths of unknown size, 6-tile buckets) already scanned by labradar. */
  radared?: Record<string, true>
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
