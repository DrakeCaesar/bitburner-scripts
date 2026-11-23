/**
 * Password recovery from ONE reading in the far left tail of the hill cluster.
 *
 * The game seeds its WHRNG with `(password / 1000) % 30000` and never rounds the seed, so the n-th
 * random number is, to float precision, `frac(v * C_n)` with `C_n = 171^n/30269 + 172^n/30307 +
 * 170^n/30323`. The first three draws are therefore smooth sawtooth functions of the password:
 *
 *   r1 -> how many hills sit left of the peak (kL)      period ~59 063 passwords
 *   r2 -> horizontal offset of hill 0 (the leftmost)    period ~345.4 passwords
 *   r3 -> height of hill 0                              period ~2.02 passwords
 *
 * Far enough left of the cluster the altitude is hill 0 alone (the next hill is e^-16 or more
 * below it), so a single reading (x, a) is one equation in the one unknown p:
 *
 *   a = h0(p) * exp(-((x - c0(p)) / w)^2),   c0 = p - 3 w kL (0.9 + 0.2 r2),   h0 = 10000 - 2600 kL (0.95 + 0.1 r3)
 *
 * On each tooth of r2 the left side sweeps its whole range while p barely moves, so the passwords
 * that can satisfy it form a short run of integers per tooth; each is tested against the height
 * that r3 gives it. Survivors (a few dozen) go to `accept`, which re-runs the exact generator.
 *
 * The later draws (every other hill) amplify float rounding by 171 per step and are effectively a
 * hash of the password, which is why only the LEFT tail can be inverted this way.
 */

const M1 = 30269
const M2 = 30307
const M3 = 30323
const coefficient = (n: number): number => (171 ** n / M1 + 172 ** n / M2 + 170 ** n / M3) / 1000
const SEED_COEFFICIENT = [0, 1, 2, 3, 4, 5].map((n) => coefficient(n) * 1000)
/** Per-password phase advance of the first three WHRNG draws. */
const C1 = coefficient(1)
const C2 = coefficient(2)
const C3 = coefficient(3)
/**
 * The n-th draw for password p from the game's own float seed. `frac(C_n * (p % 3e7))` differs from
 * it by ~1e-9 * 171^n (the seed's division by 1000 is rounded), which is fine for r2 and r3 on a
 * normal hill but not for r4, r5 or a height next to zero.
 */
function draw(n: number, p: number): number {
  const y = SEED_COEFFICIENT[n]! * ((p / 1000) % 30000)
  return y - Math.floor(y)
}

/**
 * The third draw exactly as the game computes it. Next to h = 0 even `draw(3, p)`'s 2e-9 is too
 * coarse: at |h| = 0.04 it moves the implied distance by more than the tolerance.
 */
function thirdDraw(p: number): number {
  const v = (p / 1000) % 30000
  let s1 = v
  let s2 = v
  let s3 = v
  for (let i = 0; i < 3; i++) {
    s1 = (171 * s1) % M1
    s2 = (172 * s2) % M2
    s3 = (170 * s3) % M3
  }
  return (s1 / M1 + s2 / M2 + s3 / M3) % 1.0
}

/** The seed wraps every 30000 * 1000 passwords. */
const SEED_PERIOD = 30_000_000

const PEAK = 10000
const RUNG = 2600
/** D(rho) lookup resolution. The straddling rank needs the fine one: ln|h| is steep near h = 0. */
const TABLE_LIGHT = 2048
const TABLE_HEAVY = 65536
const tableLight = new Float64Array(TABLE_LIGHT + 1)
const tableHeavy = new Float64Array(TABLE_HEAVY + 1)
/** ln(h/a) below this puts the probe closer than 3 widths to hill 0: not a tail reading. */
const MIN_LOG_RATIO = 9
/** Within this of the zero crossing (|h| < ~60 at k = 4) the straddling rank takes the log directly. */
const SMALL_HEIGHT_RHO = 0.06
/** r3 from `p % 3e7` is off by up to ~5e-7; this close to 0 or 1 it is recomputed from the seed. */
const WRAP_EPS = 2e-6
/** r3 moves by this much (downwards, mod 1) every two passwords. */
const PARITY_DROP = 1 - (2 * C3 - Math.floor(2 * C3))
/** Candidates per tooth from which the parity bracketing pays for itself. */
const REFINE_MIN_SPAN = 8
/** Bracket slack, in tolerances: the interpolated end points are a little off near h = 0. */
const REFINE_MARGIN = 40
/** Windows smaller than this are walked password by password instead of tooth by tooth. */
const DIRECT_WINDOW = 200_000

