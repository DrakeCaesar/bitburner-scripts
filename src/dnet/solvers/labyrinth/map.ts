import type { LabyrinthCellWalls, LabyrinthDir, LabyrinthWallSide, LabyrinthWalls } from "./types.js"

export const LABYRINTH_DIRS: Record<LabyrinthDir, [number, number]> = {
  n: [0, -2],
  e: [2, 0],
  s: [0, 2],
  w: [-2, 0],
}

export const LABYRINTH_OPPOSITE: Record<LabyrinthDir, LabyrinthDir> = {
  n: "s",
  e: "w",
  s: "n",
  w: "e",
}

export const DIR_TO_WALL: Record<LabyrinthDir, LabyrinthWallSide> = {
  n: "north",
  e: "east",
  s: "south",
  w: "west",
}

export const WALL_ORDER: readonly LabyrinthDir[] = ["n", "e", "s", "w"]

/** Half-width of labradar ASCII view (game getSurroundingsVisualized range=3). */
export const LABRADAR_RANGE = 3

export function cellKey(x: number, y: number): string {
  return `${x},${y}`
}

export function parseCellKey(key: string): [number, number] | null {
  const [xs, ys] = key.split(",")
  const x = Number(xs)
  const y = Number(ys)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return [x, y]
}

export function emptyCell(): LabyrinthCellWalls {
  return { seen: false, north: null, east: null, south: null, west: null }
}

export function cellExplored(map: Record<string, LabyrinthCellWalls>, key: string): boolean {
  return map[key]?.seen === true
}

function ensureCell(map: Record<string, LabyrinthCellWalls>, key: string): LabyrinthCellWalls {
  if (!map[key]) map[key] = emptyCell()
  return map[key]!
}

function prunePropagationStubs(map: Record<string, LabyrinthCellWalls>): void {
  for (const key of Object.keys(map)) {
    const cell = map[key]!
    if (cell.seen) continue
    const known = [cell.north, cell.east, cell.south, cell.west].filter((v) => v !== null).length
    if (known >= 2) {
      cell.seen = true
      continue
    }
    delete map[key]
  }
}

/** Game maze wall tile in labradar ASCII (Darknet labyrinth.ts WALL). */
const LAB_ASCII_WALL = "\u2588"

function labradarCharPassable(ch: string | undefined): boolean | null {
  if (ch == null || ch.length === 0) return null
  if (ch === " " || ch === "@" || ch === "X") return true
  if (ch === LAB_ASCII_WALL || ch === "#") return false
  return null
}

function labradarTileAt(
  lines: readonly string[],
  originX: number,
  originY: number,
  gx: number,
  gy: number,
): string | undefined {
  const col = gx - originX + LABRADAR_RANGE
  const row = gy - originY + LABRADAR_RANGE
  if (row < 0 || col < 0 || row >= lines.length) return undefined
  const line = lines[row]!
  if (col >= line.length) return undefined
  return line[col]!
}

function sameRoomParity(x: number, y: number, originX: number, originY: number): boolean {
  return (x & 1) === (originX & 1) && (y & 1) === (originY & 1)
}

function resolveRadarWall(observed: boolean | null, existing: boolean | null | undefined): boolean {
  if (observed != null) return observed
  if (existing != null) return existing
  return false
}

/**
 * Merge a 7x7 labradar ASCII view into the shared map (rooms + corridor passages).
 * Uses the same tile layout as getSurroundingsVisualized / getLocationStatus in game source.
 */
