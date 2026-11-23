import type { GuessRequest, GuessResult, SolverModule } from "../types.js"
import { geometryForHost, type LabGeometry } from "./geometry.js"
import { cellKey, DIR_TO_WALL, LABYRINTH_DIRS, LABYRINTH_OPPOSITE, parseCellKey, WALL_ORDER } from "./map.js"
import { LABRADAR_RANGE } from "./parseGoal.js"
import type {
  LabreportPayload,
  LabyrinthCellWalls,
  LabyrinthDir,
  LabyrinthSession,
  LabyrinthSnapshot,
  LabyrinthState,
  LabyrinthWalls,
  LabyrinthWallSide,
} from "./types.js"

/**
 * Labyrinth exploration.
 *
 * Every action (move, labreport, labradar) costs the same time, so the plan is about spending as
 * few as possible:
 *
 *  - A move's reply already carries the new position and the walls around it. labreport is only
 *    needed when a worker's position is unknown (it just joined, or a reply went missing).
 *  - The end is known from the labyrinth's size (geometry.ts), up to nine cells in the big ones;
 *    one labradar near the corner tells which.
 *  - Workers go to the reachable unexplored cell with the lowest
 *    `moves to get there + weight * estimated moves from there to the end`, the estimate running
 *    through the gaps between the four quadrants. Each cell is taken by one worker at a time.
 *
 * All state lives in LabyrinthState and is shared by every worker next to the labyrinth. A worker
 * that leaves loses its session only; what it mapped stays.
 */

export type LabyrinthAction =
  | { type: "labreport" }
  | { type: "labradar"; origin: [number, number] }
  | { type: "move"; dir: LabyrinthDir }

export type LabyrinthOutcome =
  /** The request never reached the labyrinth (timed out): the worker is where it was. */
  | { kind: "timeout" }
  /** No usable answer: the worker's position has to be read again. */
  | { kind: "lost" }
  | { kind: "labreport"; report: Omit<LabreportPayload, "workerHost"> }
  | { kind: "labradar"; message: string }
  | { kind: "move"; message?: string; data?: string }

export interface LabyrinthTuning {
  /** Weight of the estimated remaining distance against the walk to a frontier cell. */
  heuristicWeight: number
  /** Scan for the end when one labradar would cover at least this share of the cells it can still be. */
  radarGoalFraction: number
}

/**
 * Swept in the bench (pnpm run test:labyrinth) on the 40x26 and 60x40 labyrinths: weights 2..5 are
 * within noise of each other and 1 is ~30% slower; the labradar share hardly matters. Scanning for
 * walls (rather than for the end) and spreading workers over the quadrants were tried and did not help.
 */
export const DEFAULT_LABYRINTH_TUNING: LabyrinthTuning = { heuristicWeight: 2, radarGoalFraction: 0.5 }

const SIDES: readonly LabyrinthWallSide[] = ["north", "east", "south", "west"]
const WALL_TO_DIR: Record<LabyrinthWallSide, LabyrinthDir> = { north: "n", east: "e", south: "s", west: "w" }
const LAB_ASCII_WALL = "█"
const GOAL_BONUS = 1e6

function freshSession(): LabyrinthSession {
  return { path: [], coords: null, lastCoords: null, walls: null, phase: "labreport" }
}

function session(state: LabyrinthState, workerHost: string): LabyrinthSession {
  if (!state.sessions[workerHost]) state.sessions[workerHost] = freshSession()
  return state.sessions[workerHost]!
}

export function ensureWorkerSession(state: LabyrinthState, workerHost: string): LabyrinthSession {
  return session(state, workerHost)
}

function geometryOf(state: LabyrinthState): LabGeometry | null {
  return state.geometryOff === true ? null : geometryForHost(state.host)
}

function inBounds(geometry: LabGeometry | null, x: number, y: number): boolean {
  if (x < 1 || y < 1) return false
  return geometry === null || (x <= geometry.maxX && y <= geometry.maxY)
}

// ---------------------------------------------------------------------------------------------
// Map: a cell is `seen` once all four of its walls are known, whoever found them out.

function cellAt(map: Record<string, LabyrinthCellWalls>, x: number, y: number): LabyrinthCellWalls {
  const key = cellKey(x, y)
  if (!map[key]) map[key] = { seen: false, north: null, east: null, south: null, west: null }
  return map[key]!
}

function refreshSeen(cell: LabyrinthCellWalls): void {
  cell.seen = cell.north !== null && cell.east !== null && cell.south !== null && cell.west !== null
}