export interface TailInversionOptions {
  /**
   * `light`: only ranks whose height band keeps one sign (cheap, a few hundred thousand tests).
   * `heavy`: only the rank whose band straddles zero (k = 4: heights -920..120) — the same search
   * over a band ten times wider. `all`: both.
   */
  pass: "light" | "heavy" | "all"
  /**
   * |height| range searched for the straddling rank. The band is unbounded towards h = 0, so the
   * heavy pass stops at 0.5 by default and the caller asks for the sliver below it separately.
   */
  minHeight?: number
  maxHeight?: number
}

/** True when rank k's height band `10000 - 2600 k (0.95..1.05)` contains zero. */
function straddlesZero(k: number): boolean {
  return PEAK - RUNG * k * 0.95 > 0 && PEAK - RUNG * k * 1.05 < 0
}

/**
 * Find a password in [pLo, pHi] for which (x, a) is a clean left-tail reading and `accept` holds.
 * `accept` must reject values it has already been offered and failed on the server, so a second
 * call continues the search.
 */
export function invertLeftTail(
  x: number,
  a: number,
  w: number,
  hills: number,
  pLo: number,
  pHi: number,
  accept: (p: number) => boolean,
  options: TailInversionOptions
): number | null {
  if (a === 0 || !Number.isFinite(a) || hills < 3) return null
  const minHeight = options.minHeight ?? 0.5
  const lnA = Math.log(Math.abs(a))
  const tol = Math.max(4, 1e-6 * w)
  const ranks = hills - 2

  for (let kL = 1; kL <= ranks; kL++) {
    const heavy = straddlesZero(kL)
    const table = heavy ? tableHeavy : tableLight
    const TABLE = heavy ? TABLE_HEAVY : TABLE_LIGHT
    if (heavy ? options.pass === "light" : options.pass === "heavy") continue
    // h(rho) = PEAK - RUNG kL (0.95 + 0.1 rho), falling in rho; keep the part with the sign of a.
    let ra = 0
    let rb = 1
    const hTop = PEAK - RUNG * kL * 0.95
    const hBottom = PEAK - RUNG * kL * 1.05
    const rZero = (PEAK / (RUNG * kL) - 0.95) / 0.1
    if (heavy) {
      const dr = minHeight / (RUNG * 0.1 * kL)
      const drMax = (options.maxHeight ?? Infinity) / (RUNG * 0.1 * kL)
      if (a > 0) {
        rb = rZero - dr
        ra = Math.max(0, rZero - drMax)
      } else {
        ra = rZero + dr
        rb = Math.min(1, rZero + drMax)
      }
    } else if (hTop > 0 !== a > 0 || hBottom > 0 !== a > 0) {
      continue
    }
    if (!(rb > ra)) continue

    // D(rho): distance from the probe to hill 0 that reproduces `a` at height h(rho).
    let usable = true
    for (let i = 0; i <= TABLE; i++) {
      const rho = ra + ((rb - ra) * i) / TABLE
      const q = Math.log(Math.abs(PEAK - RUNG * kL * (0.95 + 0.1 * rho))) - lnA
      if (!(q > MIN_LOG_RATIO)) {
        usable = false
        break
      }
      table[i] = w * Math.sqrt(q)
    }
    if (!usable) continue
    let maxStep = 0
    for (let i = 0; i < TABLE; i++) maxStep = Math.max(maxStep, Math.abs(table[i + 1]! - table[i]!))
    const nearTol = tol + maxStep
    const dMin = Math.min(table[0]!, table[TABLE]!)
    const dMax = Math.max(table[0]!, table[TABLE]!)

    // p = x + D + 3 w kL (0.9 + 0.2 u)  <=>  G(p) := p - pBase - K u(p) = D(rho(p))
    const K = 0.6 * kL * w
    const pBase = x + 2.7 * kL * w
    const wLo = Math.max(pLo, Math.ceil(pBase + dMin - tol))
    const wHi = Math.min(pHi, Math.floor(pBase + K + dMax + tol))
    if (wHi < wLo) continue
    const slope = K * C2 - 1
    const invSlope = 1 / slope
    const scale = TABLE / (rb - ra)

    for (let seg = Math.floor(wLo / SEED_PERIOD); seg <= Math.floor(wHi / SEED_PERIOD); seg++) {
      const base = seg * SEED_PERIOD
      const m0 = Math.max(0, wLo - base)
      const m1 = Math.min(SEED_PERIOD - 1, wHi - base)
      if (m1 < m0) continue

      if (slope < 2 || m1 - m0 < DIRECT_WINDOW) {
        for (let m = m0; m <= m1; m++) {
          let u = C2 * m
          u -= Math.floor(u)
          let rho = C3 * m
          rho -= Math.floor(rho)
          if (rho < ra || rho > rb) continue
          const f = (rho - ra) * scale
          const i = f >= TABLE ? TABLE - 1 : Math.floor(f)
          const d = table[i]! + (table[i + 1]! - table[i]!) * (f - i)
          if (Math.abs(base + m - pBase - K * u - d) > tol) continue
          if (accept(base + m)) return base + m
        }
        continue
      }

      // Distance for one height draw; exact near the zero crossing, interpolated elsewhere.
      const distanceAt = (rho: number, p: number): number => {
        if (heavy && Math.abs(rho - rZero) < SMALL_HEIGHT_RHO) {
          // ln|h| is too steep to interpolate this close to h = 0, and so sensitive that rho
          // has to come from the game's own float seed.
          const exact = p >= 0 ? thirdDraw(p) : rho
          return w * Math.sqrt(Math.log(Math.abs(PEAK - RUNG * kL * (0.95 + 0.1 * exact))) - lnA)
        }
        const f = (rho - ra) * scale
        const i = f >= TABLE ? TABLE - 1 : f <= 0 ? 0 : Math.floor(f)
        return table[i]! + (table[i + 1]! - table[i]!) * (f - i)
      }

      // r1 fixes kL: only the matching 1/ranks slice of every r1 period can hold the password.
      // On tooth t, u = C2 m - t and G = at - slope m; G falls from dMax + tol at m = start, so the
      // candidates are the integers within `span` above start, and start advances by `step` per tooth.
      const span = (dMax - dMin + 2 * tol) * invSlope
      const step = K * invSlope
      const gTop = dMax + tol
      // Not for the sliver next to h = 0: there the bracket's end points are off by more than its slack.
      const refine = heavy && span >= REFINE_MIN_SPAN && options.maxHeight === undefined
      const run0 = Math.floor(C1 * m0)
      const run1 = Math.floor(C1 * m1)
      for (let run = run0; run <= run1; run++) {
        const ma = Math.max(m0, Math.floor((run + (kL - 1) / ranks) / C1) - 1)
        const mb = Math.min(m1, Math.ceil((run + kL / ranks) / C1) + 1)
        if (mb < ma) continue
        const t0 = Math.floor(C2 * ma)
        const t1 = Math.floor(C2 * mb)
        let start = (base - pBase + K * t0 - gTop) * invSlope
        for (let t = t0; t <= t1; t++, start += step) {
          let m = Math.ceil(start)
          if (!heavy) {
            // Hot loop: reject on the nearest table entry, interpolate only the near misses.
            for (let off = m - start; off <= span; off++, m++) {
              const y = C3 * m
              const frac = y - Math.floor(y)
              const near = gTop - slope * off - table[(frac * TABLE) | 0]!
              // Within its error of 0 or 1 the cheap phase may sit at the wrong end of the band, so
              // those few are never rejected here and take r3 from the seed instead.
              const wrapRisk = frac < WRAP_EPS || frac > 1 - WRAP_EPS
              if ((near > nearTol || near < -nearTol) && !wrapRisk) continue
              if (m < ma || m > mb) continue
              const miss = gTop - slope * off - distanceAt(wrapRisk ? thirdDraw(base + m) : frac, base + m)
              if (miss > tol || miss < -tol) continue
              if (accept(base + m)) return base + m
            }
            continue
          }
          if (!refine) {
            for (let off = m - start; off <= span; off++, m++) {
              if (m < ma || m > mb) continue
              const y = C3 * m
              const rho = y - Math.floor(y)
              if (rho < ra || rho > rb) continue
              const miss = gTop - slope * off - distanceAt(rho, base + m)
              if (miss > tol || miss < -tol) continue
              if (accept(base + m)) return base + m
            }
            continue
          }
          // Wide band (dozens of candidates per tooth). Two passwords apart r3 moves by only
          // -0.0098, so along one parity the heights form a slow ramp: bracket the ramp's distance
          // range and keep only the candidates whose G falls inside it.
          const last = Math.min(mb, Math.floor(start + span))
          if (m < ma) m = ma
          for (let parity = 0; parity < 2; parity++) {
            let mc = m + parity
            while (mc <= last) {
              const y = C3 * mc
              const rhoHi = y - Math.floor(y)
              // Steps until this parity's ramp wraps below 0.
              const reach = Math.min(Math.floor((last - mc) / 2), Math.floor(rhoHi / PARITY_DROP))
              const end = mc + 2 * reach
              // Map the ramp's height range to a distance range and back to a password range.
              const lo = Math.max(rhoHi - PARITY_DROP * reach, ra)
              const hi = Math.min(rhoHi, rb)
              if (hi >= lo) {
                const dA = distanceAt(lo, -1)
                const dB = distanceAt(hi, -1)
                const dLo = Math.min(dA, dB) - REFINE_MARGIN * tol
                const dHi = Math.max(dA, dB) + REFINE_MARGIN * tol
                // G = gTop - slope (m - start) within [dLo, dHi]
                let from = Math.max(mc, Math.ceil(start + (gTop - dHi) * invSlope))
                if ((from - mc) % 2 !== 0) from++
                const to = Math.min(end, Math.floor(start + (gTop - dLo) * invSlope))
                for (let c = from; c <= to; c += 2) {
                  const yc = C3 * c
                  const rho = yc - Math.floor(yc)
                  if (rho < ra || rho > rb) continue
                  // Same nearest-entry rejection as the light loop (the table is 32x finer here).
                  const near = gTop - slope * (c - start) - table[((rho - ra) * scale) | 0]!
                  if ((near > nearTol || near < -nearTol) && Math.abs(rho - rZero) >= SMALL_HEIGHT_RHO) continue
                  const miss = gTop - slope * (c - start) - distanceAt(rho, base + c)
                  if (miss > tol || miss < -tol) continue
                  if (accept(base + c)) return base + c
                }
              }
              mc = end + 2
            }
          }
        }
      }
    }
  }
  return null
}

