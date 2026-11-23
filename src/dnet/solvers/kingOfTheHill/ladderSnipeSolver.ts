import type { LadderSnipeTuning } from "./tuning.js"
import { HILL_NEAR_ZONE_FRACTION, reproducesReadings } from "./hillModel.js"

export const KOTH_NEAR_ZONE_FRACTION = HILL_NEAR_ZONE_FRACTION

const H_PEAK = 10000
const STEP_W = 3
const MAIN_TH = H_PEAK - 0.5 * 2600
const HEIGHT_OFFSET = 2600

export interface LadderProbeSession {
  solved: boolean
  bestVal: number
  bestAlt: number
  samples: Map<number, number>
  probe(x: number): number | null
  restoreBest(x: number, a: number): void
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(x)))
}

function inPureZone(x: number, p: number): boolean {
  return Math.abs((x - p) / p) < KOTH_NEAR_ZONE_FRACTION
}

/**
 * Near-peak check, wrapped around the session the ladder runs on.
 *
 * Within 3% of the password the game returns the main hill alone, so a reading (x, a) taken there
 * puts the password at x + d or x - d with d = w * sqrt(ln(10000 / a)), whatever the altitude is.
 * Both candidates reproduce that reading by construction, so the choice between them comes from
 * the other readings: the hill ensemble is a deterministic function of the password (hillModel),
 * and a candidate that does not reproduce *every* reading already taken is not the password.
 * That saves the wrong-side guess; when neither candidate survives, both are tried as before.
 *
 * The ladder's own trajectory is unchanged: candidate guesses are kept out of the samples it sees
 * and do not move its best point. `samples` holds only what the ladder asked for in this run,
 * which also keeps a replayed run from seeing readings it had not taken yet.
 */
function withNearPeakCheck(
  inner: LadderProbeSession,
  w: number,
  lo: number,
  hi: number,
  passwordLength: number,
  hills: number
): LadderProbeSession {
  const visited = new Map<number, number>()
  const extra = new Map<number, number>()

  const confirms = (p: number, readings: (readonly [number, number])[]): boolean =>
    reproducesReadings(p, passwordLength, hills, readings)

  /** Every reading taken so far, strongest first: a wrong candidate contradicts the first one. */
  const evidence = (): (readonly [number, number])[] => {
    const readings: (readonly [number, number])[] = []
    for (const map of [visited, extra]) {
      for (const entry of map) readings.push(entry)
    }
    readings.sort((l, r) => Math.abs(r[1]) - Math.abs(l[1]))
    return readings
  }

  const tryCandidates = (x: number, a: number): void => {
    if (!(a > 0 && a <= H_PEAK)) return
    const d = Math.round(w * Math.sqrt(Math.log(H_PEAK / a)))
    const inRange: number[] = []
    for (const p of [x + d, x - d]) {
      if (p < lo || p > hi || visited.has(p) || extra.has(p) || !inPureZone(x, p)) continue
      inRange.push(p)
    }
    if (inRange.length === 0) return
    // Every candidate has to reproduce the readings already taken: the hill ensemble is a
    // deterministic function of the password, and a wrong candidate shifts every hill at once.
    // This also drops candidates that come from a reading outside the true near zone.
    const viable = inRange.filter((p) => confirms(p, evidence()))
    if (viable.length === 0) return
    const bestVal = inner.bestVal
    const bestAlt = inner.bestAlt
    for (const p of viable) {
      const ap = inner.probe(p)
      if (inner.solved) return
      if (ap === null) continue
      extra.set(p, ap)
      inner.restoreBest(bestVal, bestAlt)
    }
  }

  return {
    get solved() {
      return inner.solved
    },
    get bestVal() {
      return inner.bestVal
    },
    get bestAlt() {
      return inner.bestAlt
    },
    samples: visited,
    restoreBest(x: number, a: number) {
      inner.restoreBest(x, a)
    },
    probe(x: number): number | null {
      const xi = Math.round(x)
      if (visited.has(xi)) return inner.probe(xi)
      const a = inner.probe(xi)
      if (a === null || inner.solved) return a
      if (extra.delete(xi) && a > inner.bestAlt) inner.restoreBest(xi, a)
      visited.set(xi, a)
      tryCandidates(xi, a)
      return a
    },
  }
}

