import type { GuessRequest, GuessResult } from "../types.js"
import type { SolverModule } from "../types.js"
import type { ServerDetails } from "../../types.js"
import {
  bfsFirstStep,
  cellExplored,
  cellKey,
  confirmMovePassage,
  DIR_TO_WALL,
  ensureMap,
  globalFrontierRemaining,
  LABYRINTH_DIRS,
  LABYRINTH_OPPOSITE,
  mergeCell,
  wallsAt,
  WALL_ORDER,
} from "./map.js"
import type {
  LabreportPayload,
  LabyrinthDir,
  LabyrinthSession,
  LabyrinthState,
  LabyrinthWalls,
} from "./types.js"

function freshSession(): LabyrinthSession {
  return { path: [], coords: null, lastCoords: null, walls: null, phase: "labreport" }
}

function session(state: LabyrinthState, workerHost: string): LabyrinthSession {
  if (!state.sessions[workerHost]) {
    state.sessions[workerHost] = freshSession()
  }
  return state.sessions[workerHost]!
}

export function ensureWorkerSession(state: LabyrinthState, workerHost: string): LabyrinthSession {
  return session(state, workerHost)
}

export function needsLabreport(state: LabyrinthState, workerHost: string): boolean {
  const sess = state.sessions[workerHost]
  if (!sess) return true
  return sess.phase === "labreport" || (sess.phase === "move" && (!sess.coords || !sess.walls))
}

export function moveSucceeded(result: GuessResult): boolean {
  const msg = result.message ?? ""
  if (msg.includes("still at")) return false
  if (msg.includes("You have moved to")) return true
  if (msg.includes("You cannot go that way")) return false
  return false
}

function hasLocalFrontier(
  map: Record<string, ReturnType<typeof ensureMap> extends Record<string, infer C> ? C : never>,
  x: number,
  y: number,
  walls: LabyrinthWalls,
): boolean {
  for (const dir of WALL_ORDER) {
    const wallKey = DIR_TO_WALL[dir]
    if (!walls[wallKey]) continue
    const [dx, dy] = LABYRINTH_DIRS[dir]
    if (!cellExplored(map, cellKey(x + dx, y + dy))) return true
  }
  return false
}

export function sessionCanContinue(state: LabyrinthState, sess: LabyrinthSession): boolean {
  if (sess.phase === "labreport") return true
  if (sess.phase !== "done" && (!sess.coords || !sess.walls)) return true
  if (!sess.coords) return sess.path.length > 0
  const map = ensureMap(state)
  const [x, y] = sess.coords
  const walls = wallsAt(map, x, y, sess.walls)
  if (walls && hasLocalFrontier(map, x, y, walls)) return true
  if (bfsFirstStep(map, x, y)) return true
  return sess.path.length > 0
}

export function repairState(state: LabyrinthState): LabyrinthState {
  ensureMap(state)
  if (globalFrontierRemaining(state.map)) {
    for (const sess of Object.values(state.sessions)) {
      if (sess.phase === "done" && sessionCanContinue(state, sess)) {
        sess.phase = "move"
      }
    }
  }
  return state
}

export function exploredCellCount(map: LabyrinthState["map"]): number {
  return Object.values(map).filter((c) => c.seen).length
}

export function anyWorkRemaining(state: LabyrinthState, workerHosts: string[]): boolean {
  repairState(state)
  if (workerHosts.length === 0) return false

  if (exploredCellCount(state.map) === 0) {
    return true
  }

  if (globalFrontierRemaining(state.map)) {
    for (const host of workerHosts) {
      const sess = state.sessions[host]
      if (!sess || sessionCanContinue(state, sess)) return true
    }
    return true
  }
  return false
}

export function planMove(state: LabyrinthState, workerHost: string): LabyrinthDir | null {
  repairState(state)
  const sess = session(state, workerHost)
  if (sess.phase === "done") return null
  if (sess.phase === "labreport" || !sess.coords || !sess.walls) return null

  const map = ensureMap(state)
  const [x, y] = sess.coords
  const walls = wallsAt(map, x, y, sess.walls)
  if (!walls) return null

  for (const dir of WALL_ORDER) {
    const wallKey = DIR_TO_WALL[dir]
    if (!walls[wallKey]) continue
    const [dx, dy] = LABYRINTH_DIRS[dir]
    if (!cellExplored(map, cellKey(x + dx, y + dy))) return dir
  }

  const route = bfsFirstStep(map, x, y)
  if (route) return route

  if (sess.path.length > 0) {
    return LABYRINTH_OPPOSITE[sess.path[sess.path.length - 1]!]!
  }

  return null
}

export function applyLabreport(state: LabyrinthState, report: LabreportPayload): LabyrinthState {
  ensureMap(state)
  const sess = session(state, report.workerHost)
  sess.coords = report.coords
  sess.lastCoords = report.coords
  sess.walls = {
    north: report.north,
    east: report.east,
    south: report.south,
    west: report.west,
  }
  sess.phase = "move"
  mergeCell(state.map, report.coords[0], report.coords[1], sess.walls)
  return state
}

export function applyMoveResult(
  state: LabyrinthState,
  workerHost: string,
  guess: string,
  result: GuessResult,
): LabyrinthState {
  const sess = session(state, workerHost)
  const dir = guess as LabyrinthDir
  if (guess !== "n" && guess !== "e" && guess !== "s" && guess !== "w") return state

  if (moveSucceeded(result)) {
    if (sess.coords) {
      ensureMap(state)
      confirmMovePassage(state.map, sess.coords[0], sess.coords[1], dir)
      const [dx, dy] = LABYRINTH_DIRS[dir]
      sess.lastCoords = [sess.coords[0] + dx, sess.coords[1] + dy]
    }
    const last = sess.path[sess.path.length - 1]
    if (last && dir === LABYRINTH_OPPOSITE[last]) {
      sess.path.pop()
    } else {
      sess.path.push(dir)
    }
  }

  sess.coords = null
  sess.walls = null
  sess.phase = "labreport"
  return state
}

export const labyrinthSolver: SolverModule<LabyrinthState> = {
  init(_details: ServerDetails): LabyrinthState {
    return { type: "labyrinth", map: {}, sessions: {} }
  },

  nextGuess(state, ctx): GuessRequest | null {
    const workerHost = ctx.workerHost
    if (!workerHost) return null
    const dir = planMove(state, workerHost)
    if (!dir) return null
    return { guess: dir, detail: `move ${dir}@${workerHost}` }
  },

  applyResult(state, guess, result, ctx): LabyrinthState {
    const workerHost = ctx?.workerHost
    if (!workerHost) return state
    return applyMoveResult(state, workerHost, guess, result)
  },
}

export function buildLabyrinthSnapshots(
  targets: Map<string, { host: string; status: string; solverState: unknown | null; workerHost: string | null; pendingGuess: string | null }>,
): import("./types.js").LabyrinthSnapshot[] {
  const out: import("./types.js").LabyrinthSnapshot[] = []
  for (const target of targets.values()) {
    const raw = target.solverState
    if (!raw || typeof raw !== "object") continue
    const row = raw as LabyrinthState
    if (row.type !== "labyrinth") continue
    repairState(row)
    out.push({
      hostname: target.host,
      status: target.status,
      pendingWorker: target.workerHost,
      pendingCommand: target.pendingGuess,
      state: row,
    })
  }
  return out
}
