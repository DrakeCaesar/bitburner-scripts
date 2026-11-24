/**
 * Labyrinth bench core: a seeded port of the game's maze (bitburner-src src/DarkNet/effects/labyrinth.ts)
 * and of what authenticate / labreport / labradar answer, driven by the shipped labyrinth solver.
 *
 * Every action (move, labreport, labradar) takes the same time in the game, so the bench counts
 * actions: `ticks` is wall-clock (all connected workers act once per tick), `actions` is the sum.
 */
import {
  DEFAULT_LABYRINTH_TUNING,
  applyLabyrinthResult,
  labyrinthSolver,
  planLabyrinthAction,
  pruneLabyrinthWorkers,
  type LabyrinthAction,
  type LabyrinthState,
  type LabyrinthTuning,
} from "../../src/dnet/solvers/labyrinth.js"

const WALL = "█"
const PATH = " "

export interface LabSpec {
  name: string
  width: number
  height: number
  offset: boolean
}

export const LABS: LabSpec[] = [
  { name: "th3_l4byr1nth", width: 20, height: 14, offset: false },
  { name: "cru3l_l4byr1nth", width: 30, height: 20, offset: false },
  { name: "m3rc1l3ss_l4byr1nth", width: 40, height: 26, offset: false },
  { name: "ub3r_l4byr1nth", width: 60, height: 40, offset: true },
]

export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function mazeMaker(setWidth: number, setHeight: number, rng: Rng): string[][] {
  const width = setWidth % 2 === 0 ? setWidth + 1 : setWidth
  const height = setHeight % 2 === 0 ? setHeight + 1 : setHeight
  const maze: string[][] = Array.from({ length: height }, () => Array<string>(width).fill(WALL))
  const stack: [number, number][] = [[1, 1]]
  const directions = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ]
  while (stack.length > 0) {
    const [x, y] = stack.pop()!
    const neighbors = directions
      .map(([dx, dy]) => [x + dx! * 2, y + dy! * 2] as [number, number])
      .filter(([nx, ny]) => nx > 0 && nx < width && ny > 0 && ny < height && maze[ny]![nx] === WALL)
    if (neighbors.length > 0) {
      stack.push([x, y])
      const [nx, ny] = neighbors[Math.floor(rng() * neighbors.length)]!
      maze[(y + ny) / 2]![(x + nx) / 2] = PATH
      maze[ny]![nx] = PATH
      stack.push([nx, ny])
    }
  }
  return maze
}

/** generateMaze from the game, with its Math.random replaced by `rng`. */
export function generateMaze(width: number, height: number, rng: Rng): string[] {
  if (width < 5) return mazeMaker(width, height, rng).map((row) => row.join(""))
  const halfWidth = Math.ceil(width / 2)
  const halfHeight = Math.ceil(height / 2)
  const maze1 = mazeMaker(halfWidth, halfHeight, rng)
  const maze2 = mazeMaker(halfWidth, halfHeight, rng)
  const maze3 = mazeMaker(halfWidth, halfHeight, rng)
  const maze4 = mazeMaker(halfWidth, halfHeight, rng)
  const top = maze1.map((row, y) => row.slice(0, -1).concat(maze2[y]!))
  const bottom = maze3.map((row, y) => row.slice(0, -1).concat(maze4[y]!))
  const result = top.slice(0, -1).concat(bottom)
  const subWidth = maze1[0]!.length - 1
  const subHeight = maze1.length - 1
  const randomTopGap = Math.floor((rng() * halfWidth) / 4) * 2 + 1
  result[randomTopGap]![subWidth] = PATH
  const randomLeftGap = Math.floor((rng() * halfHeight) / 4) * 2 + 1
  result[subHeight]![randomLeftGap] = PATH
  const randomBottomGap = (Math.floor((rng() * halfWidth) / 4) + 1) * 2
  result[height - randomBottomGap - 1]![subWidth] = PATH
  const randomRightGap = (Math.floor((rng() * halfHeight) / 4) + 1) * 2
  result[subHeight]![width - randomRightGap - 1] = PATH
  return result.map((row) => row.join(""))
}

function surroundings(maze: string[], x: number, y: number, range: number, end: [number, number] | null): string {
  const rows: string[] = []
  for (let i = y - range; i <= y + range; i++) {
    let row = ""
    for (let j = x - range; j <= x + range; j++) {
      if (i === y && j === x) row += "@"
      else if (end && i === end[1] && j === end[0]) row += "X"
      else row += maze[i]?.[j] ?? PATH
    }
    rows.push(row)
  }
  return rows.join("\n")
}

const DIRS: Record<string, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }

/** The labyrinth server: one position per worker script (pid), like DarknetState.labLocations. */
export class LabSim {
  readonly maze: string[]
  readonly end: [number, number]
  readonly positions = new Map<string, [number, number]>()
  solved = false

  constructor(
    readonly spec: LabSpec,
    private readonly rng: Rng
  ) {
    this.maze = generateMaze(spec.width, spec.height, rng)
    const [ox, oy] = this.offset()
    this.end = [this.maze[0]!.length - 2 - ox, this.maze.length - 2 - oy]
  }