function invertCenter(x1: number, a1: number, x2: number, a2: number, w: number): number {
  return (x1 + x2) / 2 - (w * w * Math.log(a1 / a2)) / (2 * (x2 - x1))
}

function hopK(H: number): number {
  return Math.max(1, Math.round((H_PEAK - H) / HEIGHT_OFFSET))
}

function spreadOrder(m: number): number[] {
  if (m <= 1) return [0]
  const order: number[] = []
  const seen = new Set<number>()
  const add = (i: number) => {
    if (i >= 0 && i < m && !seen.has(i)) {
      seen.add(i)
      order.push(i)
    }
  }
  add(Math.floor(m / 2))
  add(0)
  add(m - 1)
  let stack: [number, number][] = [[0, m - 1]]
  while (order.length < m && stack.length > 0) {
    const nxt: [number, number][] = []
    for (const [a, b] of stack) {
      const mid = Math.floor((a + b) / 2)
      add(mid)
      if (mid - a > 1) nxt.push([a, mid])
      if (b - mid > 1) nxt.push([mid, b])
    }
    stack = nxt
  }
  for (let i = 0; i < m; i++) add(i)
  return order
}

function scanGrid(lo: number, hi: number, w: number, hc: number, tune: LadderSnipeTuning): number[] {
  const span = hi - lo
  if (span <= 0) return [lo]
  const base = hc > 1 ? (hc - 1) * 3 * w * 0.9 * 0.98 : 3 * w
  const spacing = Math.max(1, Math.floor(base * tune.scanPitchScale))
  const m = Math.max(1, Math.ceil(span / spacing))
  const xs = new Set<number>()
  for (let i = 0; i <= m; i++) xs.add(lo + Math.round((span * i) / m))
  return [...xs].sort((a, b) => a - b)
}

function sqrtSnipe(
  sess: LadderProbeSession,
  x: number,
  a: number,
  w: number,
  lo: number,
  hi: number,
  tune: LadderSnipeTuning
): boolean {
  if (!(a > tune.sqrtSnipeMinAlt) || !(a < H_PEAK)) return false
  const d = w * Math.sqrt(Math.log(H_PEAK / a))
  if (!Number.isFinite(d)) return false
  const nearCap = (KOTH_NEAR_ZONE_FRACTION + tune.sqrtSnipeNearZoneExtra) * x
  if (d > nearCap) return false
  const dd = Math.max(1, Math.round(d))
  sess.probe(clamp(x + dd, lo, hi))
  if (sess.solved) return true
  sess.probe(clamp(x - dd, lo, hi))
  return sess.solved
}

function crest(
  sess: LadderProbeSession,
  xSeed: number,
  w: number,
  lo: number,
  hi: number,
  tune: LadderSnipeTuning
): [number, number] {
  const x = clamp(xSeed, lo, hi)
  let a = sess.samples.get(x) ?? null
  if (a === null) {
    a = sess.probe(x)
    if (sess.solved) return [x, a ?? Infinity]
  }
  const off = Math.max(1, Math.round(tune.crestPairOffsetW * w))
  const xb = x + off <= hi ? x + off : x - off
  const ab = sess.probe(xb)
  if (sess.solved) return [xb, ab ?? Infinity]
  if (a !== null && ab !== null && a > 0 && ab > 0 && xb !== x) {
    const c = invertCenter(x, a, xb, ab, w)
    const cx = clamp(c, lo, hi)
    let ac = sess.samples.get(cx) ?? null
    if (ac === null) {
      ac = sess.probe(cx)
      if (sess.solved) return [cx, ac ?? Infinity]
    }
    const cand: [number, number][] = [
      [a, x],
      [ab, xb],
      [ac ?? -1e18, cx],
    ]
    let best = cand[0]!
    for (const pair of cand.slice(1)) {
      if (pair[0] > best[0]) best = pair
    }
    if (best[1] !== x && best[0] > a * tune.crestRerunMargin) {
      const bx = best[1]
      const rerunOff = Math.max(1, Math.floor(off * tune.crestRerunScale))
      let xb2 = bx + rerunOff
      if (xb2 > hi) xb2 = bx - rerunOff
      const ab2 = sess.probe(xb2)
      if (sess.solved) return [xb2, ab2 ?? Infinity]
      if (ab2 !== null && ab2 > 0 && xb2 !== bx && best[0] > 0) {
        const c2 = invertCenter(bx, best[0], xb2, ab2, w)
        const cx2 = clamp(c2, lo, hi)
        let ac2 = sess.samples.get(cx2) ?? null
        if (ac2 === null) {
          ac2 = sess.probe(cx2)
          if (sess.solved) return [cx2, ac2 ?? Infinity]
        }
        const cand2: [number, number][] = [best, [ab2, xb2], [ac2 ?? -1e18, cx2]]
        let best2 = cand2[0]!
        for (const pair of cand2.slice(1)) {
          if (pair[0] > best2[0]) best2 = pair
        }
        return [best2[1], best2[0]]
      }
    }
    return [best[1], best[0]]
  }
  const xc = clamp(x - off >= lo ? x - off : x + 2 * off, lo, hi)
  const ac = sess.probe(xc)
  if (sess.solved) return [xc, ac ?? Infinity]
  const cand: [number, number][] = [
    [a ?? -1e18, x],
    [ab ?? -1e18, xb],
    [ac ?? -1e18, xc],
  ]
  let best = cand[0]!
  for (const pair of cand.slice(1)) {
    if (pair[0] > best[0]) best = pair
  }
  return [best[1], best[0]]
}