export function mergeLabradarAscii(
  map: Record<string, LabyrinthCellWalls>,
  originX: number,
  originY: number,
  message: string,
): number {
  const lines = message.split("\n").filter((line) => line.length > 0)
  if (lines.length === 0) return 0

  let merged = 0
  const minX = originX - LABRADAR_RANGE
  const maxX = originX + LABRADAR_RANGE
  const minY = originY - LABRADAR_RANGE
  const maxY = originY + LABRADAR_RANGE

  for (let ry = minY; ry <= maxY; ry++) {
    for (let rx = minX; rx <= maxX; rx++) {
      if (!sameRoomParity(rx, ry, originX, originY)) continue

      const center = labradarTileAt(lines, originX, originY, rx, ry)
      if (labradarCharPassable(center) !== true) continue

      const pick = (gx: number, gy: number): boolean | null =>
        labradarCharPassable(labradarTileAt(lines, originX, originY, gx, gy))

      const northObs = pick(rx, ry - 1)
      const southObs = pick(rx, ry + 1)
      const eastObs = pick(rx + 1, ry)
      const westObs = pick(rx - 1, ry)

      if (northObs == null && southObs == null && eastObs == null && westObs == null) continue

      const existing = map[cellKey(rx, ry)]
      const walls: LabyrinthWalls = {
        north: resolveRadarWall(northObs, existing?.north),
        east: resolveRadarWall(eastObs, existing?.east),
        south: resolveRadarWall(southObs, existing?.south),
        west: resolveRadarWall(westObs, existing?.west),
      }

      mergeCell(map, rx, ry, walls)
      merged++

      const propagate: [boolean, number, number, LabyrinthWallSide][] = [
        [walls.north, 0, -2, "south"],
        [walls.east, 2, 0, "west"],
        [walls.south, 0, 2, "north"],
        [walls.west, -2, 0, "east"],
      ]
      for (const [open, dx, dy, opposite] of propagate) {
        if (!open) continue
        ensureCell(map, cellKey(rx + dx, ry + dy))[opposite] = true
      }
    }
  }

  prunePropagationStubs(map)
  return merged
}

/** Merge labreport walls into the shared map and propagate to adjacent cells. */
export function mergeCell(
  map: Record<string, LabyrinthCellWalls>,
  x: number,
  y: number,
  walls: LabyrinthWalls,
): void {
  const cell = ensureCell(map, cellKey(x, y))
  cell.seen = true
  cell.north = walls.north
  cell.east = walls.east
  cell.south = walls.south
  cell.west = walls.west

  const propagate: [LabyrinthWallSide, number, number, LabyrinthWallSide][] = [
    ["north", 0, -2, "south"],
    ["east", 2, 0, "west"],
    ["south", 0, 2, "north"],
    ["west", -2, 0, "east"],
  ]
  for (const [side, dx, dy, opposite] of propagate) {
    const ncell = map[cellKey(x + dx, y + dy)]
    if (ncell) ncell[opposite] = walls[side]
  }
}

/** Record an open midpoint passage after a successful move. */
export function confirmMovePassage(
  map: Record<string, LabyrinthCellWalls>,
  x: number,
  y: number,
  dir: LabyrinthDir,
): void {
  const wallKey = DIR_TO_WALL[dir]
  const delta = LABYRINTH_DIRS[dir]
  const cell = ensureCell(map, cellKey(x, y))
  cell.seen = true
  cell[wallKey] = true
  const [dx, dy] = delta
  const oppKey = DIR_TO_WALL[LABYRINTH_OPPOSITE[dir]]
  const neighbor = map[cellKey(x + dx, y + dy)]
  if (neighbor?.seen) neighbor[oppKey] = true
}

export function wallsAt(
  map: Record<string, LabyrinthCellWalls>,
  x: number,
  y: number,
  fallback: LabyrinthWalls | null,
): LabyrinthWalls | null {
  const cell = map[cellKey(x, y)]
  if (!cell) return fallback
  const pick = (side: LabyrinthWallSide, fb: boolean): boolean => {
    const v = cell[side]
    return v !== null ? v : fb
  }
  if (!fallback) {
    if (cell.north === null && cell.east === null && cell.south === null && cell.west === null) {
      return null
    }
    return {
      north: cell.north ?? false,
      east: cell.east ?? false,
      south: cell.south ?? false,
      west: cell.west ?? false,
    }
  }
  return {
    north: pick("north", fallback.north),
    east: pick("east", fallback.east),
    south: pick("south", fallback.south),
    west: pick("west", fallback.west),
  }
}

function passable(
  map: Record<string, LabyrinthCellWalls>,
  x: number,
  y: number,
  dir: LabyrinthDir,
): boolean {
  const walls = map[cellKey(x, y)]
  const wallKey = DIR_TO_WALL[dir]
  return walls?.seen === true && walls[wallKey] === true
}

