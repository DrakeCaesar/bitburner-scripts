import type { GuessRequest, GuessResult } from "../types.js"
import type { SolverModule } from "../types.js"
import type { ServerDetails } from "../../types.js"
import {
  bfsDistanceToTarget,
  bfsFirstStep,
  bfsFirstStepToward,
  cellExplored,
  cellKey,
  confirmMovePassage,
  DIR_TO_WALL,
  ensureMap,
  frontierCells,
  globalFrontierRemaining,
  LABYRINTH_DIRS,
  LABYRINTH_OPPOSITE,
  mergeCell,
  parseCellKey,
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

function ensurePending(state: LabyrinthState): Record<string, string> {
  if (!state.pending) state.pending = {}
  return state.pending
}

function ensureClaims(state: LabyrinthState): Record<string, string> {
  if (!state.claims) state.claims = {}
  return state.claims
}

/** Drop session, pending, and frontier claims for a worker that left the pool or lost lab adjacency. */
export function pruneLabyrinthWorker(state: LabyrinthState, workerHost: string): void {
  delete state.sessions[workerHost]
  delete ensurePending(state)[workerHost]
  const claims = ensureClaims(state)
  for (const [cell, host] of Object.entries(claims)) {
    if (host === workerHost) delete claims[cell]
  }
}

export function pruneLabyrinthWorkers(state: LabyrinthState, activeExplorers: ReadonlySet<string>): void {
  for (const host of Object.keys(state.sessions)) {
    if (!activeExplorers.has(host)) pruneLabyrinthWorker(state, host)
  }
  for (const host of Object.keys(ensurePending(state))) {
    if (!activeExplorers.has(host)) delete state.pending[host]
  }
}

export function labyrinthWorkerPending(state: LabyrinthState, workerHost: string): string | null {
  return state.pending?.[workerHost] ?? null
}

export function labyrinthPendingMatches(
  state: LabyrinthState,
  workerHost: string,
  command: string,
): boolean {
  return state.pending?.[workerHost] === command
}

export function clearLabyrinthPending(state: LabyrinthState, workerHost: string): void {
  if (state.pending) delete state.pending[workerHost]
}

export function setLabyrinthPending(state: LabyrinthState, workerHost: string, command: string): void {
  ensurePending(state)[workerHost] = command
}

function workerClaimCell(state: LabyrinthState, workerHost: string): string | null {
  const claims = ensureClaims(state)
  for (const [cell, host] of Object.entries(claims)) {
    if (host === workerHost) return cell
  }
  return null
}

function releaseWorkerClaim(state: LabyrinthState, workerHost: string): void {
  const claims = ensureClaims(state)
  for (const [cell, host] of Object.entries(claims)) {
    if (host === workerHost) delete claims[cell]
  }
}

/** Assign distinct frontier cells to idle explorers; stasis-linked workers pick first. */
export function assignFrontierClaims(
  state: LabyrinthState,
  explorerHosts: readonly string[],
  stasisLinked: ReadonlySet<string>,
): void {
  ensureMap(state)
  const claims = ensureClaims(state)
  const frontier = new Set(frontierCells(state.map))

  for (const [cell, host] of Object.entries(claims)) {
    if (!frontier.has(cell) || !explorerHosts.includes(host)) {
      delete claims[cell]
    }
  }

  const sorted = [...explorerHosts].sort((a, b) => {
    const sa = stasisLinked.has(a) ? 0 : 1
    const sb = stasisLinked.has(b) ? 0 : 1
    if (sa !== sb) return sa - sb
    return a.localeCompare(b)
  })

  const unclaimed = [...frontier].filter((cell) => claims[cell] == null)

  for (const host of sorted) {
    if (state.pending?.[host]) continue
    if (workerClaimCell(state, host)) continue

    const sess = state.sessions[host]
    const pos = sess?.coords ?? sess?.lastCoords
    if (!pos) continue

    let bestCell: string | null = null
    let bestDist = Infinity
    for (const cell of unclaimed) {
      const target = parseCellKey(cell)
      if (!target) continue
      const dist = bfsDistanceToTarget(state.map, pos[0], pos[1], target[0], target[1])
      if (dist === null) continue
      if (dist < bestDist) {
        bestDist = dist
        bestCell = cell
      }
    }

    if (bestCell) {
      claims[bestCell] = host
      const idx = unclaimed.indexOf(bestCell)
      if (idx >= 0) unclaimed.splice(idx, 1)
    }
  }
}

function cellClaimedByOther(state: LabyrinthState, cellKeyStr: string, workerHost: string): boolean {
  const owner = state.claims?.[cellKeyStr]
  return owner != null && owner !== workerHost
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
  ensurePending(state)
  ensureClaims(state)
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

  const claim = workerClaimCell(state, workerHost)
  if (claim) {
    const target = parseCellKey(claim)
    if (target) {
      const step = bfsFirstStepToward(map, x, y, target[0], target[1])
      if (step) return step
    }
    releaseWorkerClaim(state, workerHost)
  }

  for (const dir of WALL_ORDER) {
    const wallKey = DIR_TO_WALL[dir]
    if (!walls[wallKey]) continue
    const [dx, dy] = LABYRINTH_DIRS[dir]
    const nkey = cellKey(x + dx, y + dy)
    if (cellExplored(map, nkey)) continue
    if (cellClaimedByOther(state, nkey, workerHost)) continue
    return dir
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
    return { type: "labyrinth", map: {}, sessions: {}, pending: {}, claims: {} }
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