function gallop(
  sess: LadderProbeSession,
  xSeed: number,
  w: number,
  lo: number,
  hi: number,
  tune: LadderSnipeTuning
): [number, number] {
  let x = clamp(xSeed, lo, hi)
  let a: number = sess.samples.get(x) ?? -1e18
  if (!sess.samples.has(x)) {
    const probed = sess.probe(x)
    if (sess.solved) return [x, probed ?? Infinity]
    if (probed !== null) a = probed
  }
  let step = Math.max(1, Math.round(tune.gallopStepW * w))
  const stop = Math.max(1, Math.round(tune.gallopStopW * w))
  while (step >= stop) {
    let bd = 0
    let ba = a
    let bx = x
    for (const d of [1, -1]) {
      const xn = clamp(x + d * step, lo, hi)
      if (xn === x) continue
      const an = sess.probe(xn)
      if (sess.solved) return [xn, an ?? Infinity]
      if (an !== null && an > ba) {
        ba = an
        bx = xn
        bd = d
      }
    }
    if (bd !== 0) {
      x = bx
      a = ba
    } else {
      step = Math.floor(step / 2)
    }
  }
  return [x, a]
}

function pinpoint(
  sess: LadderProbeSession,
  seedX: number,
  w: number,
  lo: number,
  hi: number,
  tune: LadderSnipeTuning,
  rounds: number,
  finalRadius: number,
  snipe: boolean
): void {
  let pc = clamp(seedX, lo, hi)
  if (snipe) {
    let aSeed = sess.samples.get(pc) ?? null
    if (aSeed === null) {
      aSeed = sess.probe(pc)
      if (sess.solved) return
    }
    if (aSeed !== null && sqrtSnipe(sess, pc, aSeed, w, lo, hi, tune)) return
  }
  let off = Math.max(1, Math.round(tune.pairProbeOffsetW * w))
  for (let r = 0; r < rounds; r++) {
    let a0 = sess.samples.get(pc) ?? null
    if (a0 === null) {
      a0 = sess.probe(pc)
      if (sess.solved) return
    }
    if (a0 === null || a0 <= 0) break
    const x1 = pc + off <= hi ? pc + off : pc - off
    const a1 = sess.probe(x1)
    if (sess.solved) return
    if (a1 === null || a1 <= 0 || x1 === pc) break
    try {
      const c = invertCenter(pc, a0, x1, a1, w)
      const nc = clamp(c, lo, hi)
      if (nc === pc) {
        if (off === 1) break
        off = Math.max(1, Math.floor(off / tune.pinpointOffsetShrink))
        continue
      }
      pc = nc
      off = Math.max(1, Math.min(off, Math.round(tune.pinpointPairOffsetCapW * w)))
    } catch {
      break
    }
  }
  const aFinal = sess.samples.get(pc) ?? sess.probe(pc)
  if (sess.solved) return
  // Integer scanning only pays off on the peak itself: from a side hill the password is millions
  // of integers away, and repeating the neighbourhood just burns guesses.
  if (aFinal === null || aFinal < MAIN_TH) return
  for (let d = 1; d <= finalRadius; d++) {
    for (const sgn of [-1, 1]) {
      sess.probe(pc + sgn * d)
      if (sess.solved) return
    }
  }
}