/** True when what a worker saw at (x, y) cannot happen in the layout geometry.ts describes. */
function violatesGeometry(geometry: LabGeometry, x: number, y: number, walls: LabyrinthWalls): boolean {
  if (!inBounds(geometry, x, y)) return true
  const { x0, y0, maxX, maxY } = geometry
  if (
    (x === 1 && walls.west) ||
    (x === maxX && walls.east) ||
    (y === 1 && walls.north) ||
    (y === maxY && walls.south)
  ) {
    return true
  }
  const rowHasGap = geometry.topRows.includes(y) || geometry.bottomRows.includes(y)
  const colHasGap = geometry.leftCols.includes(x) || geometry.rightCols.includes(x)
  if (!rowHasGap && ((x === x0 - 1 && walls.east) || (x === x0 + 1 && walls.west))) return true
  if (!colHasGap && ((y === y0 - 1 && walls.south) || (y === y0 + 1 && walls.north))) return true
  return false
}

/**
 * Forget the map: an observation contradicted it, so the game has built a new labyrinth (it does
 * that without notice) or the map was wrong. Sessions are cleared too; positions are read again.
 */
function resetMap(state: LabyrinthState): void {
  state.map = {}
  state.claims = {}
  state.goal = null
  state.notGoal = {}
  state.radared = {}
  state.prefilled = false
  state.resets = (state.resets ?? 0) + 1
  // Repeated resets point at the layout rules rather than at a rebuilt maze.
  if (state.resets >= 3) state.geometryOff = true
  for (const sess of Object.values(state.sessions)) {
    sess.coords = null
    sess.walls = null
    sess.phase = "labreport"
  }
}

/** Record the observed walls of one cell. Returns false when that contradicted the map (which is then reset). */
function setCellWalls(state: LabyrinthState, x: number, y: number, walls: LabyrinthWalls): boolean {
  const known = state.map[cellKey(x, y)]
  const layout = geometryOf(state)
  const offLayout = layout !== null && violatesGeometry(layout, x, y, walls)
  // The game's layout rules changed: stop relying on geometry.ts for this labyrinth.
  if (offLayout) state.geometryOff = true
  const contradicts =
    offLayout ||
    !inBounds(null, x, y) ||
    (known !== undefined && SIDES.some((side) => known[side] !== null && known[side] !== walls[side]))
  if (contradicts) resetMap(state)
  const geometry = geometryOf(state)
  const cell = cellAt(state.map, x, y)
  for (const side of SIDES) {
    cell[side] = walls[side]
    const [dx, dy] = LABYRINTH_DIRS[WALL_TO_DIR[side]]
    if (!inBounds(geometry, x + dx, y + dy)) continue
    const neighbor = cellAt(state.map, x + dx, y + dy)
    neighbor[DIR_TO_WALL[LABYRINTH_OPPOSITE[WALL_TO_DIR[side]]]] = walls[side]
    refreshSeen(neighbor)
  }
  cell.seen = true
  return !contradicts
}

function setEdge(
  map: Record<string, LabyrinthCellWalls>,
  a: Point,
  sideA: LabyrinthWallSide,
  b: Point,
  sideB: LabyrinthWallSide,
  open: boolean
): void {
  const cellA = cellAt(map, a[0], a[1])
  cellA[sideA] = open
  refreshSeen(cellA)
  const cellB = cellAt(map, b[0], b[1])
  cellB[sideB] = open
  refreshSeen(cellB)
}

interface GapWall {
  candidates: readonly number[]
  /** The two cells facing each other across the wall at candidate position v. */
  a: (v: number) => Point
  sideA: LabyrinthWallSide
  b: (v: number) => Point
  sideB: LabyrinthWallSide
}

function gapWalls(geometry: LabGeometry): { top: GapWall; bottom: GapWall; left: GapWall; right: GapWall } {
  const { x0, y0 } = geometry
  const vertical = (candidates: readonly number[]): GapWall => ({
    candidates,
    a: (r) => [x0 - 1, r],
    sideA: "east",
    b: (r) => [x0 + 1, r],
    sideB: "west",
  })
  const horizontal = (candidates: readonly number[]): GapWall => ({
    candidates,
    a: (c) => [c, y0 - 1],
    sideA: "south",
    b: (c) => [c, y0 + 1],
    sideB: "north",
  })
  return {
    top: vertical(geometry.topRows),
    bottom: vertical(geometry.bottomRows),
    left: horizontal(geometry.leftCols),
    right: horizontal(geometry.rightCols),
  }
}