  private offset(): [number, number] {
    if (!this.spec.offset) return [0, 0]
    return [Math.floor(this.rng() * 3) * 2, Math.floor(this.rng() * 3) * 2]
  }

  position(pid: string): [number, number] {
    let pos = this.positions.get(pid)
    if (!pos) {
      const [ox, oy] = this.offset()
      pos = [1 + ox, 1 + oy]
      this.positions.set(pid, pos)
    }
    return pos
  }

  /** A new script on the same host: the game hands it a fresh start position. */
  restart(pid: string): void {
    this.positions.delete(pid)
  }

  labreport(pid: string): { coords: [number, number]; north: boolean; east: boolean; south: boolean; west: boolean } {
    const [x, y] = this.position(pid)
    const open = (dx: number, dy: number): boolean => this.maze[y + dy]?.[x + dx] === PATH
    return { coords: [x, y], north: open(0, -1), east: open(1, 0), south: open(0, 1), west: open(-1, 0) }
  }

  labradar(pid: string): string {
    const [x, y] = this.position(pid)
    return surroundings(this.maze, x, y, 3, this.end)
  }

  move(pid: string, dir: string): { success: boolean; message: string; data: string } {
    const [x, y] = this.position(pid)
    if (this.solved) return { success: true, message: "You have discovered the end of the labyrinth.", data: "pw" }
    const [dx, dy] = DIRS[dir] ?? [0, 0]
    if (this.maze[y + dy]?.[x + dx] !== PATH) {
      return {
        success: false,
        message: `You cannot go that way. You are still at ${x},${y}.`,
        data: surroundings(this.maze, x, y, 1, null),
      }
    }
    const next: [number, number] = [x + dx * 2, y + dy * 2]
    this.positions.set(pid, next)
    if (next[0] === this.end[0] && next[1] === this.end[1]) {
      this.solved = true
      return { success: true, message: "You have successfully navigated the labyrinth! Congratulations", data: "pw" }
    }
    return {
      success: false,
      message: `You have moved to ${next[0]},${next[1]}.`,
      data: surroundings(this.maze, next[0], next[1], 1, null),
    }
  }

  /** Length in moves of the shortest route from the default start to the end. */
  shortestPath(from: [number, number] = [1, 1]): number {
    const key = (x: number, y: number): number => y * 1000 + x
    const dist = new Map<number, number>([[key(from[0], from[1]), 0]])
    const queue: [number, number][] = [from]
    while (queue.length > 0) {
      const [x, y] = queue.shift()!
      const d = dist.get(key(x, y))!
      if (x === this.end[0] && y === this.end[1]) return d
      for (const [dx, dy] of Object.values(DIRS)) {
        if (this.maze[y + dy]?.[x + dx] !== PATH) continue
        const k = key(x + dx * 2, y + dy * 2)
        if (dist.has(k)) continue
        dist.set(k, d + 1)
        queue.push([x + dx * 2, y + dy * 2])
      }
    }
    return -1
  }
}

export interface RunOptions {
  workers: number
  /** Chance per tick that a connected worker loses its link to the labyrinth. */
  disconnect: number
  /** Ticks a disconnected worker stays away. */
  awayTicks: number
  /** Chance that a returning worker is a new script (position back at the start). */
  restart: number
  /** Chance that an action's answer never arrives (request timed out before it was judged). */
  loss: number
  /** Extra workers join one by one every this many ticks (0: all present from the start). */
  stagger: number
  maxTicks: number
  /** Whether the solver is told the labyrinth's host name (and so its size). */
  knownHost: boolean
  /** The game builds a new maze at this tick, without telling anyone (0: never). */
  rebuildAt: number
  tuning: LabyrinthTuning
}

export const DEFAULT_RUN: RunOptions = {
  workers: 1,
  disconnect: 0,
  awayTicks: 20,
  restart: 0.5,
  loss: 0,
  stagger: 0,
  maxTicks: 20000,
  knownHost: true,
  rebuildAt: 0,
  tuning: DEFAULT_LABYRINTH_TUNING,
}

const NO_STASIS: ReadonlySet<string> = new Set()

export interface RunResult {
  solved: boolean
  ticks: number
  actions: number
  moves: number
  reports: number
  radars: number
  shortest: number
  /** Times the solver threw its map away because an observation contradicted it (should be 0). */
  resets: number
}

/**
 * One labyrinth being solved, a tick at a time. runLab() runs it to the end; the bench page steps
 * it and draws `state` (what the solver knows) between ticks.
 */
export class LabRun {
  sim: LabSim
  readonly state: LabyrinthState
  readonly hosts: string[]
  /** Workers that could reach the labyrinth in the last tick. */
  active: string[] = []
  /** What each worker did in the last tick. */
  lastActions = new Map<string, string>()
  readonly result: RunResult
  done = false
  private readonly rng: Rng
  private readonly events: Rng
  private readonly awayUntil = new Map<string, number>()