/** Any explored cell with an open edge into an unseen cell. */
export function globalFrontierRemaining(map: Record<string, LabyrinthCellWalls>): boolean {
  for (const [key, walls] of Object.entries(map)) {
    if (!walls.seen) continue
    const pos = parseCellKey(key)
    if (!pos) continue
    const [x, y] = pos
    for (const dir of WALL_ORDER) {
      const wallKey = DIR_TO_WALL[dir]
      if (walls[wallKey] !== true) continue
      const [dx, dy] = LABYRINTH_DIRS[dir]
      if (!cellExplored(map, cellKey(x + dx, y + dy))) return true
    }
  }
  return false
}

/** Unexplored cells reachable in one open step from any explored cell. */
export function frontierCells(map: Record<string, LabyrinthCellWalls>): string[] {
  const out = new Set<string>()
  for (const [key, walls] of Object.entries(map)) {
    if (!walls.seen) continue
    const pos = parseCellKey(key)
    if (!pos) continue
    const [x, y] = pos
    for (const dir of WALL_ORDER) {
      const wallKey = DIR_TO_WALL[dir]
      if (walls[wallKey] !== true) continue
      const [dx, dy] = LABYRINTH_DIRS[dir]
      const nkey = cellKey(x + dx, y + dy)
      if (!cellExplored(map, nkey)) out.add(nkey)
    }
  }
  return [...out].sort()
}

function canStepToTarget(
  map: Record<string, LabyrinthCellWalls>,
  x: number,
  y: number,
  targetX: number,
  targetY: number,
): boolean {
  for (const dir of WALL_ORDER) {
    const [dx, dy] = LABYRINTH_DIRS[dir]
    if (x + dx !== targetX || y + dy !== targetY) continue
    if (passable(map, x, y, dir)) return true
  }
  return false
}

/** Shortest explored-path distance to a cell we can step into from (x, y). */
export function bfsDistanceToTarget(
  map: Record<string, LabyrinthCellWalls>,
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
): number | null {
  if (canStepToTarget(map, startX, startY, targetX, targetY)) return 0

  const startKey = cellKey(startX, startY)
  if (!cellExplored(map, startKey)) return null

  type Node = { x: number; y: number; dist: number }
  const queue: Node[] = [{ x: startX, y: startY, dist: 0 }]
  const visited = new Set<string>([startKey])

  while (queue.length > 0) {
    const { x, y, dist } = queue.shift()!
    for (const dir of WALL_ORDER) {
      if (!passable(map, x, y, dir)) continue
      const [dx, dy] = LABYRINTH_DIRS[dir]
      const nx = x + dx
      const ny = y + dy
      if (canStepToTarget(map, nx, ny, targetX, targetY)) return dist + 1
      const nkey = cellKey(nx, ny)
      if (!cellExplored(map, nkey) || visited.has(nkey)) continue
      visited.add(nkey)
      queue.push({ x: nx, y: ny, dist: dist + 1 })
    }
  }
  return null
}

/** First step on an explored path toward stepping into (targetX, targetY). */
export function bfsFirstStepToward(
  map: Record<string, LabyrinthCellWalls>,
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
): LabyrinthDir | null {
  if (canStepToTarget(map, startX, startY, targetX, targetY)) {
    for (const dir of WALL_ORDER) {
      const [dx, dy] = LABYRINTH_DIRS[dir]
      if (startX + dx === targetX && startY + dy === targetY && passable(map, startX, startY, dir)) {
        return dir
      }
    }
  }

  const startKey = cellKey(startX, startY)
  if (!cellExplored(map, startKey)) return null

  type Node = { x: number; y: number; first: LabyrinthDir }
  const queue: Node[] = []
  const visited = new Set<string>([startKey])

  for (const dir of WALL_ORDER) {
    if (!passable(map, startX, startY, dir)) continue
    const [dx, dy] = LABYRINTH_DIRS[dir]
    const nx = startX + dx
    const ny = startY + dy
    const nkey = cellKey(nx, ny)
    if (canStepToTarget(map, nx, ny, targetX, targetY)) return dir
    if (!cellExplored(map, nkey) || visited.has(nkey)) continue
    visited.add(nkey)
    queue.push({ x: nx, y: ny, first: dir })
  }

  while (queue.length > 0) {
    const { x, y, first } = queue.shift()!
    for (const dir of WALL_ORDER) {
      if (!passable(map, x, y, dir)) continue
      const [dx, dy] = LABYRINTH_DIRS[dir]
      const nx = x + dx
      const ny = y + dy
      const nkey = cellKey(nx, ny)
      if (canStepToTarget(map, nx, ny, targetX, targetY)) return first
      if (!cellExplored(map, nkey) || visited.has(nkey)) continue
      visited.add(nkey)
      queue.push({ x: nx, y: ny, first })
    }
  }
  return null
}