/** Positions a gap can still be at: the one seen open, else those not seen closed. */
function gapCandidates(map: Record<string, LabyrinthCellWalls>, wall: GapWall): number[] {
  const left: number[] = []
  for (const v of wall.candidates) {
    const edge = map[cellKey(...wall.a(v))]?.[wall.sideA]
    if (edge === true) return [v]
    if (edge !== false) left.push(v)
  }
  return left
}

/**
 * Write into the map what the layout implies: the outer border and the walls between quadrants
 * are closed except where a gap can be, and each of those walls has exactly one gap.
 */
function applyGeometry(state: LabyrinthState): void {
  const geometry = geometryOf(state)
  if (!geometry) return
  const map = state.map
  const { x0, y0, maxX, maxY } = geometry
  const walls = gapWalls(geometry)
  if (state.prefilled !== true) {
    state.prefilled = true
    for (let y = 1; y <= maxY; y += 2) {
      if (y === y0) continue
      if (!geometry.topRows.includes(y) && !geometry.bottomRows.includes(y)) {
        setEdge(map, [x0 - 1, y], "east", [x0 + 1, y], "west", false)
      }
      cellAt(map, 1, y).west = false
      cellAt(map, maxX, y).east = false
    }
    for (let x = 1; x <= maxX; x += 2) {
      if (x === x0) continue
      if (!geometry.leftCols.includes(x) && !geometry.rightCols.includes(x)) {
        setEdge(map, [x, y0 - 1], "south", [x, y0 + 1], "north", false)
      }
      cellAt(map, x, 1).north = false
      cellAt(map, x, maxY).south = false
    }
    for (const cell of Object.values(map)) refreshSeen(cell)
  }
  for (const wall of Object.values(walls)) {
    const left = gapCandidates(map, wall)
    if (left.length !== 1) continue
    for (const v of wall.candidates) {
      setEdge(map, wall.a(v), wall.sideA, wall.b(v), wall.sideB, v === left[0])
    }
  }
}

function markNotGoal(state: LabyrinthState, x: number, y: number): void {
  if (!state.notGoal) state.notGoal = {}
  state.notGoal[cellKey(x, y)] = true
}

/** Cells the end can still be; one cell once it is known, empty when nothing is known about it. */
function goalCandidates(state: LabyrinthState): [number, number][] {
  if (state.goal != null) return [state.goal]
  const geometry = geometryOf(state)
  if (!geometry) return []
  const left = geometry.goals.filter(([x, y]) => state.notGoal?.[cellKey(x, y)] !== true)
  if (left.length === 1) state.goal = left[0]!
  return left
}

// ---------------------------------------------------------------------------------------------
// Estimated distance to the end through the quadrant gaps.

type Point = [number, number]

function moves(a: Point, b: Point): number {
  return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])) / 2
}

/** Where a gap is along its wall: exact once known, otherwise the mean of the positions it can still be at. */
function gapPosition(map: Record<string, LabyrinthCellWalls>, wall: GapWall): number {
  const left = gapCandidates(map, wall)
  if (left.length === 0) return wall.candidates[Math.floor(wall.candidates.length / 2)] ?? 1
  return left.reduce((sum, v) => sum + v, 0) / left.length
}

interface Estimator {
  (x: number, y: number): number
}