function clusterSweep(sess: LadderProbeSession, w: number, lo: number, hi: number, tune: LadderSnipeTuning): void {
  const center = sess.bestVal
  const reach = Math.round(tune.clusterReachW * w)
  const step = Math.max(1, Math.round(tune.clusterStepW * w))
  let x = Math.max(lo, center - reach)
  const b = Math.min(hi, center + reach)
  while (x <= b && !sess.solved) {
    sess.probe(x)
    x += step
  }
}

function backstop(sess: LadderProbeSession, w: number, lo: number, hi: number, tune: LadderSnipeTuning): void {
  const step = Math.max(1, Math.round(tune.backstopStepW * w))
  let x = lo
  while (x <= hi && !sess.solved) {
    sess.probe(x)
    x += step
  }
  if (!sess.solved) pinpoint(sess, sess.bestVal, w, lo, hi, tune, tune.pinpointRounds, tune.backstopFinalRadius, false)
}

function walkAndPinpoint(
  sess: LadderProbeSession,
  w: number,
  lo: number,
  hi: number,
  tune: LadderSnipeTuning,
  snipe: boolean
): boolean {
  const step = STEP_W * w
  let [x, a] = crest(sess, sess.bestVal, w, lo, hi, tune)
  if (sess.solved) return true
  let lastDir: number | null = x <= lo ? 1 : x >= hi ? -1 : null
  for (let hop = 0; hop < tune.walkMaxHops; hop++) {
    if (a >= MAIN_TH) break
    const k = hopK(a)
    let order: number[]
    if (lastDir === null) {
      const xR = clamp(x + k * step, lo, hi)
      const xL = clamp(x - k * step, lo, hi)
      const aR = sess.probe(xR)
      if (sess.solved) return true
      const aL = sess.probe(xL)
      if (sess.solved) return true
      order = (aR ?? -1e18) >= (aL ?? -1e18) ? [1, -1] : [-1, 1]
    } else {
      order = [lastDir, -lastDir]
    }
    let best: [number, number, number] | null = null
    for (const d of order) {
      const ks = lastDir === null ? [k] : [k, k - 1, k + 1, 1]
      for (const kk of ks) {
        if (kk < 1) continue
        const [nx, na] = crest(sess, x + d * kk * step, w, lo, hi, tune)
        if (sess.solved) return true
        if (na > a + tune.walkImproveEps) {
          best = [na, nx, d]
          break
        }
      }
      if (best !== null) break
    }
    if (best === null) break
    a = best[0]
    x = best[1]
    lastDir = best[2]
  }
  pinpoint(sess, sess.bestVal, w, lo, hi, tune, tune.pinpointRounds, tune.pinpointFinalRadius, snipe)
  return a >= MAIN_TH
}

function isFarTailAnchor(a: number, tune: LadderSnipeTuning): boolean {
  if (a === 0) return false
  return Math.abs(a) < tune.farTailAnchorMaxAbs
}

interface LadderCoarseHit {
  x: number
  a: number
}

function ladderCoarseScan(
  sess: LadderProbeSession,
  lo: number,
  hi: number,
  w: number,
  hc: number,
  tune: LadderSnipeTuning
): LadderCoarseHit | null {
  const xs = scanGrid(lo, hi, w, hc, tune)
  const order = spreadOrder(xs.length)
  for (const idx of order) {
    const x = xs[idx]!
    const a = sess.probe(x)
    if (sess.solved) return null
    if (a === null || a === 0) continue
    if (isFarTailAnchor(a, tune)) return { x, a }
    if (a > 0) return { x, a }
  }
  return null
}