  constructor(
    readonly spec: LabSpec,
    seed: number,
    readonly opts: RunOptions
  ) {
    this.rng = mulberry32(seed)
    this.events = mulberry32(seed ^ 0x9e3779b9)
    this.sim = new LabSim(spec, this.rng)
    this.state = labyrinthSolver.init({} as never)
    if (opts.knownHost) this.state.host = spec.name
    this.hosts = Array.from({ length: opts.workers }, (_, i) => `w${String(i).padStart(2, "0")}`)
    this.result = {
      solved: false,
      ticks: 0,
      actions: 0,
      moves: 0,
      reports: 0,
      radars: 0,
      shortest: this.sim.shortestPath(this.sim.position(this.hosts[0]!)),
      resets: 0,
    }
  }

  /** Run one tick: every connected worker plans and performs one action. Returns true when finished. */
  step(): boolean {
    if (this.done) return true
    const { opts, state, result, events } = this
    const tick = ++result.ticks
    if (tick === opts.rebuildAt) this.sim = new LabSim(this.spec, this.rng)
    const sim = this.sim
    const active: string[] = []
    this.hosts.forEach((host, i) => {
      if (opts.stagger > 0 && tick <= i * opts.stagger) return
      const until = this.awayUntil.get(host)
      if (until !== undefined) {
        if (tick < until) return
        this.awayUntil.delete(host)
        if (events() < opts.restart) sim.restart(host)
      } else if (opts.disconnect > 0 && events() < opts.disconnect) {
        this.awayUntil.set(host, tick + opts.awayTicks)
        return
      }
      active.push(host)
    })
    this.active = active
    this.lastActions = new Map()
    pruneLabyrinthWorkers(state, new Set(active))

    const planned: [string, LabyrinthAction][] = []
    for (const host of active) {
      const action = planLabyrinthAction(state, host, active, NO_STASIS, opts.tuning)
      if (action) planned.push([host, action])
    }
    for (const [host, action] of planned) {
      result.actions++
      if (action.type === "move") result.moves++
      else if (action.type === "labreport") result.reports++
      else result.radars++
      this.lastActions.set(host, action.type === "move" ? `move ${action.dir}` : action.type)
      if (opts.loss > 0 && events() < opts.loss) {
        // Half of the lost answers are timeouts the worker can tell apart (nothing happened).
        applyLabyrinthResult(state, host, action, { kind: events() < 0.5 ? "timeout" : "lost" })
        this.lastActions.set(host, `${this.lastActions.get(host)} (lost)`)
        continue
      }
      if (action.type === "labreport") {
        applyLabyrinthResult(state, host, action, { kind: "labreport", report: sim.labreport(host) })
      } else if (action.type === "labradar") {
        applyLabyrinthResult(state, host, action, { kind: "labradar", message: sim.labradar(host) })
      } else {
        const res = sim.move(host, action.dir)
        if (res.success) {
          result.solved = true
          // The solver is not told about the winning move in the game either; place the worker for the picture.
          const sess = state.sessions[host]
          if (sess) sess.coords = sess.lastCoords = [...sim.position(host)]
          break
        }
        applyLabyrinthResult(state, host, action, { kind: "move", message: res.message, data: res.data })
      }
    }
    result.resets = state.resets ?? 0
    this.done = result.solved || tick >= opts.maxTicks
    return this.done
  }
}

export function runLab(spec: LabSpec, seed: number, opts: RunOptions): RunResult {
  const run = new LabRun(spec, seed, opts)
  while (!run.step()) {
    // step() does the work
  }
  return run.result
}

/** Seed of the i-th maze of a bench run (0-based), as benchLab uses it. */
export function labSeedAt(seed: number, index: number): number {
  return seed + index * 7919
}

export interface BenchSummary {
  count: number
  solved: number
  meanTicks: number
  worstTicks: number
  meanActions: number
  meanShortest: number
  meanReports: number
  meanRadars: number
  firstFailure: number | null
}

export function benchLab(spec: LabSpec, count: number, seed: number, opts: RunOptions): BenchSummary {
  const s: BenchSummary = {
    count,
    solved: 0,
    meanTicks: 0,
    worstTicks: 0,
    meanActions: 0,
    meanShortest: 0,
    meanReports: 0,
    meanRadars: 0,
    firstFailure: null,
  }
  for (let i = 0; i < count; i++) {
    const r = runLab(spec, labSeedAt(seed, i), opts)
    if (!r.solved) {
      s.firstFailure ??= labSeedAt(seed, i)
      continue
    }
    s.solved++
    s.meanTicks += r.ticks
    s.worstTicks = Math.max(s.worstTicks, r.ticks)
    s.meanActions += r.actions
    s.meanShortest += r.shortest
    s.meanReports += r.reports
    s.meanRadars += r.radars
  }
  const n = Math.max(1, s.solved)
  s.meanTicks /= n
  s.meanActions /= n
  s.meanShortest /= n
  s.meanReports /= n
  s.meanRadars /= n
  return s
}