function buildEstimator(state: LabyrinthState): Estimator {
  const geometry = geometryOf(state)
  const candidates = goalCandidates(state)
  if (!geometry) {
    // Unknown labyrinth: all the game's labyrinths end bottom-right, so head there until labradar shows the end.
    if (candidates.length === 1) return (x, y) => moves([x, y], candidates[0]!)
    return (x, y) => -(x + y) / 2
  }
  const { x0, y0 } = geometry
  const goal: Point =
    candidates.length > 0
      ? [
          candidates.reduce((s, c) => s + c[0], 0) / candidates.length,
          candidates.reduce((s, c) => s + c[1], 0) / candidates.length,
        ]
      : [geometry.maxX, geometry.maxY]
  const map = state.map
  const walls = gapWalls(geometry)
  const top = gapPosition(map, walls.top)
  const bottom = gapPosition(map, walls.bottom)
  const left = gapPosition(map, walls.left)
  const right = gapPosition(map, walls.right)
  // Each gap as the cell on either side of it.
  const topL: Point = [x0 - 1, top]
  const topR: Point = [x0 + 1, top]
  const bottomL: Point = [x0 - 1, bottom]
  const bottomR: Point = [x0 + 1, bottom]
  const leftT: Point = [left, y0 - 1]
  const leftB: Point = [left, y0 + 1]
  const rightT: Point = [right, y0 - 1]
  const rightB: Point = [right, y0 + 1]
  const fromTopRight = (p: Point): number => moves(p, rightT) + 1 + moves(rightB, goal)
  const fromBottomLeft = (p: Point): number => moves(p, bottomL) + 1 + moves(bottomR, goal)
  return (x, y) => {
    const p: Point = [x, y]
    const isLeft = x < x0
    const isTop = y < y0
    if (!isLeft && !isTop) return moves(p, goal)
    if (isLeft && isTop) {
      return Math.min(moves(p, topL) + 1 + fromTopRight(topR), moves(p, leftT) + 1 + fromBottomLeft(leftB))
    }
    if (isTop) return Math.min(fromTopRight(p), moves(p, topR) + 1 + moves(topL, leftT) + 1 + fromBottomLeft(leftB))
    return Math.min(fromBottomLeft(p), moves(p, leftB) + 1 + moves(leftT, topL) + 1 + fromTopRight(topR))
  }
}

/**
 * Each quadrant is a tree, so what lies behind a frontier cell cannot leave the pocket that cell is
 * in: the cells reachable from it without crossing a known wall or entering the explored part
 * (`explored`: the cells workers can already walk to). A pocket is worth entering only if it holds a cell that leads
 * on: one beside a possible gap to the next quadrant, or one the end can be.
 *
 * Returns, for a frontier cell, the estimated moves from it to the end through the best such cell
 * of its pocket, or null when the pocket holds none.
 */
function buildPocketEstimator(
  state: LabyrinthState,
  geometry: LabGeometry,
  estimate: Estimator,
  goals: readonly Point[],
  explored: ReadonlySet<string>
): (x: number, y: number) => number | null {
  const map = state.map
  const walls = gapWalls(geometry)
  /** Onward cell key -> moves from it to the end. */
  const onward = new Map<string, number>()
  const addGap = (wall: GapWall): void => {
    for (const v of gapCandidates(map, wall)) {
      const [ax, ay] = wall.a(v)
      const [bx, by] = wall.b(v)
      onward.set(cellKey(ax, ay), 1 + estimate(bx, by))
    }
  }
  addGap(walls.top)
  addGap(walls.left)
  addGap(walls.bottom)
  addGap(walls.right)
  for (const [gx, gy] of goals) onward.set(cellKey(gx, gy), 0)

  const pocketOf = new Map<string, { x: number; y: number; rest: number }[]>()
  const flood = (x: number, y: number): { x: number; y: number; rest: number }[] => {
    const quadrant = quadrantOf(geometry, x, y)
    const found: { x: number; y: number; rest: number }[] = []
    const stack: Point[] = [[x, y]]
    pocketOf.set(cellKey(x, y), found)
    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!
      const key = cellKey(cx, cy)
      const rest = onward.get(key)
      if (rest !== undefined) found.push({ x: cx, y: cy, rest })
      const cell = map[key]
      for (const dir of WALL_ORDER) {
        if (cell?.[DIR_TO_WALL[dir]] === false) continue
        const [dx, dy] = LABYRINTH_DIRS[dir]
        const nx = cx + dx
        const ny = cy + dy
        if (!inBounds(geometry, nx, ny) || quadrantOf(geometry, nx, ny) !== quadrant) continue
        const nkey = cellKey(nx, ny)
        if (pocketOf.has(nkey) || explored.has(nkey)) continue
        pocketOf.set(nkey, found)
        stack.push([nx, ny])
      }
    }
    return found
  }

  return (x, y) => {
    const pocket = pocketOf.get(cellKey(x, y)) ?? flood(x, y)
    let best: number | null = null
    for (const cell of pocket) {
      const value = moves([x, y], [cell.x, cell.y]) + cell.rest
      if (best === null || value < best) best = value
    }
    return best
  }
}

function quadrantOf(geometry: LabGeometry | null, x: number, y: number): number {
  if (!geometry) return 0
  return (x < geometry.x0 ? 0 : 1) + (y < geometry.y0 ? 0 : 2)
}

// ---------------------------------------------------------------------------------------------
// Routes over what is known.