const C4 = coefficient(4)
/** Fractional parts: the phase of an integer password only needs these, and they keep 7 more digits. */
const F4 = C4 - Math.floor(C4)
const C5 = coefficient(5)
const F5 = C5 - Math.floor(C5)
/** Error bounds of r4 / r5 computed from `p % 3e7` instead of the float seed (measured 4e-5 / 7e-3). */
const COARSE_R4_ERROR = 2e-4
const COARSE_R5_ERROR = 0.02
/** r4 advances ~84.67 per password, so every third password it has moved by only ~0.0098. */
const STRIDE_4 = 3
const A4 = STRIDE_4 * C4 - Math.round(STRIDE_4 * C4)

/**
 * Walk the integers m in [ma, mb] for which `G = base + m - pBase - K * frac(cu * m)` can lie in
 * [dMin - tol, dMax + tol], where `frac(cu * m)` moves by the small positive `alpha` every `stride`
 * steps. `test(m, G, u)` returning true stops the walk.
 */
function walkBand(
  ma: number,
  mb: number,
  base: number,
  pBase: number,
  K: number,
  cu: number,
  stride: number,
  alpha: number,
  dMin: number,
  dMax: number,
  tol: number,
  direct: boolean,
  test: (m: number, g: number, u: number) => boolean
): boolean {
  const slope = K * alpha - stride
  if (direct || slope < 2 * stride) {
    for (let m = ma; m <= mb; m++) {
      let u = cu * m
      u -= Math.floor(u)
      const g = base + m - pBase - K * u
      if (g < dMin - tol || g > dMax + tol) continue
      if (test(m, g, u)) return true
    }
    return false
  }
  const invSlope = 1 / slope
  for (let j = 0; j < stride; j++) {
    let phase = cu * j
    phase -= Math.floor(phase)
    const n0 = Math.ceil((ma - j) / stride)
    const n1 = Math.floor((mb - j) / stride)
    if (n1 < n0) continue
    const t1 = Math.floor(alpha * n1 + phase)
    for (let t = Math.floor(alpha * n0 + phase); t <= t1; t++) {
      const at = base + j - pBase - K * (phase - t)
      let first = Math.ceil((at - dMax - tol) * invSlope)
      let last = Math.floor((at - dMin + tol) * invSlope)
      if (first < n0) first = n0
      if (last > n1) last = n1
      for (let n = first; n <= last; n++) {
        const u = alpha * n + phase - t
        if (test(stride * n + j, at - slope * n, u)) return true
      }
    }
  }
  return false
}

