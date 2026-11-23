/**
 * Exact port of the game's King-of-the-Hill altitude generator
 * (bitburner-src `src/DarkNet/effects/authentication.ts`, `getKingOfTheHillAltitude`).
 *
 * The whole hill ensemble is a deterministic function of the password: the WHRNG is seeded with
 * it, so the password alone fixes the index of the peak hill, every horizontal offset and every
 * height. That makes a *candidate* password checkable against readings the solver has already
 * taken — a wrong candidate shifts the entire ensemble and cannot reproduce them.
 *
 * Used to accept or reject candidates: the two a near-zone reading gives (ladderSnipeSolver.ts)
 * and the shortlist a left-tail reading is inverted to (tailInversion.ts, which works from the
 * closed form of the first RNG draws and leaves the exact check to this module).
 */

export const HILL_PEAK_HEIGHT = 10000
export const HILL_NEAR_ZONE_FRACTION = 0.03

const HILL_SPACING_WIDTHS = 3
const LOCATION_JITTER_SCALE = 0.2
const LOCATION_JITTER_BASE = 0.9
const HEIGHT_OFFSET_BASE = 2600
const HEIGHT_JITTER_SCALE = 0.1
const HEIGHT_JITTER_BASE = 0.95
const GAUSS_WIDTH_LENGTH_OFFSET = 2
const GAUSS_WIDTH_PLUS = 1

/** The game's WHRNG (bitburner-src src/Casino/RNG.ts). */
class WHRNG {
  private s1: number
  private s2: number
  private s3: number

  constructor(seed: number) {
    const v = (seed / 1000) % 30000
    this.s1 = v
    this.s2 = v
    this.s3 = v
  }

  random(): number {
    this.s1 = (171 * this.s1) % 30269
    this.s2 = (172 * this.s2) % 30307
    this.s3 = (170 * this.s3) % 30323
    return (this.s1 / 30269.0 + this.s2 / 30307.0 + this.s3 / 30323.0) % 1.0
  }
}

export interface HillLayout {
  password: number
  width: number
  centers: number[]
  heights: number[]
}

export function hillLayout(password: number, passwordLength: number, hills: number): HillLayout {
  const width = 10 ** Math.max(passwordLength - GAUSS_WIDTH_LENGTH_OFFSET, 0) + GAUSS_WIDTH_PLUS
  const rng = new WHRNG(password)
  const peakHill = Math.floor(rng.random() * (hills - 2)) + 1
  const centers: number[] = []
  const heights: number[] = []
  for (let i = 0; i < hills; i++) {
    const locationOffset =
      (i - peakHill) * width * HILL_SPACING_WIDTHS * (rng.random() * LOCATION_JITTER_SCALE + LOCATION_JITTER_BASE)
    const heightOffset =
      Math.abs((i - peakHill) * HEIGHT_OFFSET_BASE) * (rng.random() * HEIGHT_JITTER_SCALE + HEIGHT_JITTER_BASE)
    centers.push(password + locationOffset)
    heights.push(HILL_PEAK_HEIGHT - heightOffset)
  }
  return { password, width, centers, heights }
}

function hillAt(layout: HillLayout, x: number): number {
  const w2 = layout.width * layout.width
  let altitude = 0
  for (let i = 0; i < layout.centers.length; i++) {
    const dx = x - layout.centers[i]!
    altitude += layout.heights[i]! * Math.exp(((dx * dx) / w2) * -1.0)
  }
  return altitude
}

function peakAt(layout: HillLayout, x: number): number {
  const dx = x - layout.password
  return HILL_PEAK_HEIGHT * Math.exp(((dx * dx) / (layout.width * layout.width)) * -1.0)
}

function inNearZone(layout: HillLayout, x: number): boolean {
  return layout.password !== 0 && Math.abs((x - layout.password) / layout.password) < HILL_NEAR_ZONE_FRACTION
}

/** True when `password` reproduces every reading taken so far. */
export function reproducesReadings(
  password: number,
  passwordLength: number,
  hills: number,
  readings: readonly (readonly [number, number])[]
): boolean {
  const layout = hillLayout(password, passwordLength, hills)
  for (const [x, observed] of readings) {
    const predicted = inNearZone(layout, x) ? peakAt(layout, x) : hillAt(layout, x)
    if (!matches(predicted, observed)) return false
  }
  return true
}

/**
 * A wrong candidate rebuilds the whole ensemble and misses by orders of magnitude. A candidate that
 * is *derived* from a reading agrees with that one reading to about 1e-8 (the distance is rounded to
 * an integer), so the tolerance has to sit well below that — and it can, because re-deriving the
 * true password's ensemble reproduces each reading bit for bit (checked on 275 000 random readings,
 * in and out of the numeric range: zero mismatches at tolerance 0).
 *
 * 1e-14 rather than 1e-12: about once in 12 000 readings the derived distance happens to land
 * within 4e-5 of an integer, and at 1e-12 both near-peak candidates of such a reading "confirm"
 * themselves and cost two guesses. Two decimal digits above bit-exact is still ample slack.
 */
const RELATIVE_TOLERANCE = 1e-14

function matches(predicted: number, observed: number): boolean {
  if (observed === predicted) return true
  const scale = Math.max(Math.abs(predicted), Math.abs(observed))
  return Math.abs(predicted - observed) <= RELATIVE_TOLERANCE * scale
}
