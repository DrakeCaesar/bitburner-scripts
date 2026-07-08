export const KOTH_PEAK_HEIGHT = 10000
export const KOTH_HILL_SPACING_WIDTHS = 3
export const KOTH_HILL_DIFFICULTY_DIVISOR = 8
export const KOTH_HILL_DIFFICULTY_CAP = 4
export const KOTH_HEIGHT_OFFSET_BASE = 2600
export const KOTH_GAUSS_WIDTH_LENGTH_OFFSET = 2
export const KOTH_GAUSS_WIDTH_PLUS = 1
export const SOLVER_MAX_PROBES = 600

const H_PEAK = KOTH_PEAK_HEIGHT
const STEP_W = KOTH_HILL_SPACING_WIDTHS
const MAIN_TH = H_PEAK - 0.5 * KOTH_HEIGHT_OFFSET_BASE
const SCAN_EARLY_THRESH = 400

export const STOP_PROBE = Symbol("koth-stop-probe")

export interface ProbeSession {
  min: number
  max: number
  guesses: number
  solved: boolean
  exhausted: boolean
  bestVal: number
  bestAlt: number
  samples: Map<number, number>
  probe(x: number): number | null
}

export interface SolverContext {
  min: number
  max: number
  hillCount: number
  passwordLength: number
  gaussWidth: number
}

export interface SolverRunResult {
  guesses: number
  solved: boolean
  bestVal: number
  bestAlt: number
  samples?: Map<number, number>
}

export interface SolverCoreOptions {
  returnSamples?: boolean
}

export function parseKingOfTheHillAltitude(feedback: unknown, message?: string): number | null {
  if (typeof feedback === "number" && Number.isFinite(feedback)) return feedback
  if (typeof feedback === "string") {
    const trimmed = feedback.trim()
    if (trimmed.length > 0) {
      const direct = Number(trimmed)
      if (Number.isFinite(direct)) return direct
    }
  }
  if (typeof message === "string") {
    const fromMessage = message.match(/current altitude:\s*([-\d.]+)/i)
    if (fromMessage) {
      const alt = Number(fromMessage[1])
      if (Number.isFinite(alt)) return alt
    }
  }
  return null
}

export function kingOfTheHillHillCount(difficulty: number): number {
  return Math.min(Math.floor(difficulty / KOTH_HILL_DIFFICULTY_DIVISOR), KOTH_HILL_DIFFICULTY_CAP) * 2 + 1
}

export function kingOfTheHillGaussianWidth(passwordLength: number): number {
  return 10 ** Math.max(passwordLength - KOTH_GAUSS_WIDTH_LENGTH_OFFSET, 0) + KOTH_GAUSS_WIDTH_PLUS
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(x)))
}

function invertCenter(x1: number, a1: number, x2: number, a2: number, w: number): number {
  return (x1 + x2) / 2 - ((w * w) * Math.log(a1 / a2)) / (2 * (x2 - x1))
}