interface Reach {
  /** Target cell key -> moves to step into it, and the first step of that walk. */
  targets: Map<string, { dist: number; first: LabyrinthDir }>
  /** Cells with known walls that can be walked to. */
  explored: Set<string>
}

/**
 * Breadth-first over known open passages from (x, y). Targets are the cells worth walking to:
 * cells whose walls are not all known yet, and cells the end can still be.
 */
function reach(state: LabyrinthState, x: number, y: number, mayBeGoal: (key: string) => boolean): Reach {
  const map = state.map
  const targets = new Map<string, { dist: number; first: LabyrinthDir }>()
  const visited = new Set<string>([cellKey(x, y)])
  const explored = new Set<string>([cellKey(x, y)])
  let layer: { x: number; y: number; first: LabyrinthDir | null }[] = [{ x, y, first: null }]
  let dist = 0
  while (layer.length > 0) {
    const next: typeof layer = []
    dist++
    for (const node of layer) {
      const cell = map[cellKey(node.x, node.y)]
      if (!cell) continue
      for (const dir of WALL_ORDER) {
        if (cell[DIR_TO_WALL[dir]] !== true) continue
        const [dx, dy] = LABYRINTH_DIRS[dir]
        const nx = node.x + dx
        const ny = node.y + dy
        const key = cellKey(nx, ny)
        if (visited.has(key)) continue
        visited.add(key)
        const first = node.first ?? dir
        const seen = map[key]?.seen === true
        if (!seen || mayBeGoal(key)) targets.set(key, { dist, first })
        if (seen) {
          explored.add(key)
          next.push({ x: nx, y: ny, first })
        }
      }
    }
    layer = next
  }
  return { targets, explored }
}

function sortHosts(hosts: readonly string[], stasisLinked: ReadonlySet<string>): string[] {
  return [...hosts].sort((a, b) => {
    const sa = stasisLinked.has(a) ? 0 : 1
    const sb = stasisLinked.has(b) ? 0 : 1
    if (sa !== sb) return sa - sb
    return a.localeCompare(b)
  })
}

/**
 * Give every worker with a known position the cell it should walk to and the first step there.
 * Lowest cost first, one worker per cell; workers left without a cell of their own share the best one.
 * Rewrites state.claims (target cell -> worker).
 */
function assignTargets(
  state: LabyrinthState,
  explorers: readonly string[],
  stasisLinked: ReadonlySet<string>,
  tuning: LabyrinthTuning
): Map<string, { cell: string; first: LabyrinthDir }> {
  const geometry = geometryOf(state)
  const candidates = goalCandidates(state)
  const goalKeys = new Set(candidates.map(([x, y]) => cellKey(x, y)))
  // With nothing known about the end, it can be any cell no worker stood on and no labradar cleared.
  const mayBeGoal =
    candidates.length > 0
      ? (key: string): boolean => goalKeys.has(key)
      : (key: string): boolean => state.notGoal?.[key] !== true
  const goalKnown = candidates.length === 1
  const estimate = buildEstimator(state)
  const hosts = sortHosts(explorers, stasisLinked).filter((host) => state.sessions[host]?.coords != null)
  const reaches = hosts.map((host) => {
    const [x, y] = state.sessions[host]!.coords!
    return reach(state, x, y, mayBeGoal)
  })
  const explored = new Set<string>()
  for (const r of reaches) for (const key of r.explored) explored.add(key)

  const pocketEstimate = geometry ? buildPocketEstimator(state, geometry, estimate, candidates, explored) : null
  /** Weighted estimate per target cell; null for a cell in a pocket that leads nowhere. */
  const estimates = new Map<string, number | null>()
  const estimateOf = (key: string): number | null => {
    let value = estimates.get(key)
    if (value === undefined) {
      const [x, y] = parseCellKey(key)!
      if (goalKnown && goalKeys.has(key)) value = -GOAL_BONUS
      else if (pocketEstimate && !goalKeys.has(key)) {
        const rest = pocketEstimate(x, y)
        value = rest === null ? null : tuning.heuristicWeight * rest
      } else value = tuning.heuristicWeight * estimate(x, y)
      estimates.set(key, value)
    }
    return value
  }

  type Pair = { host: string; cell: string; cost: number; first: LabyrinthDir; order: number }
  const pairs: Pair[] = []
  const dead: Pair[] = []
  hosts.forEach((host, order) => {
    for (const [cell, { dist, first }] of reaches[order]!.targets) {
      const rest = estimateOf(cell)
      if (rest === null) {
        const [cx, cy] = parseCellKey(cell)!
        dead.push({ host, cell, cost: dist + tuning.heuristicWeight * estimate(cx, cy), first, order })
      } else pairs.push({ host, cell, cost: dist + rest, first, order })
    }
  })
  // Nothing useful anywhere should not happen; if it does, the layout rules are off, so explore everything.
  if (pairs.length === 0) pairs.push(...dead)
  pairs.sort((a, b) => a.cost - b.cost || a.order - b.order || (a.cell < b.cell ? -1 : a.cell > b.cell ? 1 : 0))

  const assigned = new Map<string, { cell: string; first: LabyrinthDir }>()
  const taken = new Set<string>()
  for (const pair of pairs) {
    if (assigned.has(pair.host) || taken.has(pair.cell)) continue
    assigned.set(pair.host, { cell: pair.cell, first: pair.first })
    taken.add(pair.cell)
  }
  // More workers than cells: follow the best one rather than stand still.
  for (const pair of pairs) {
    if (!assigned.has(pair.host)) assigned.set(pair.host, { cell: pair.cell, first: pair.first })
  }

  state.claims = {}
  for (const [host, { cell }] of assigned) {
    if (state.claims[cell] === undefined) state.claims[cell] = host
  }
  return assigned
}