/** Explored-room path from start to a frontier claim (includes the claim cell). */
export function bfsPathToClaim(
  map: Record<string, LabyrinthCellWalls>,
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
): [number, number][] | null {
  const startKey = cellKey(startX, startY)
  if (!cellExplored(map, startKey)) return null
  if (startX === targetX && startY === targetY) return [[startX, startY]]

  const parent = new Map<string, string | null>()
  parent.set(startKey, null)
  const queue: string[] = [startKey]
  let goalKey: string | null = null

  while (queue.length > 0) {
    const key = queue.shift()!
    const pos = parseCellKey(key)
    if (!pos) continue
    const [x, y] = pos
    if (canStepToTarget(map, x, y, targetX, targetY)) {
      goalKey = key
      break
    }
    for (const dir of WALL_ORDER) {
      if (!passable(map, x, y, dir)) continue
      const [dx, dy] = LABYRINTH_DIRS[dir]
      const nkey = cellKey(x + dx, y + dy)
      if (!cellExplored(map, nkey) || parent.has(nkey)) continue
      parent.set(nkey, key)
      queue.push(nkey)
    }
  }

  if (goalKey == null) return null

  const path: [number, number][] = []
  let cur: string | null = goalKey
  while (cur != null) {
    const pos = parseCellKey(cur)
    if (!pos) break
    path.unshift(pos)
    cur = parent.get(cur) ?? null
  }
  path.push([targetX, targetY])
  return path
}

function corridorAxis(
  from: [number, number],
  to: [number, number],
): "ns" | "ew" | null {
  const [x1, y1] = from
  const [x2, y2] = to
  if (x1 === x2 && Math.abs(y2 - y1) === 2) return "ns"
  if (y1 === y2 && Math.abs(x2 - x1) === 2) return "ew"
  return null
}

/** Grid corridor cell between two adjacent logical room cells. */
export function corridorGridBetween(
  minX: number,
  minY: number,
  from: [number, number],
  to: [number, number],
): [number, number] | null {
  const toGrid = (x: number, y: number): [number, number] => [
    ((x - minX) / 2) * 2,
    ((y - minY) / 2) * 2,
  ]
  const [gx1, gy1] = toGrid(from[0], from[1])
  const [gx2, gy2] = toGrid(to[0], to[1])
  if (gx2 > gx1) return [gy1, gx1 + 1]
  if (gx2 < gx1) return [gy1, gx1 - 1]
  if (gy2 > gy1) return [gy1 + 1, gx1]
  if (gy2 < gy1) return [gy1 - 1, gx1]
  return null
}

/** First step toward the nearest cell beyond the exploration frontier. */
export function bfsFirstStep(
  map: Record<string, LabyrinthCellWalls>,
  startX: number,
  startY: number,
): LabyrinthDir | null {
  const startKey = cellKey(startX, startY)
  if (!cellExplored(map, startKey)) return null

  type Node = { x: number; y: number; first: LabyrinthDir }
  const queue: Node[] = []
  const visited = new Set<string>([startKey])

  for (const dir of WALL_ORDER) {
    if (!passable(map, startX, startY, dir)) continue
    const [dx, dy] = LABYRINTH_DIRS[dir]
    const nx = startX + dx
    const ny = startY + dy
    const nkey = cellKey(nx, ny)
    if (!cellExplored(map, nkey)) return dir
    if (visited.has(nkey)) continue
    visited.add(nkey)
    queue.push({ x: nx, y: ny, first: dir })
  }

  while (queue.length > 0) {
    const { x, y, first } = queue.shift()!
    for (const dir of WALL_ORDER) {
      if (!passable(map, x, y, dir)) continue
      const [dx, dy] = LABYRINTH_DIRS[dir]
      const nx = x + dx
      const ny = y + dy
      const nkey = cellKey(nx, ny)
      if (!cellExplored(map, nkey)) return first
      if (visited.has(nkey)) continue
      visited.add(nkey)
      queue.push({ x: nx, y: ny, first })
    }
  }
  return null
}

