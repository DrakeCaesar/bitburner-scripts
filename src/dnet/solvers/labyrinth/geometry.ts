/**
 * What the game's generator fixes about a labyrinth before anything is explored
 * (bitburner-src src/DarkNet/effects/labyrinth.ts: labData, generateMaze, getLabMaze).
 *
 * A labyrinth is four independent perfect mazes (trees) stitched into a 2 x 2 block. The walls
 * between them are solid except for one gap per side, and each gap comes from a short list:
 *
 *        TL --top gap--  TR          top gap:    column x0, a row near the top
 *        |                |          left gap:   row y0, a column near the left
 *     left gap        right gap      bottom gap: column x0, a row near the bottom
 *        |                |          right gap:  row y0, a column near the right
 *        BL -bottom gap- BR
 *
 * Workers start in the top-left corner and the end is in the bottom-right corner, so there are
 * exactly two routes: through TR or through BL. From the fourth labyrinth on, start and end are
 * moved inwards by 0, 2 or 4 tiles per axis, which leaves nine cells the end can be.
 */

export interface LabGeometry {
  /** Cells sit on odd coordinates 1..maxX / 1..maxY; moves are two tiles long. */
  maxX: number
  maxY: number
  /** Wall column / row between the quadrants. */
  x0: number
  y0: number
  topRows: number[]
  leftCols: number[]
  bottomRows: number[]
  rightCols: number[]
  goals: [number, number][]
}

const LAB_SIZES: Record<string, { width: number; height: number; offset: boolean }> = {
  th3_l4byr1nth: { width: 20, height: 14, offset: false },
  cru3l_l4byr1nth: { width: 30, height: 20, offset: false },
  m3rc1l3ss_l4byr1nth: { width: 40, height: 26, offset: false },
  ub3r_l4byr1nth: { width: 60, height: 40, offset: true },
  et3rn4l_l4byr1nth: { width: 60, height: 40, offset: true },
  end13ss_l4byr1nth: { width: 60, height: 40, offset: true },
  f1n4l_l4byr1nth: { width: 60, height: 40, offset: true },
  b0nus_l4byr1nth: { width: 60, height: 40, offset: true },
}

const odd = (n: number): number => (n % 2 === 0 ? n + 1 : n)

export function buildGeometry(width: number, height: number, offset: boolean): LabGeometry {
  const halfWidth = Math.ceil(width / 2)
  const halfHeight = Math.ceil(height / 2)
  const x0 = odd(halfWidth) - 1
  const y0 = odd(halfHeight) - 1
  const totalWidth = 2 * odd(halfWidth) - 1
  const totalHeight = 2 * odd(halfHeight) - 1
  // floor(random * n / 4) takes the values 0 .. ceil(n / 4) - 1.
  const alongWidth = Array.from({ length: Math.ceil(halfWidth / 4) }, (_, k) => k)
  const alongHeight = Array.from({ length: Math.ceil(halfHeight / 4) }, (_, k) => k)
  const offsets = offset ? [0, 2, 4] : [0]
  const goals: [number, number][] = []
  for (const ox of offsets) for (const oy of offsets) goals.push([totalWidth - 2 - ox, totalHeight - 2 - oy])
  return {
    maxX: totalWidth - 2,
    maxY: totalHeight - 2,
    x0,
    y0,
    topRows: alongWidth.map((k) => k * 2 + 1),
    leftCols: alongHeight.map((k) => k * 2 + 1),
    bottomRows: alongWidth.map((k) => height - (k + 1) * 2 - 1),
    rightCols: alongHeight.map((k) => width - (k + 1) * 2 - 1),
    goals,
  }
}

const cache = new Map<string, LabGeometry>()

/** Geometry of a labyrinth by its host name; null for a name the game did not have when this was written. */
export function geometryForHost(host: string | undefined): LabGeometry | null {
  if (!host) return null
  const size = LAB_SIZES[host]
  if (!size) return null
  let geometry = cache.get(host)
  if (!geometry) {
    geometry = buildGeometry(size.width, size.height, size.offset)
    cache.set(host, geometry)
  }
  return geometry
}