function runInitialCoarseScanPositive(
  sess: LadderProbeSession,
  lo: number,
  hi: number,
  w: number,
  hc: number,
  tune: LadderSnipeTuning
): void {
  const xs = scanGrid(lo, hi, w, hc, tune)
  const order = spreadOrder(xs.length)
  for (const idx of order) {
    const a = sess.probe(xs[idx]!)
    if (sess.solved) return
    if (a !== null && a > 0) break
  }
}

/** Height of the hill that a pair of same-sign readings was inverted against. */
function pairHeight(x: number, a: number, center: number, w: number): number {
  const dx = x - center
  return Math.abs(a) * Math.exp((dx * dx) / (w * w))
}

/**
 * True when `h` is a height the generator can produce: hills sit on 10000 - k * 2600 * v with
 * v in [0.95, 1.05], k rungs from the peak, so a height off the ladder means the pair was not a
 * clean read of one hill.
 */
function onHeightLadder(h: number, hc: number, slack: number): boolean {
  if (!Number.isFinite(h) || h > H_PEAK) return false
  const k = Math.round((H_PEAK - h) / HEIGHT_OFFSET)
  if (k < 1 || k > hc - 1) return false
  const ladderLo = H_PEAK - k * HEIGHT_OFFSET * 1.05
  const ladderHi = H_PEAK - k * HEIGHT_OFFSET * 0.95
  return h >= ladderLo - slack && h <= ladderHi + slack
}