/**
 * The same inversion for the layouts the single-hill pass cannot read: hills 0 and 1 overlapping.
 *
 * A hill's offset is `rank * 3w * (0.9..1.1)`, so the jitter grows with the rank and from rank 5 on
 * the two outermost hills can sit within a width of each other — from rank 6 on, hill 1 can even be
 * the leftmost. The tail is then the sum of both, `(hA + hB * exp(-(2 D g + g^2) / w^2)) * exp(-(D/w)^2)`
 * with g the gap between them. Hill 1's draws (r4, r5) are still closed-form to ~1e-6 / ~1e-4,
 * good enough to shortlist candidates for the exact generator.
 *
 * Two passes per rank: hill 0 in front (walks r2's teeth) and hill 1 in front (walks r4's).
 */
export function invertLeftTailOverlap(
  x: number,
  a: number,
  w: number,
  hills: number,
  pLo: number,
  pHi: number,
  accept: (p: number) => boolean
): number | null {
  if (a === 0 || !Number.isFinite(a) || hills < 3) return null
  const ranks = hills - 2
  const lnA = Math.log(Math.abs(a))
  const tol = Math.max(8, 2e-5 * w)
  const w2 = w * w
  /** How far behind the reference hill the other one may sit and still be handled by this pass. */
  const overlapSlack = 0.005 * w
  /** exp(2 D slack / w^2) at D = 26.5 w: the largest weight the other hill can get. */
  const maxWeight = 1.31
  /** The walk's phase for hill 1 is off by up to ~1e-4 of its offset range. */
  const walkSlack = 2e-4 * 0.6 * (hills - 2) * w
  /** Shortlist tolerance: the cheap phases move the model by up to ~3e-4 w. */
  const coarseTol = 2e-3 * w
  let hit = -1

  // Highest rank first: the jitter, and with it the chance of an overlap, grows with the rank.
  for (let kL = ranks; kL >= 2; kL--) {
    // Smallest possible gap between hills 0 and 1 at this rank, in widths.
    const gapMinW = 3 * (0.9 - 0.2 * (kL - 1))
    if (gapMinW >= 1.2) continue
    for (const front of [0, 1] as const) {
      if (front === 1 && gapMinW >= 0) continue
      const kFront = kL - front
      const kBack = kL - (1 - front)
      if (straddlesZero(kFront) || kFront < 1) continue
      const frontTop = PEAK - RUNG * kFront * 0.95
      const frontBottom = PEAK - RUNG * kFront * 1.05
      const backTop = PEAK - RUNG * kBack * 0.95
      const backBottom = PEAK - RUNG * kBack * 1.05
      // Effective height range: front + [0, maxWeight] * back.
      const effHi = frontTop + maxWeight * Math.max(0, backTop)
      const effLo = frontBottom + maxWeight * Math.min(0, backBottom)
      let magLo: number
      let magHi: number
      if (a < 0) {
        if (effLo >= 0) continue
        magHi = -effLo
        magLo = Math.max(1, -Math.min(effHi, -1))
      } else {
        if (effHi <= 0) continue
        magHi = effHi
        magLo = Math.max(1, Math.max(effLo, 1))
      }
      const qLo = Math.log(magLo) - lnA
      const qHi = Math.log(magHi) - lnA
      if (!(qLo > MIN_LOG_RATIO)) continue
      const dMin = w * Math.sqrt(qLo)
      const dMax = w * Math.sqrt(qHi)

      const K = 0.6 * kFront * w
      const pBase = x + 2.7 * kFront * w
      const wLo = Math.max(pLo, Math.ceil(pBase + dMin - tol))
      const wHi = Math.min(pHi, Math.floor(pBase + K + dMax + tol))
      if (wHi < wLo) continue

      for (let seg = Math.floor(wLo / SEED_PERIOD); seg <= Math.floor(wHi / SEED_PERIOD); seg++) {
        const base = seg * SEED_PERIOD
        const m0 = Math.max(0, wLo - base)
        const m1 = Math.min(SEED_PERIOD - 1, wHi - base)
        if (m1 < m0) continue
        // Signed miss of the two-hill model for one candidate; NaN when the heights cannot give `a`.
        const missOf = (g: number, uFront: number, uBack: number, rhoFront: number, rhoBack: number): number => {
          // Distance from the front hill to the back hill (positive = back is further right).
          const gap = 3 * w * (kFront * (0.9 + 0.2 * uFront) - kBack * (0.9 + 0.2 * uBack))
          if (gap < -overlapSlack) return NaN
          const weight = Math.exp(-(2 * g * gap + gap * gap) / w2)
          const eff =
            PEAK - RUNG * kFront * (0.95 + 0.1 * rhoFront) + weight * (PEAK - RUNG * kBack * (0.95 + 0.1 * rhoBack))
          return g - w * Math.sqrt(Math.log(eff / a))
        }
        const test = (m: number, gCoarse: number, uCoarse: number): boolean => {
          // Shortlist on the cheap phases (hill 1's are only good to ~1e-4 here)...
          let u2 = C2 * m
          u2 -= Math.floor(u2)
          let r3 = C3 * m
          r3 -= Math.floor(r3)
          let u4 = F4 * m
          u4 -= Math.floor(u4)
          let r5 = F5 * m
          r5 -= Math.floor(r5)
          // (A cheap phase that sits within its own error of 0 or 1 may have wrapped to the other end
          // of its range; those candidates skip the shortlist and go straight to the seed draws.)
          const wrapRisk =
            r5 < COARSE_R5_ERROR || r5 > 1 - COARSE_R5_ERROR || u4 < COARSE_R4_ERROR || u4 > 1 - COARSE_R4_ERROR
          if (!wrapRisk) {
            const coarse = front === 0 ? missOf(gCoarse, uCoarse, u4, r3, r5) : missOf(gCoarse, uCoarse, u2, r5, r3)
            if (!(coarse < coarseTol && coarse > -coarseTol)) return false
          }
          // ...then repeat with hill 1's draws taken from the game's float seed.
          const p = base + m
          const uFront = front === 0 ? uCoarse : draw(4, p)
          const g = gCoarse + K * (uCoarse - uFront)
          const miss =
            front === 0
              ? missOf(g, uFront, draw(4, p), draw(3, p), draw(5, p))
              : missOf(g, uFront, draw(2, p), draw(5, p), draw(3, p))
          if (!(miss < tol && miss > -tol)) return false
          if (!accept(p)) return false
          hit = p
          return true
        }
        const direct = m1 - m0 < DIRECT_WINDOW
        const run1 = Math.floor(C1 * m1)
        for (let run = Math.floor(C1 * m0); run <= run1; run++) {
          const ma = Math.max(m0, Math.floor((run + (kL - 1) / ranks) / C1) - 1)
          const mb = Math.min(m1, Math.ceil((run + kL / ranks) / C1) + 1)
          if (mb < ma) continue
          const found =
            front === 0
              ? walkBand(ma, mb, base, pBase, K, C2, 1, C2, dMin, dMax, tol, direct, test)
              : walkBand(ma, mb, base, pBase, K, F4, STRIDE_4, A4, dMin, dMax, walkSlack, direct, test)
          if (found) return hit
        }
      }
    }
  }
  return null
}