export function ensureMap(state: {
  map: Record<string, LabyrinthCellWalls>
  sessions: Record<string, { coords: [number, number] | null; walls: LabyrinthWalls | null }>
}): Record<string, LabyrinthCellWalls> {
  if (!state.map) state.map = {}
  for (const sess of Object.values(state.sessions)) {
    if (sess.coords && sess.walls) {
      mergeCell(state.map, sess.coords[0], sess.coords[1], sess.walls)
    }
  }
  prunePropagationStubs(state.map)
  return state.map
}

export type MapGridChar = "wall" | "open" | "unknown" | "worker" | "frontier" | "claimed" | "goal"

export interface BuildMapGridOptions {
  /** Unexplored logical cell keys on the exploration frontier. */
  frontier?: readonly string[]
  /** Frontier cell key -> worker host owning the claim. */
  claims?: Record<string, string>
  /** Stable host order for A-Z letter assignment (defaults to sorted session keys). */
  workerHostOrder?: readonly string[]
  /** Goal cell from labradar (rendered as X). */
  goal?: [number, number] | null
}

export interface MapPathSegment {
  letter: string
  axis: "ns" | "ew"
}

export interface MapGrid {
  minX: number
  minY: number
  width: number
  height: number
  /** Row-major grid of cell kinds (includes wall corridors between cells). */
  cells: MapGridChar[][]
  /** Worker markers at logical cell keys. */
  workerMarkers: Map<string, string>
  /** Claimed frontier logical cell key (route target, no letter). */
  claimTargets: Set<string>
  /** Corridor grid key "gy,gx" -> worker route segment. */
  pathSegments: Map<string, MapPathSegment>
}

const WORKER_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

export function sessionDisplayCoords(sess: {
  coords: [number, number] | null
  lastCoords: [number, number] | null
}): [number, number] | null {
  return sess.coords ?? sess.lastCoords
}

