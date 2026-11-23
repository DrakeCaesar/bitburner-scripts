import { invertLeftTail, invertLeftTailOverlap } from "./tailInversion.js"

/**
 * Left-tail hunt: get ONE reading in the far left tail of the hill cluster and solve it for the
 * password (tailInversion.ts). Everything here is about where to probe to land such a reading.
 *
 * What makes it possible:
 *  - The game computes the altitude for any number, not only for guesses of the password's length,
 *    so the left tail can always be reached — below the numeric range and below zero if need be.
 *  - A Gaussian of width w underflows to exactly 0 about 27.3 widths out and is a normal double up
 *    to ~26.6 widths. So a reading is either 0 (no hill within ~27 w) or carries the distance to
 *    the nearest edge hill in its exponent: zero / non-zero alone brackets the cluster.
 *
 * The hunt tracks the set S of positions the leftmost hill (c0) can still have and places the
 * 21 w wide "clean" window (c0 between 5.5 w and 26.4 w right of the probe) over as much of S as
 * it can. Every outcome shrinks S:
 *
 *   zero                -> no hill within 27.2 w of the probe
 *   tail, inverted      -> solved: the next guess is the password
 *   tail, not inverted  -> it was the RIGHT tail (hill 8 is a hash of the password, not invertible),
 *                          which pins c0 to a ~5 w zone further left — or the left hill is one the
 *                          light pass skips; that one is retried with the heavy pass once the
 *                          right-tail reading of it has been ruled out
 *   anything larger     -> the probe is inside the cluster: c0 is within 5.5 w right of it at most
 */

type Interval = [number, number]

/** c0 distances (in widths) at which a left-tail reading is single-hill clean and a normal double. */
const CLEAN_NEAR_W = 5.5
const CLEAN_FAR_W = 26.4
/** Zero reading: every hill is further than this. */
const ZERO_REACH_W = 27.2
/** Non-zero reading: some hill is closer than this. */
const NONZERO_REACH_W = 27.5
/** Below this a reading can only come from a tail, at least ~4.5 w outside the edge hill. */
const TAIL_MAX_ABS = 1e-9
/** Edge-hill |height| range used to turn a tail reading into a distance bracket. */
const EDGE_HEIGHT_MIN = 1
const EDGE_HEIGHT_MAX = 10000
/**
 * Below this the exponential was a subnormal when the game multiplied it: the reading still says
 * "a hill ~27 w away" but has too few bits left to invert.
 */
const PRECISE_MIN_ABS = 1e-290
const MAX_PROBES = 10
/** The straddling rank's heights below the heavy pass's floor (one layout in ~7000), down to 1e-6. */
const SLIVER_MIN = 1e-6
/** A tail that no pass can read is probed again this much deeper, once. */
const DEEPER_STEP_W = 10
const MAX_DEEPER_RETRIES = 1

/** Inversion results by (pass, reading): a password, or null when the pass found none. */
const inversionMemo = new Map<string, number | null>()
const MEMO_LIMIT = 64

export interface HuntSession {
  readonly solved: boolean
  /** Probe any integer (no range clamp); returns null when the session cannot probe any more. */
  scout(x: number): number | null
  /** True when `p` reproduces every reading taken so far and has not been guessed. */
  accepts(p: number, lead: readonly [number, number]): boolean
}

export interface HuntTuning {
  /** Where the first clean window starts inside the initial c0 range, as a fraction of its slack. */
  firstWindowFraction: number
  /** On a coverage tie, take the leftmost (true) or rightmost (false) placement. */
  preferLeft: boolean
}

/** Swept at 10 000 assignments on two seeds: 0.75 / rightmost gave 2.93 guesses, 0.5 / leftmost 3.07. */
export const DEFAULT_HUNT_TUNING: HuntTuning = { firstWindowFraction: 0.75, preferLeft: false }

function intersect(set: Interval[], lo: number, hi: number): Interval[] {
  const out: Interval[] = []
  for (const [a, b] of set) {
    const l = Math.max(a, lo)
    const h = Math.min(b, hi)
    if (h >= l) out.push([l, h])
  }
  return out
}

function subtract(set: Interval[], lo: number, hi: number): Interval[] {
  const out: Interval[] = []
  for (const [a, b] of set) {
    if (b < lo || a > hi) {
      out.push([a, b])
      continue
    }
    if (a < lo) out.push([a, lo])
    if (b > hi) out.push([hi, b])
  }
  return out
}

function measure(set: Interval[], lo: number, hi: number): number {
  let total = 0
  for (const [a, b] of set) total += Math.max(0, Math.min(b, hi) - Math.max(a, lo))
  return total
}

/** Probe position whose clean window covers the most of `set`. */
function placeWindow(set: Interval[], w: number, tuning: HuntTuning, first: boolean): number {
  const span = (CLEAN_FAR_W - CLEAN_NEAR_W) * w
  const sMin = set[0]![0]
  const sMax = set[set.length - 1]![1]
  if (sMax - sMin <= span) {
    return Math.round((sMin + sMax) / 2 - ((CLEAN_NEAR_W + CLEAN_FAR_W) / 2) * w)
  }
  if (first) {
    const start = sMin + tuning.firstWindowFraction * (sMax - sMin - span)
    return Math.round(start - CLEAN_NEAR_W * w)
  }
  let bestStart = sMin
  let bestCover = -1
  const consider = (start: number): void => {
    const cover = measure(set, start, start + span)
    if (cover > bestCover + 1e-9 * w) {
      bestCover = cover
      bestStart = start
    }
  }
  const ordered = tuning.preferLeft ? set : [...set].reverse()
  for (const [a, b] of ordered) {
    if (tuning.preferLeft) {
      consider(a)
      consider(b - span)
    } else {
      consider(b - span)
      consider(a)
    }
  }
  return Math.round(bestStart - CLEAN_NEAR_W * w)
}

