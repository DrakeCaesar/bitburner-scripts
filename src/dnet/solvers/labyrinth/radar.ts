import { mergeLabradarAscii, sessionDisplayCoords } from "./map.js"
import { LABRADAR_RANGE, parseLabradarGoal } from "./parseGoal.js"
import type { LabyrinthState } from "./types.js"

/**
 * Spacing between labradar scan bucket origins in index coordinates.
 * 2 * RANGE = 6 gives edge-to-edge coverage with no gaps between 7-wide windows.
 */
export const LABRADAR_GRID_SPACING = LABRADAR_RANGE * 2

function ensureRadarBuckets(state: LabyrinthState): Record<string, true> {
  if (!state.radarBuckets) state.radarBuckets = {}
  return state.radarBuckets
}

export function radarBucketKey(x: number, y: number): string {
  const bx = Math.floor(x / LABRADAR_GRID_SPACING) * LABRADAR_GRID_SPACING
  const by = Math.floor(y / LABRADAR_GRID_SPACING) * LABRADAR_GRID_SPACING
  return `${bx},${by}`
}

export function needsLabradar(state: LabyrinthState, workerHost: string): boolean {
  if (state.goal != null) return false
  const sess = state.sessions[workerHost]
  if (!sess || sess.phase !== "move" || !sess.coords) return false
  const [x, y] = sess.coords
  return ensureRadarBuckets(state)[radarBucketKey(x, y)] !== true
}

export function markRadarBucket(state: LabyrinthState, x: number, y: number): void {
  ensureRadarBuckets(state)[radarBucketKey(x, y)] = true
}

export function applyLabradar(
  state: LabyrinthState,
  _workerHost: string,
  message: string,
  origin: [number, number],
): number {
  markRadarBucket(state, origin[0], origin[1])
  if (!state.map) state.map = {}
  const merged = mergeLabradarAscii(state.map, origin[0], origin[1], message)
  const goal = parseLabradarGoal(message, origin[0], origin[1])
  if (goal) state.goal = goal
  return merged
}

/** True when any idle explorer could still reveal the goal via labradar. */
export function labradarWorkRemaining(state: LabyrinthState, explorerHosts: readonly string[]): boolean {
  if (state.goal != null) return false
  for (const host of explorerHosts) {
    const sess = state.sessions[host]
    const pos = sess ? sessionDisplayCoords(sess) : null
    if (!pos) continue
    if (ensureRadarBuckets(state)[radarBucketKey(pos[0], pos[1])] !== true) return true
  }
  return false
}