function ladderClimb(
  sess: LadderProbeSession,
  x0: number,
  a0: number,
  w: number,
  hc: number,
  lo: number,
  hi: number,
  tune: LadderSnipeTuning,
  snipe: boolean
): void {
  const wd = w
  let prevK = 1 << 20
  let postJumpCapK = 1 << 20
  const seenCenters: number[] = []
  for (let iter = 0; iter < tune.ladderMaxIters && !sess.solved; iter++) {
    if (a0 === 0 || !Number.isFinite(a0)) return
    const off = Math.max(1, Math.round(tune.pairProbeOffsetW * wd))
    let x1 = x0 + off <= hi ? x0 + off : x0 - off
    if (x1 === x0) return
    let a1Opt = sess.probe(x1)
    if (sess.solved) return
    if (a1Opt !== null && a1Opt !== 0 && a0 > 0 !== a1Opt > 0) {
      const a1Positive = a1Opt > 0
      const dirIn = a1Positive === x1 > x0 ? 1 : -1
      const base = a1Positive ? x1 : x0
      const xn = clamp(base + dirIn * Math.max(1, Math.round(tune.signCrossMarchW * wd)), lo, hi)
      const anOpt = sess.probe(xn)
      if (sess.solved) return
      if (anOpt === null || anOpt === 0) return
      x0 = xn
      a0 = anOpt
      continue
    }
    if (a1Opt === null || a1Opt === 0) {
      const x1b = x0 - (x1 - x0)
      if (x1b < lo || x1b > hi || x1b === x0) return
      x1 = x1b
      a1Opt = sess.probe(x1)
      if (sess.solved) return
      if (a1Opt === null || a1Opt === 0) return
      if (a0 > 0 !== a1Opt > 0) return
    }
    const a1 = a1Opt
    const c = invertCenter(x0, a0, x1, a1, w)
    if (!Number.isFinite(c) || Math.abs(c - x0) > tune.centerSanityMaxDistW * wd) return
    const ci = clamp(c, lo, hi)
    for (const seen of seenCenters) {
      if (Math.abs(ci - seen) < Math.round(tune.orbitDistW * wd)) return
    }
    seenCenters.push(ci)
    // The pair already fixes the hill: inverting the two readings gives its centre, and the same
    // two readings give its height (h = a * exp(dx^2 / w^2)), so the centre only needs a probe when
    // the derived height is not on the generator's height ladder — i.e. when the pair was not a
    // clean single-hill read.
    let ac: number
    const derived = pairHeight(x0, a0, ci, w)
    if (
      Math.abs(a0) >= tune.pairMinReading &&
      Math.abs(ci - x0) <= tune.pairMaxDistW * wd &&
      onHeightLadder(derived, hc, tune.heightBandSlack)
    ) {
      ac = derived
    } else {
      const acOpt = sess.probe(ci)
      if (sess.solved) return
      if (acOpt === null) return
      ac = acOpt
    }
    if (ac > tune.ladderEntryMaxAbs && sess.samples.has(ci) && sqrtSnipe(sess, ci, ac, w, lo, hi, tune)) return
    if (ac >= MAIN_TH) {
      if (!sess.samples.has(ci)) {
        const acOpt = sess.probe(ci)
        if (sess.solved) return
        if (acOpt === null) return
      }
      pinpoint(sess, sess.bestVal, w, lo, hi, tune, tune.pinpointRounds, tune.pinpointFinalRadius, snipe)
      return
    }
    const dxa = x0 - ci
    let trusted = ac !== 0 && a0 > 0 === ac > 0 && c >= lo && c <= hi
    let k = Math.round((H_PEAK - ac) / HEIGHT_OFFSET)
    if (k < 1) k = 1
    if (k > hc - 1) k = hc - 1
    if (trusted) {
      const kd = k
      const bandHi = H_PEAK - kd * HEIGHT_OFFSET * 0.95 + tune.heightBandSlack
      const bandLo = H_PEAK - kd * HEIGHT_OFFSET * 1.05 - tune.heightBandSlack
      if (ac < bandLo || ac > bandHi) trusted = false
    }
    if (trusted && k > postJumpCapK) trusted = false
    if (trusted && Math.abs(dxa) <= tune.logResidualMaxDistW * wd) {
      const logResidual = Math.log(Math.abs(a0)) - (Math.log(Math.abs(ac)) - (dxa * dxa) / (wd * wd))
      if (Math.abs(logResidual) > tune.logResidualMax) trusted = false
    }
    if (!trusted && ac > 0) {
      const half = Math.max(1, Math.round(tune.halfStepW * wd))
      const gradDir = a1 > a0 === x1 > x0 ? 1 : -1
      let stepped = false
      for (const sgn of [gradDir, -gradDir]) {
        const xs = clamp(ci + sgn * half, lo, hi)
        const asOpt = sess.probe(xs)
        if (sess.solved) return
        if (asOpt !== null && asOpt > ac) {
          x0 = xs
          a0 = asOpt
          stepped = true
          break
        }
      }
      if (stepped) continue
      return
    }
    if (trusted) {
      if (k >= prevK) return
      prevK = k
    }
    const step3 = 3 * w
    const rankOf = (a: number): number => Math.round((H_PEAK - a) / HEIGHT_OFFSET)
    const looksLikeHill = (a: number): boolean => a > 0 && a >= tune.bareTailFrac * (Math.abs(ac) + HEIGHT_OFFSET)
    // Direction. Approaching from outside the cluster (the inversion landed far from its anchor) the
    // main hill lies inward; otherwise at rank 1 the neighbour test is the jump target itself, so it
    // costs nothing. Every jump is verified by the rank its landing reads — a hop that does not move
    // closer to the peak went the wrong way and is flipped below — so the guess only has to be free.
    let dir: number | null = null
    if (Math.abs(ci - x0) > tune.outsideClusterDistW * wd) {
      dir = ci >= x0 ? 1 : -1
    } else if (k === 1 && ci + step3 <= hi && ci - step3 >= lo) {
      const arOpt = sess.probe(ci + step3)
      if (sess.solved) return
      if (arOpt !== null) dir = looksLikeHill(arOpt) && arOpt > ac ? 1 : -1
    }
    if (dir === null) dir = ci + step3 > hi ? -1 : 1

    let target = clamp(ci + dir * k * 3 * wd, lo, hi)
    let atOpt = sess.probe(target)
    if (sess.solved) return
    if (atOpt === null) return
    if (!looksLikeHill(atOpt) || rankOf(atOpt) >= k) {
      const target2 = clamp(ci - dir * k * 3 * wd, lo, hi)
      if (target2 !== target) {
        const at2Opt = sess.probe(target2)
        if (sess.solved) return
        if (at2Opt !== null) {
          const better =
            looksLikeHill(at2Opt) !== looksLikeHill(atOpt)
              ? looksLikeHill(at2Opt)
              : rankOf(at2Opt) !== rankOf(atOpt)
                ? rankOf(at2Opt) < rankOf(atOpt)
                : at2Opt > atOpt
          if (better) {
            target = target2
            atOpt = at2Opt
          }
        }
      }
      if (atOpt === 0) return
    }
    postJumpCapK = Math.max(1, Math.round(tune.postJumpCapScale * k + tune.postJumpCapBias))
    x0 = target
    a0 = atOpt
  }
}