type Assignment = Map<string, { cell: string; first: LabyrinthDir }>
const assignmentCache = new WeakMap<LabyrinthState, { key: string; tuning: LabyrinthTuning; result: Assignment }>()

/** assignTargets, reused while nothing it depends on has changed (several workers plan in one pass). */
function cachedAssignment(
  state: LabyrinthState,
  explorers: readonly string[],
  stasisLinked: ReadonlySet<string>,
  tuning: LabyrinthTuning
): Assignment {
  const key = `${state.revision ?? 0}|${explorers.join(",")}|${[...stasisLinked].join(",")}`
  const hit = assignmentCache.get(state)
  if (hit && hit.key === key && hit.tuning === tuning) return hit.result
  const result = assignTargets(state, explorers, stasisLinked, tuning)
  assignmentCache.set(state, { key, tuning, result })
  return result
}

function touch(state: LabyrinthState): void {
  state.revision = (state.revision ?? 0) + 1
}

// ---------------------------------------------------------------------------------------------
// labradar

function radarKey(x: number, y: number): string {
  return cellKey(x, y)
}

function bucketKey(x: number, y: number): string {
  const size = LABRADAR_RANGE * 2
  return `b${Math.floor(x / size)},${Math.floor(y / size)}`
}

export function markRadarBucket(state: LabyrinthState, x: number, y: number): void {
  if (!state.radared) state.radared = {}
  state.radared[radarKey(x, y)] = true
  state.radared[bucketKey(x, y)] = true
}

function wantsRadar(state: LabyrinthState, x: number, y: number, tuning: LabyrinthTuning): boolean {
  if (state.radared?.[radarKey(x, y)] === true) return false
  const geometry = geometryOf(state)
  if (state.goal == null) {
    const candidates = goalCandidates(state)
    if (!geometry) {
      if (state.radared?.[bucketKey(x, y)] !== true) return true
    } else if (candidates.length > 1) {
      const covered = candidates.filter(
        ([cx, cy]) => Math.abs(cx - x) <= LABRADAR_RANGE && Math.abs(cy - y) <= LABRADAR_RANGE
      ).length
      if (covered >= Math.max(1, Math.ceil(candidates.length * tuning.radarGoalFraction))) return true
    }
  }
  return false
}

/**
 * Merge a labradar view (7 x 7 tiles around `origin`, the nine cells with all their walls) and
 * what it says about the end. Returns the number of cells merged.
 */