function hopK(H: number): number {
  return Math.max(1, Math.round((H_PEAK - H) / KOTH_HEIGHT_OFFSET_BASE))
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

function scanGrid(lo: number, hi: number, w: number, hc: number): number[] {
  const span = hi - lo
  if (span <= 0) return [lo]
  const spacing =
    hc > 1 ? Math.max(1, Math.floor((hc - 1) * 3 * w * 0.9 * 0.98)) : Math.max(1, Math.floor(3 * w))
  const m = Math.max(1, Math.ceil(span / spacing))
  const xs = new Set<number>()
  for (let i = 0; i <= m; i++) {
    xs.add(lo + Math.round((span * i) / m))
  }
  return [...xs].sort((a, b) => a - b)
}

function crest(sess: ProbeSession, xSeed: number, w: number, lo: number, hi: number): [number, number] {
  let x = clamp(xSeed, lo, hi)
  let a = sess.samples.get(x) ?? null
  if (a === null) {
    a = sess.probe(x)
    if (sess.solved) return [x, a ?? Infinity]
  }
  const off = Math.max(1, Math.round(0.5 * w))
  let xb = x + off <= hi ? x + off : x - off
  let ab = sess.probe(xb)
  if (sess.solved) return [xb, ab ?? Infinity]
  if (a !== null && ab !== null && a > 0 && ab > 0 && xb !== x) {
    try {
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
      if (best[1] !== x && best[0] > a * 1.02) {
        const bx = best[1]
        let xb2 = bx + Math.max(1, Math.floor(off / 2))
        if (xb2 > hi) xb2 = bx - Math.max(1, Math.floor(off / 2))
        const ab2 = sess.probe(xb2)
        if (sess.solved) return [xb2, ab2 ?? Infinity]
        if (ab2 !== null && ab2 > 0 && xb2 !== bx && best[0] > 0) {
          try {
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
          } catch {
            // fall through
          }
        }
      }
      return [best[1], best[0]]
    } catch {
      // fall through
    }
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

function gallop(sess: ProbeSession, xSeed: number, w: number, lo: number, hi: number): [number, number] {
  let x = clamp(xSeed, lo, hi)
  let a: number = sess.samples.get(x) ?? -1e18
  if (!sess.samples.has(x)) {
    const probed = sess.probe(x)
    if (sess.solved) return [x, probed ?? Infinity]
    if (probed !== null) a = probed
  }
  let step = Math.max(1, Math.round(1.5 * w))
  const stop = Math.max(1, Math.round(0.1 * w))
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

function pinpoint(sess: ProbeSession, seedX: number, w: number, lo: number, hi: number, rounds = 5, finalRadius = 8): void {
  let pc = clamp(seedX, lo, hi)
  let off = Math.max(1, Math.round(0.25 * w))
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
        off = Math.max(1, Math.floor(off / 4))
        continue
      }
      pc = nc
      off = Math.max(1, Math.min(off, Math.round(0.25 * w)))
    } catch {
      break
    }
  }
  sess.probe(pc)
  if (sess.solved) return
  for (let d = 1; d <= finalRadius; d++) {
    for (const sgn of [-1, 1]) {
      sess.probe(pc + sgn * d)
      if (sess.solved) return
    }
  }
}

function clusterSweep(sess: ProbeSession, w: number, lo: number, hi: number): void {
  const center = sess.bestVal
  const reach = Math.round(28 * w)
  const step = Math.max(1, Math.round(1.2 * w))
  let x = Math.max(lo, center - reach)
  const b = Math.min(hi, center + reach)
  while (x <= b && !sess.solved) {
    sess.probe(x)
    x += step
  }
}

function backstop(sess: ProbeSession, w: number, lo: number, hi: number): void {
  const step = Math.max(1, Math.round(0.7 * w))
  let x = lo
  while (x <= hi && !sess.solved) {
    sess.probe(x)
    x += step
  }
  if (!sess.solved) pinpoint(sess, sess.bestVal, w, lo, hi, 5, 30)
}

function walkAndPinpoint(sess: ProbeSession, w: number, lo: number, hi: number): boolean {
  const step = STEP_W * w
  let [x, a] = crest(sess, sess.bestVal, w, lo, hi)
  if (sess.solved) return true
  let lastDir: number | null = x <= lo ? 1 : x >= hi ? -1 : null
  for (let hop = 0; hop < 10; hop++) {
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
        const [nx, na] = crest(sess, x + d * kk * step, w, lo, hi)
        if (sess.solved) return true
        if (na !== null && na > a + 1) {
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
  const reachedMain = a >= MAIN_TH
  pinpoint(sess, sess.bestVal, w, lo, hi)
  return reachedMain
}

function runSolverCore(sess: ProbeSession, lo: number, hi: number, w: number, hc: number): void {
  const xs = scanGrid(lo, hi, w, hc)
  const order = spreadOrder(xs.length)
  for (const idx of order) {
    const a = sess.probe(xs[idx]!)
    if (sess.solved) return
    if (a !== null && Math.abs(a) > SCAN_EARLY_THRESH) break
  }

  walkAndPinpoint(sess, w, lo, hi)
  if (sess.solved) return

  for (const x of xs) {
    sess.probe(x)
    if (sess.solved) return
  }
  walkAndPinpoint(sess, w, lo, hi)
  if (sess.solved) return

  gallop(sess, sess.bestVal, w, lo, hi)
  if (sess.solved) return
  pinpoint(sess, sess.bestVal, w, lo, hi)
  if (sess.solved) return
  clusterSweep(sess, w, lo, hi)
  if (sess.solved) return
  pinpoint(sess, sess.bestVal, w, lo, hi, 5, 20)
  if (sess.solved) return

  backstop(sess, w, lo, hi)
}

function numericRange(passwordLength: number): { min: number; max: number } {
  let min = 10 ** (passwordLength - 1)
  const max = 10 ** passwordLength - 1
  if (passwordLength === 1) min = 0
  return { min, max }
}

export function createAuthProbeSession(
  min: number,
  max: number,
  auth: (guess: string) => { success: boolean; feedback?: unknown; message?: string },
): ProbeSession {
  const samples = new Map<number, number>()
  const session: ProbeSession = {
    min,
    max,
    guesses: 0,
    solved: false,
    exhausted: false,
    bestVal: min,
    bestAlt: -Infinity,
    samples,
    probe(x: number): number | null {
      if (session.exhausted || session.solved) return null
      const xi = Math.round(x)
      if (xi < min || xi > max) return null
      if (samples.has(xi)) return samples.get(xi)!
      if (session.guesses >= SOLVER_MAX_PROBES) {
        session.exhausted = true
        return null
      }
      session.guesses++
      const result = auth(String(xi))
      if (result.success) {
        session.solved = true
        samples.set(xi, Infinity)
        session.bestVal = xi
        session.bestAlt = Infinity
        return Infinity
      }
      const alt = parseKingOfTheHillAltitude(result.feedback, result.message)
      if (alt === null) return null
      samples.set(xi, alt)
      if (alt > session.bestAlt) {
        session.bestAlt = alt
        session.bestVal = xi
      }
      return alt
    },
  }
  return session
}

export function createReplayProbeSession(
  min: number,
  max: number,
  samples: Map<number, number>,
  onNeedProbe: (x: number) => void,
): ProbeSession {
  let bestVal = min
  let bestAlt = -Infinity
  for (const [x, alt] of samples) {
    if (alt > bestAlt) {
      bestAlt = alt
      bestVal = x
    }
  }
  const session: ProbeSession = {
    min,
    max,
    guesses: 0,
    solved: false,
    exhausted: false,
    bestVal,
    bestAlt,
    samples,
    probe(x: number): number | null {
      if (session.exhausted || session.solved) return null
      const xi = Math.round(x)
      if (xi < min || xi > max) return null
      if (samples.has(xi)) {
        const alt = samples.get(xi)!
        if (alt > session.bestAlt) {
          session.bestAlt = alt
          session.bestVal = xi
        }
        return alt
      }
      if (session.guesses >= SOLVER_MAX_PROBES) {
        session.exhausted = true
        return null
      }
      onNeedProbe(xi)
      throw STOP_PROBE
    },
  }
  return session
}

export function runUntilNextProbe(
  samples: Map<number, number>,
  ctx: SolverContext,
): { type: "probe"; x: number } | { type: "done"; solved: boolean } {
  let needProbe: number | null = null
  const session = createReplayProbeSession(ctx.min, ctx.max, samples, (x) => {
    needProbe = x
  })
  try {
    runSolverCore(session, ctx.min, ctx.max, ctx.gaussWidth, ctx.hillCount)
    return { type: "done", solved: session.solved }
  } catch (e) {
    if (e !== STOP_PROBE) throw e
  }
  if (needProbe != null) return { type: "probe", x: needProbe }
  return { type: "done", solved: session.solved }
}

export interface KingOfTheHillAssignment {
  difficulty: number
  passwordLength: number
}

export interface SolverAuthResult {
  success: boolean
  feedback?: unknown
  message?: string
}

/** Run the solver synchronously with a caller-supplied auth callback. */
export function runSolverImproved(
  assignment: KingOfTheHillAssignment,
  options: {
    auth: (guess: string) => SolverAuthResult
    returnSamples?: boolean
  },
): SolverRunResult {
  const { min, max } = numericRange(assignment.passwordLength)
  const ctx: SolverContext = {
    min,
    max,
    hillCount: kingOfTheHillHillCount(assignment.difficulty),
    passwordLength: assignment.passwordLength,
    gaussWidth: kingOfTheHillGaussianWidth(assignment.passwordLength),
  }
  const session = createAuthProbeSession(min, max, options.auth)
  runSolverCore(session, min, max, ctx.gaussWidth, ctx.hillCount)
  const result: SolverRunResult = {
    guesses: session.guesses,
    solved: session.solved,
    bestVal: session.bestVal,
    bestAlt: session.bestAlt,
  }
  if (options.returnSamples === true) result.samples = session.samples
  return result
}