/** Returns true when the password was found. On false the caller falls back to the ladder. */
export function huntLeftTail(
  sess: HuntSession,
  lo: number,
  hi: number,
  w: number,
  hills: number,
  tuning: HuntTuning = DEFAULT_HUNT_TUNING
): boolean {
  const widthMin = 2.7 * (hills - 1) * w
  const widthMax = 3.3 * (hills - 1) * w
  let feasible: Interval[] = [[lo - 3.3 * (hills - 2) * w, hi - 2.7 * w]]
  /** A tail reading the light pass could not invert, and the c0 zone it implies if it is a left tail. */
  let pending: { x: number; a: number; zone: Interval } | null = null
  let deeperRetries = 0

  const solveWith = (x: number, a: number, pass: "light" | "heavy" | "sliver" | "overlap"): boolean => {
    const lead: [number, number] = [x, a]
    const accept = (c: number): boolean => sess.accepts(c, lead)
    const key = `${pass}:${x}:${a}:${w}:${hills}:${lo}`
    for (;;) {
      // In the game the solver is replayed from its stored samples for every guess, so the same
      // inversion comes back once per later guess: remember what it found.
      const remembered = inversionMemo.get(key)
      let p: number | null
      if (remembered === null) p = null
      else if (remembered !== undefined && accept(remembered)) p = remembered
      else {
        p =
          pass === "overlap"
            ? invertLeftTailOverlap(x, a, w, hills, lo, hi, accept)
            : pass === "sliver"
              ? invertLeftTail(x, a, w, hills, lo, hi, accept, { pass: "heavy", minHeight: SLIVER_MIN, maxHeight: 0.5 })
              : invertLeftTail(x, a, w, hills, lo, hi, accept, { pass })
        if (inversionMemo.size >= MEMO_LIMIT) inversionMemo.clear()
        inversionMemo.set(key, p)
      }
      if (p === null) return false
      sess.scout(p)
      if (sess.solved) return true
    }
  }
  /** Everything the light pass leaves out, cheapest first. */
  const solveHard = (x: number, a: number): boolean =>
    solveWith(x, a, "heavy") || solveWith(x, a, "overlap") || solveWith(x, a, "sliver")

  for (let step = 0; step < MAX_PROBES; step++) {
    if (feasible.length === 0) return false
    if (pending !== null) {
      const elsewhere = subtract(feasible, pending.zone[0], pending.zone[1])
      if (elsewhere.length === 0) {
        // The right-tail reading of it is ruled out: it is a left tail the light pass skipped.
        if (solveHard(pending.x, pending.a)) return true
        if (sess.solved || deeperRetries >= MAX_DEEPER_RETRIES) return false
        // Not readable from here: most likely the next hill still leaks into the reading (it fades
        // as exp(-2 D gap / w^2)), so read the same tail again further out.
        deeperRetries++
        const centre = (pending.zone[0] + pending.zone[1]) / 2
        const depth = Math.min((centre - pending.x) / w + DEEPER_STEP_W, CLEAN_FAR_W - 1)
        const x2 = Math.round(centre - depth * w)
        pending = null
        const a2 = sess.scout(x2)
        if (sess.solved) return true
        if (a2 === null || a2 === 0 || !Number.isFinite(a2) || Math.abs(a2) < PRECISE_MIN_ABS) return false
        if (solveWith(x2, a2, "light") || solveHard(x2, a2)) return true
        return false
      }
    }
    const target = pending !== null ? subtract(feasible, pending.zone[0], pending.zone[1]) : feasible
    const x = placeWindow(target, w, tuning, step === 0)
    const a = sess.scout(x)
    if (sess.solved) return true
    if (a === null || !Number.isFinite(a)) return false

    if (a === 0) {
      feasible = subtract(feasible, x - ZERO_REACH_W * w - widthMin, x + ZERO_REACH_W * w)
      continue
    }
    feasible = intersect(feasible, x - NONZERO_REACH_W * w - widthMax, x + NONZERO_REACH_W * w)
    const mag = Math.abs(a)
    if (mag < 1 && mag >= PRECISE_MIN_ABS && solveWith(x, a, "light")) return true
    if (sess.solved) return true

    if (mag < TAIL_MAX_ABS) {
      // Logs taken separately: 1 / mag overflows for a subnormal reading.
      const dLo = w * Math.sqrt(Math.log(EDGE_HEIGHT_MIN) - Math.log(mag))
      const dHi = w * Math.sqrt(Math.log(EDGE_HEIGHT_MAX) - Math.log(mag))
      const asRight = intersect(feasible, x - dHi - widthMax, x - dLo - widthMin)
      const zone: Interval = [x + dLo - 0.2 * w, x + dHi + 0.2 * w]
      const asLeft = intersect(feasible, zone[0], zone[1])
      feasible = [...asRight, ...asLeft]
      pending = asLeft.length > 0 && mag >= PRECISE_MIN_ABS ? { x, a, zone } : null
    } else {
      feasible = intersect(feasible, x - CLEAN_NEAR_W * w - widthMax, x + CLEAN_NEAR_W * w)
      pending = null
    }
  }
  return false
}