export function applyLabradar(
  state: LabyrinthState,
  _workerHost: string,
  message: string,
  origin: [number, number]
): number {
  const [ox, oy] = origin
  touch(state)
  markRadarBucket(state, ox, oy)
  const lines = message.split("\n")
  const size = LABRADAR_RANGE * 2 + 1
  if (lines.length < size || lines.some((line, i) => i < size && line.length < size)) return 0
  const geometry = geometryOf(state)
  const tile = (x: number, y: number): string => lines[y - oy + LABRADAR_RANGE]![x - ox + LABRADAR_RANGE]!
  let merged = 0
  let goal: [number, number] | null = null
  const cells: [number, number][] = []
  for (let cy = oy - 2; cy <= oy + 2; cy += 2) {
    for (let cx = ox - 2; cx <= ox + 2; cx += 2) {
      if (!inBounds(geometry, cx, cy)) continue
      const centre = tile(cx, cy)
      if (centre === LAB_ASCII_WALL) continue
      if (centre === "X") goal = [cx, cy]
      cells.push([cx, cy])
      setCellWalls(state, cx, cy, {
        north: tile(cx, cy - 1) !== LAB_ASCII_WALL,
        east: tile(cx + 1, cy) !== LAB_ASCII_WALL,
        south: tile(cx, cy + 1) !== LAB_ASCII_WALL,
        west: tile(cx - 1, cy) !== LAB_ASCII_WALL,
      })
      merged++
    }
  }
  if (goal) state.goal = goal
  else for (const [cx, cy] of cells) markNotGoal(state, cx, cy)
  return merged
}

// ---------------------------------------------------------------------------------------------
// Planning and results

/**
 * The next action for an idle worker, or null when it has nothing to do. `explorers` are all
 * workers that can currently reach the labyrinth, busy ones included, so that each keeps its cell.
 */
export function planLabyrinthAction(
  state: LabyrinthState,
  workerHost: string,
  explorers: readonly string[],
  stasisLinked: ReadonlySet<string> = new Set(),
  tuning: LabyrinthTuning = DEFAULT_LABYRINTH_TUNING
): LabyrinthAction | null {
  repairState(state)
  if (state.pending[workerHost]) return null
  applyGeometry(state)
  const sess = session(state, workerHost)
  if (!sess.coords) return { type: "labreport" }
  const [x, y] = sess.coords
  if (wantsRadar(state, x, y, tuning)) return { type: "labradar", origin: [x, y] }
  const hosts = explorers.includes(workerHost) ? explorers : [...explorers, workerHost]
  const target = cachedAssignment(state, hosts, stasisLinked, tuning).get(workerHost)
  return target ? { type: "move", dir: target.first } : null
}

function place(
  state: LabyrinthState,
  sess: LabyrinthSession,
  coords: [number, number],
  walls: LabyrinthWalls | null
): void {
  sess.coords = coords
  sess.lastCoords = coords
  sess.phase = "move"
  markNotGoal(state, coords[0], coords[1])
  if (walls) {
    if (!setCellWalls(state, coords[0], coords[1], walls)) {
      // The map was reset, and every session with it; this worker's position is the one thing known.
      sess.coords = coords
      sess.lastCoords = coords
      sess.phase = "move"
      markNotGoal(state, coords[0], coords[1])
    }
    sess.walls = walls
  } else if (state.map[cellKey(coords[0], coords[1])]?.seen !== true) {
    // Position without walls is no use for planning: read both again.
    unplace(sess)
  }
}

function unplace(sess: LabyrinthSession): void {
  sess.coords = null
  sess.walls = null
  sess.phase = "labreport"
}

function parseMoveCoords(message: string | undefined): [number, number] | null {
  if (!message) return null
  const match = /(?:moved to|still at)\s+(-?\d+),(-?\d+)/.exec(message)
  return match ? [Number(match[1]), Number(match[2])] : null
}

/** Walls from the 3 x 3 tile view a move answers with ("@" in the middle). */
function parseMoveWalls(data: string | undefined): LabyrinthWalls | null {
  if (!data) return null
  const lines = data.split("\n")
  if (lines.length < 3 || lines[0]!.length < 3 || lines[1]!.length < 3 || lines[2]!.length < 3) return null
  if (lines[1]![1] !== "@") return null
  return {
    north: lines[0]![1] !== LAB_ASCII_WALL,
    east: lines[1]![2] !== LAB_ASCII_WALL,
    south: lines[2]![1] !== LAB_ASCII_WALL,
    west: lines[1]![0] !== LAB_ASCII_WALL,
  }
}

