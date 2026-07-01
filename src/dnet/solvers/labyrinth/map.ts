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

export type MapGridChar = "wall" | "open" | "unknown" | "worker"

export interface MapGrid {
  minX: number
  minY: number
  width: number
  height: number
  /** Row-major grid of cell kinds (includes wall corridors between cells). */
  cells: MapGridChar[][]
  /** Worker markers at logical cell keys. */
  workerMarkers: Map<string, string>
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
): MapGrid | null {
  const known = new Set<string>()
  for (const [k, cell] of Object.entries(map)) {
    if (cell.seen) known.add(k)
  }

  const workerMarkers = new Map<string, string>()
  const workers = Object.keys(sessions).sort()
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
    const letter = WORKER_LETTERS[i] ?? String(i + 1)
    const prev = workerMarkers.get(k)
    workerMarkers.set(k, prev ? "*" : letter)
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
    if (workerMarkers.has(k)) {
      cells[gy]![gx] = "worker"
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

  return { minX, minY, width: gw, height: gh, cells, workerMarkers }
}