function runPostCoarsePipeline(
  sess: LadderProbeSession,
  lo: number,
  hi: number,
  w: number,
  hc: number,
  tune: LadderSnipeTuning,
  snipe: boolean
): void {
  walkAndPinpoint(sess, w, lo, hi, tune, snipe)
  if (sess.solved) return
  const xs = scanGrid(lo, hi, w, hc, tune)
  for (const x of xs) {
    sess.probe(x)
    if (sess.solved) return
  }
  walkAndPinpoint(sess, w, lo, hi, tune, snipe)
  if (sess.solved) return
  gallop(sess, sess.bestVal, w, lo, hi, tune)
  if (sess.solved) return
  pinpoint(sess, sess.bestVal, w, lo, hi, tune, tune.pinpointRounds, tune.pinpointFinalRadius, snipe)
  if (sess.solved) return
  clusterSweep(sess, w, lo, hi, tune)
  if (sess.solved) return
  pinpoint(sess, sess.bestVal, w, lo, hi, tune, tune.pinpointRounds, tune.pinpointFinalRadiusWide, snipe)
  if (sess.solved) return
  backstop(sess, w, lo, hi, tune)
}

function runSolverCoreBaseline(
  sess: LadderProbeSession,
  lo: number,
  hi: number,
  w: number,
  hc: number,
  tune: LadderSnipeTuning
): void {
  runInitialCoarseScanPositive(sess, lo, hi, w, hc, tune)
  if (sess.solved) return
  runPostCoarsePipeline(sess, lo, hi, w, hc, tune, false)
}

/** ladder_snipe / ladder_snipe_tuned entry (C++ runSolverCoreLadder), plus the near-peak check. */
export function runSolverCoreLadderSnipe(
  session: LadderProbeSession,
  lo: number,
  hi: number,
  w: number,
  hc: number,
  tune: LadderSnipeTuning,
  passwordLength: number
): void {
  const sess = withNearPeakCheck(session, w, lo, hi, passwordLength, hc)
  if (hc < 5) {
    runSolverCoreBaseline(sess, lo, hi, w, hc, tune)
    return
  }
  const hit = ladderCoarseScan(sess, lo, hi, w, hc, tune)
  if (sess.solved) return
  let havePositiveRestore = false
  let restoreX = lo
  let restoreA = -1e18
  if (hit) {
    if (hit.a > 0) {
      restoreX = hit.x
      restoreA = hit.a
      havePositiveRestore = true
    }
    const span = hi - lo
    const skipPositiveLadder =
      hit.a > 0 &&
      tune.positiveLadderSkipRangeFraction > 0 &&
      hit.x > lo + Math.floor(tune.positiveLadderSkipRangeFraction * span)
    if (Math.abs(hit.a) < tune.ladderEntryMaxAbs && !skipPositiveLadder) {
      ladderClimb(sess, hit.x, hit.a, w, hc, lo, hi, tune, true)
    } else if (hit.a > 0) {
      sqrtSnipe(sess, hit.x, hit.a, w, lo, hi, tune)
    }
    if (sess.solved) return
  }
  if (!havePositiveRestore) {
    runInitialCoarseScanPositive(sess, lo, hi, w, hc, tune)
    if (sess.solved) return
    if (sess.bestAlt > 0) {
      restoreX = sess.bestVal
      restoreA = sess.bestAlt
      havePositiveRestore = true
    }
  }
  // Start the generic pipeline from the best positive reading the ladder saw, not from the
  // coarse anchor it happened to enter on: the anchor can be a deep tail thousands of widths
  // away from the cluster, and crest() would then invert against it.
  if (havePositiveRestore) {
    for (const [x, a] of sess.samples) {
      if (a > restoreA && a > 0 && Number.isFinite(a)) {
        restoreX = x
        restoreA = a
      }
    }
    sess.restoreBest(restoreX, restoreA)
  }
  runPostCoarsePipeline(sess, lo, hi, w, hc, tune, true)
}