export function applyLabyrinthResult(
  state: LabyrinthState,
  workerHost: string,
  action: LabyrinthAction,
  outcome: LabyrinthOutcome
): LabyrinthState {
  repairState(state)
  touch(state)
  const sess = session(state, workerHost)
  if (outcome.kind === "timeout") return state
  if (outcome.kind === "lost") {
    if (action.type !== "labradar") unplace(sess)
    return state
  }
  if (outcome.kind === "labreport") {
    const { coords, north, east, south, west } = outcome.report
    place(state, sess, [coords[0], coords[1]], { north, east, south, west })
    return state
  }
  if (outcome.kind === "labradar") {
    if (action.type === "labradar") applyLabradar(state, workerHost, outcome.message, action.origin)
    return state
  }
  const coords = parseMoveCoords(outcome.message)
  if (!coords) {
    unplace(sess)
    return state
  }
  const before = sess.coords
  place(state, sess, coords, parseMoveWalls(outcome.data))
  if (action.type === "move" && before && (before[0] !== coords[0] || before[1] !== coords[1])) {
    const last = sess.path[sess.path.length - 1]
    if (last && action.dir === LABYRINTH_OPPOSITE[last]) sess.path.pop()
    else sess.path.push(action.dir)
  }
  return state
}

export function applyLabreport(state: LabyrinthState, report: LabreportPayload): LabyrinthState {
  const { workerHost, ...rest } = report
  return applyLabyrinthResult(state, workerHost, { type: "labreport" }, { kind: "labreport", report: rest })
}

// ---------------------------------------------------------------------------------------------
// Workers coming and going

/** Drop session, pending, and claims for a worker that left the pool or lost lab adjacency. */
export function pruneLabyrinthWorker(state: LabyrinthState, workerHost: string): void {
  touch(state)
  delete state.sessions[workerHost]
  if (state.pending) delete state.pending[workerHost]
  for (const [cell, host] of Object.entries(state.claims ?? {})) {
    if (host === workerHost) delete state.claims[cell]
  }
}

export function pruneLabyrinthWorkers(state: LabyrinthState, activeExplorers: ReadonlySet<string>): void {
  for (const host of Object.keys(state.sessions)) {
    if (!activeExplorers.has(host)) pruneLabyrinthWorker(state, host)
  }
  for (const host of Object.keys(state.pending ?? {})) {
    if (!activeExplorers.has(host)) delete state.pending[host]
  }
}

export function labyrinthWorkerPending(state: LabyrinthState, workerHost: string): string | null {
  return state.pending?.[workerHost] ?? null
}

export function labyrinthPendingMatches(state: LabyrinthState, workerHost: string, command: string): boolean {
  return state.pending?.[workerHost] === command
}

export function clearLabyrinthPending(state: LabyrinthState, workerHost: string): void {
  if (state.pending) delete state.pending[workerHost]
}

export function setLabyrinthPending(state: LabyrinthState, workerHost: string, command: string): void {
  repairState(state)
  state.pending[workerHost] = command
}

/** Fill in fields a state from an older version (or a partial one) lacks. */
export function repairState(state: LabyrinthState): LabyrinthState {
  if (!state.map) state.map = {}
  if (!state.sessions) state.sessions = {}
  if (!state.pending) state.pending = {}
  if (!state.claims) state.claims = {}
  return state
}

export function exploredCellCount(map: LabyrinthState["map"]): number {
  return Object.values(map).filter((c) => c.seen).length
}

export const labyrinthSolver: SolverModule<LabyrinthState> = {
  init(): LabyrinthState {
    return { type: "labyrinth", map: {}, sessions: {}, pending: {}, claims: {}, goal: null, notGoal: {}, radared: {} }
  },

  /** Moves only; the dispatcher (labyrinthDispatch.ts) uses planLabyrinthAction for the full set. */
  nextGuess(state, ctx): GuessRequest | null {
    const workerHost = ctx.workerHost
    if (!workerHost) return null
    if (!state.host && ctx.target) state.host = ctx.target
    const action = planLabyrinthAction(state, workerHost, Object.keys(state.sessions))
    if (action?.type !== "move") return null
    return { guess: action.dir, detail: `move ${action.dir}@${workerHost}` }
  },

  applyResult(state, guess, result: GuessResult, ctx): LabyrinthState {
    const workerHost = ctx?.workerHost
    if (!workerHost) return state
    if (guess !== "n" && guess !== "e" && guess !== "s" && guess !== "w") return state
    if (!state.host && ctx?.target) state.host = ctx.target
    return applyLabyrinthResult(
      state,
      workerHost,
      { type: "move", dir: guess },
      { kind: "move", message: result.message, data: result.feedback }
    )
  },
}

export function buildLabyrinthSnapshots(
  targets: Map<
    string,
    {
      host: string
      status: string
      solverState: unknown | null
      workerHost: string | null
      pendingGuess: string | null
    }
  >
): LabyrinthSnapshot[] {
  const out: LabyrinthSnapshot[] = []
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