export function buildMapGrid(
  map: Record<string, LabyrinthCellWalls>,
  sessions: Record<string, { coords: [number, number] | null; lastCoords?: [number, number] | null }>,
  options?: BuildMapGridOptions,
): MapGrid | null {
  const known = new Set<string>()
  for (const [k, cell] of Object.entries(map)) {
    if (cell.seen) known.add(k)
  }

  const frontierSet = new Set(options?.frontier ?? [])
  for (const k of frontierSet) known.add(k)
  if (options?.goal != null) {
    known.add(cellKey(options.goal[0], options.goal[1]))
  }

  const workerMarkers = new Map<string, string>()
  const claimTargets = new Set<string>()
  const pathSegments = new Map<string, MapPathSegment>()
  const workers =
    options?.workerHostOrder != null && options.workerHostOrder.length > 0
      ? [...options.workerHostOrder]
      : Object.keys(sessions).sort()
  const letterForHost = new Map<string, string>()
  for (let i = 0; i < workers.length; i++) {
    const host = workers[i]!
    letterForHost.set(host, WORKER_LETTERS[i] ?? String(i + 1))
  }

  for (let i = 0; i < workers.length; i++) {
    const host = workers[i]!
    const sess = sessions[host]
    if (!sess) continue
    const pos = sessionDisplayCoords({
      coords: sess.coords,
      lastCoords: sess.lastCoords ?? null,
    })
    if (!pos) continue
    const k = cellKey(pos[0], pos[1])
    known.add(k)
    const letter = letterForHost.get(host)!
    const prev = workerMarkers.get(k)
    workerMarkers.set(k, prev ? "*" : letter)
  }

  for (const [cell, host] of Object.entries(options?.claims ?? {})) {
    if (!frontierSet.has(cell)) continue
    if (letterForHost.has(host)) claimTargets.add(cell)
  }

  if (known.size === 0) return null

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const k of known) {
    const pos = parseCellKey(k)
    if (!pos) continue
    const [x, y] = pos
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  minX -= 2
  maxX += 2
  minY -= 2
  maxY += 2

  const cols = Math.floor((maxX - minX) / 2) + 1
  const rows = Math.floor((maxY - minY) / 2) + 1
  if (cols <= 0 || rows <= 0) return null

  const gh = rows * 2 - 1
  const gw = cols * 2 - 1
  const cells: MapGridChar[][] = Array.from({ length: gh }, () => Array<MapGridChar>(gw).fill("unknown"))

  const toGrid = (x: number, y: number): [number, number] => [
    ((x - minX) / 2) * 2,
    ((y - minY) / 2) * 2,
  ]

  for (const k of known) {
    const pos = parseCellKey(k)
    if (!pos) continue
    const [x, y] = pos
    const [gx, gy] = toGrid(x, y)
    const explored = map[k]?.seen === true
    if (workerMarkers.has(k)) {
      cells[gy]![gx] = "worker"
    } else if (
      options?.goal != null &&
      x === options.goal[0] &&
      y === options.goal[1]
    ) {
      cells[gy]![gx] = "goal"
    } else if (!explored && claimTargets.has(k)) {
      cells[gy]![gx] = "claimed"
    } else if (!explored && frontierSet.has(k)) {
      cells[gy]![gx] = "frontier"
    } else {
      cells[gy]![gx] = "open"
    }
  }

  for (const [k, walls] of Object.entries(map)) {
    if (!walls.seen) continue
    const pos = parseCellKey(k)
    if (!pos) continue
    const [x, y] = pos
    const [gx, gy] = toGrid(x, y)
    const setEdge = (egy: number, egx: number, open: boolean | null, axis: "ns" | "ew") => {
      if (egy < 0 || egx < 0 || egy >= gh || egx >= gw) return
      if (open === true) {
        cells[egy]![egx] = "open"
        const markWall = (r: number, c: number) => {
          if (r < 0 || c < 0 || r >= gh || c >= gw) return
          if (cells[r]![c] === "unknown") cells[r]![c] = "wall"
        }
        if (axis === "ew") {
          markWall(egy - 1, egx)
          markWall(egy + 1, egx)
        } else {
          markWall(egy, egx - 1)
          markWall(egy, egx + 1)
        }
      } else if (open === false) {
        cells[egy]![egx] = "wall"
      }
    }
    setEdge(gy - 1, gx, walls.north, "ns")
    setEdge(gy + 1, gx, walls.south, "ns")
    setEdge(gy, gx + 1, walls.east, "ew")
    setEdge(gy, gx - 1, walls.west, "ew")
  }

  for (const host of workers) {
    const sess = sessions[host]
    if (!sess) continue
    const pos = sessionDisplayCoords({
      coords: sess.coords,
      lastCoords: sess.lastCoords ?? null,
    })
    if (!pos) continue

    let claimKey: string | null = null
    for (const [cell, claimHost] of Object.entries(options?.claims ?? {})) {
      if (claimHost === host && frontierSet.has(cell)) {
        claimKey = cell
        break
      }
    }
    if (claimKey == null) continue
    const target = parseCellKey(claimKey)
    if (!target) continue
    if (pos[0] === target[0] && pos[1] === target[1]) continue

    const path = bfsPathToClaim(map, pos[0], pos[1], target[0], target[1])
    if (path == null || path.length < 2) continue
    const letter = letterForHost.get(host)
    if (!letter) continue

    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i]!
      const to = path[i + 1]!
      const axis = corridorAxis(from, to)
      if (!axis) continue
      const corridor = corridorGridBetween(minX, minY, from, to)
      if (!corridor) continue
      const [cy, cx] = corridor
      pathSegments.set(`${cy},${cx}`, { letter, axis })
    }
  }

  return { minX, minY, width: gw, height: gh, cells, workerMarkers, claimTargets, pathSegments }
}
