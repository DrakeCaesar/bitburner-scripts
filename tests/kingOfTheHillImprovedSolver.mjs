/**
 * King of the Hill improved solver (plain ESM port of src/dnet/solvers/kingOfTheHill/).
 * Matches tests/koth_tune C++ behavior: probe budget, ternary fix, 47 config fields.
 */

export const KOTH_PEAK_HEIGHT = 10000
export const KOTH_HILL_SPACING_WIDTHS = 3
const KOTH_HILL_DIFFICULTY_DIVISOR = 8
const KOTH_HILL_DIFFICULTY_CAP = 4
const KOTH_GAUSS_WIDTH_LENGTH_OFFSET = 2
const KOTH_GAUSS_WIDTH_PLUS = 1
export const SOLVER_MAX_PROBES = 5000
export const TERNARY_MAX_LINEAR_SCAN = 64

export const STOP_PROBE = Symbol("koth-stop-probe")

const TUNABLE_SPECS_INTERNAL = [
  { key: "clusterMargin", min: 1.0, max: 1.3, step: 0.05, type: "float" },
  { key: "clusterDetectAlt", min: 300, max: 800, step: 50, type: "int" },
  { key: "mainPeakModeAlt", min: 9000, max: 9900, step: 100, type: "int" },
  { key: "refinePeakCountMain", min: 1, max: 3, step: 1, type: "int" },
  { key: "findHillQuickRounds", min: 1, max: 5, step: 1, type: "int" },
  { key: "coarseMinDivisor", min: 40, max: 80, step: 4, type: "int" },
  { key: "coarseHillFactor", min: 4, max: 12, step: 1, type: "int" },
  { key: "rescanDivisor1", min: 0, max: 200, step: 10, type: "int" },
  { key: "rescanDivisor2", min: 0, max: 400, step: 20, type: "int" },
  { key: "rescanDivisor3", min: 0, max: 900, step: 50, type: "int" },
  { key: "refineSpanHillDivisor", min: 2, max: 6, step: 1, type: "int" },
  { key: "refineCoarsePasses", min: 3, max: 7, step: 1, type: "int" },
  { key: "refineFinePasses", min: 2, max: 6, step: 1, type: "int" },
  { key: "refineRadiusShrink", min: 3, max: 10, step: 1, type: "int" },
  { key: "refineStepShrink", min: 2, max: 5, step: 1, type: "int" },
  { key: "sideHillSweepWidthDivisor", min: 1, max: 4, step: 1, type: "int" },
  { key: "centroidMinAlt", min: 8000, max: 9600, step: 100, type: "int" },
  { key: "centroidAltFraction", min: 0.8, max: 0.95, step: 0.01, type: "float" },
  { key: "centroidRefineRadius", min: 6, max: 20, step: 2, type: "int" },
  { key: "centroidRefinePasses", min: 2, max: 6, step: 1, type: "int" },
  { key: "hillClimbInitialDivisor", min: 32, max: 128, step: 8, type: "int" },
  { key: "hillClimbShrink", min: 2, max: 8, step: 1, type: "int" },
  { key: "hillClimbFlatAltDelta", min: 0.001, max: 0.1, step: 0.005, type: "float" },
  { key: "zoomInitialDivisor", min: 20, max: 80, step: 5, type: "int" },
  { key: "zoomMaxPasses", min: 4, max: 12, step: 1, type: "int" },
  { key: "zoomStepDivisor", min: 4, max: 16, step: 1, type: "int" },
  { key: "parabolicFlatNegLog10", min: 6, max: 15, step: 1, type: "int" },
  { key: "mainPeakDetectAlt", min: 6500, max: 8500, step: 100, type: "int" },
  { key: "mainPeakWindowWidths", min: 2, max: 6, step: 1, type: "int" },
  { key: "gaussEstimateMinAlt", min: 0, max: 500, step: 25, type: "int" },
  { key: "gaussHeightFraction", min: 0.85, max: 1.0, step: 0.01, type: "float" },
  { key: "enableGaussianEstimate", min: 0, max: 1, step: 1, type: "int" },
  { key: "ternaryMaxItersCap", min: 8, max: 128, step: 4, type: "int" },
  { key: "ternaryWidthStop", min: 1, max: 12, step: 1, type: "int" },
  { key: "ternarySpanDivisor", min: 2, max: 8, step: 1, type: "int" },
  { key: "enableTernarySearch", min: 0, max: 1, step: 1, type: "int" },
  { key: "expandMaxStepDivisor", min: 1, max: 8, step: 1, type: "int" },
  { key: "expandStepMultiplier", min: 2, max: 4, step: 1, type: "int" },
  { key: "enableExpandFromBest", min: 0, max: 1, step: 1, type: "int" },
  { key: "subdivNarrowStepFactor", min: 1, max: 6, step: 1, type: "int" },
  { key: "enableSubdivNarrow", min: 0, max: 1, step: 1, type: "int" },
  { key: "centroidLogWeight", min: 0.0, max: 1.0, step: 0.1, type: "float" },
  { key: "finalMainRadius", min: 3, max: 20, step: 1, type: "int" },
  { key: "finalSideMinRadius", min: 10, max: 50, step: 5, type: "int" },
  { key: "finalSideMaxRadius", min: 50, max: 150, step: 5, type: "int" },
  { key: "finalSideSpanDivisor", min: 20, max: 80, step: 5, type: "int" },
  { key: "finalTinySpan", min: 6, max: 24, step: 2, type: "int" },
]

export const TUNABLE_SPECS = TUNABLE_SPECS_INTERNAL
export { TUNABLE_SPECS as IMPROVED_TUNABLE_SPECS }

export function defaultImprovedConfig() {
  return normalizeImprovedConfig({})
}

/** Tuned for lowest max guesses (tests/kingOfTheHillTune.max.json). */
export const TUNED_MAX_CONFIG = {
  clusterMargin: 1.05,
  clusterDetectAlt: 300,
  mainPeakModeAlt: 9000,
  refinePeakCountMain: 1,
  findHillQuickRounds: 4,
  coarseMinDivisor: 40,
  coarseHillFactor: 4,
  rescanDivisor1: 7,
  rescanDivisor2: 120,
  rescanDivisor3: 50,
  refineSpanHillDivisor: 6,
  refineCoarsePasses: 3,
  refineFinePasses: 2,
  refineRadiusShrink: 3,
  refineStepShrink: 3,
  sideHillSweepWidthDivisor: 4,
  centroidMinAlt: 8400,
  centroidAltFraction: 0.81,
  centroidRefineRadius: 12,
  centroidRefinePasses: 2,
  hillClimbInitialDivisor: 104,
  hillClimbShrink: 7,
  hillClimbFlatAltDelta: 0.036,
  zoomInitialDivisor: 35,
  zoomMaxPasses: 12,
  zoomStepDivisor: 16,
  parabolicFlatNegLog10: 8,
  mainPeakDetectAlt: 6500,
  mainPeakWindowWidths: 3,
  gaussEstimateMinAlt: 500,
  gaussHeightFraction: 1,
  enableGaussianEstimate: 1,
  ternaryMaxItersCap: 24,
  ternaryWidthStop: 1,
  ternarySpanDivisor: 5,
  enableTernarySearch: 0,
  expandMaxStepDivisor: 8,
  expandStepMultiplier: 4,
  enableExpandFromBest: 1,
  subdivNarrowStepFactor: 1,
  enableSubdivNarrow: 1,
  centroidLogWeight: 0.5,
  finalMainRadius: 3,
  finalSideMinRadius: 35,
  finalSideMaxRadius: 110,
  finalSideSpanDivisor: 20,
  finalTinySpan: 24,
}

/** Tuned for lowest average guesses (tests/kingOfTheHillTune.avg.json). */
export const TUNED_AVG_CONFIG = {
  clusterMargin: 1.1,
  clusterDetectAlt: 300,
  mainPeakModeAlt: 9000,
  refinePeakCountMain: 1,
  findHillQuickRounds: 4,
  coarseMinDivisor: 40,
  coarseHillFactor: 4,
  rescanDivisor1: 8,
  rescanDivisor2: 78,
  rescanDivisor3: 1,
  refineSpanHillDivisor: 6,
  refineCoarsePasses: 4,
  refineFinePasses: 2,
  refineRadiusShrink: 5,
  refineStepShrink: 5,
  sideHillSweepWidthDivisor: 4,
  centroidMinAlt: 8000,
  centroidAltFraction: 0.94,
  centroidRefineRadius: 8,
  centroidRefinePasses: 2,
  hillClimbInitialDivisor: 112,
  hillClimbShrink: 3,
  hillClimbFlatAltDelta: 0.006,
  zoomInitialDivisor: 41,
  zoomMaxPasses: 8,
  zoomStepDivisor: 13,
  parabolicFlatNegLog10: 9,
  mainPeakDetectAlt: 6500,
  mainPeakWindowWidths: 3,
  gaussEstimateMinAlt: 50,
  gaussHeightFraction: 1,
  enableGaussianEstimate: 1,
  ternaryMaxItersCap: 52,
  ternaryWidthStop: 7,
  ternarySpanDivisor: 4,
  enableTernarySearch: 0,
  expandMaxStepDivisor: 6,
  expandStepMultiplier: 4,
  enableExpandFromBest: 0,
  subdivNarrowStepFactor: 1,
  enableSubdivNarrow: 1,
  centroidLogWeight: 0.4,
  finalMainRadius: 3,
  finalSideMinRadius: 10,
  finalSideMaxRadius: 55,
  finalSideSpanDivisor: 40,
  finalTinySpan: 14,
}

export function getTunedImprovedConfig(objective = "max") {
  return normalizeImprovedConfig(objective === "avg" ? TUNED_AVG_CONFIG : TUNED_MAX_CONFIG)
}

export function normalizeImprovedConfig(overrides = {}) {
  const base = {
    clusterMargin: 1.1,
    clusterDetectAlt: 500,
    mainPeakModeAlt: 9600,
    refinePeakCountMain: 1,
    findHillQuickRounds: 3,
    coarseMinDivisor: 56,
    coarseHillFactor: 8,
    rescanDivisor1: 100,
    rescanDivisor2: 280,
    rescanDivisor3: 750,
    refineSpanHillDivisor: 3,
    refineCoarsePasses: 5,
    refineFinePasses: 4,
    refineRadiusShrink: 6,
    refineStepShrink: 3,
    sideHillSweepWidthDivisor: 2,
    centroidMinAlt: 9000,
    centroidAltFraction: 0.88,
    centroidRefineRadius: 12,
    centroidRefinePasses: 4,
    hillClimbInitialDivisor: 64,
    hillClimbShrink: 4,
    hillClimbFlatAltDelta: 0.01,
    zoomInitialDivisor: 40,
    zoomMaxPasses: 8,
    zoomStepDivisor: 8,
    parabolicFlatEpsilon: 1e-12,
    mainPeakDetectAlt: 7500,
    mainPeakWindowWidths: 3,
    gaussEstimateMinAlt: 50,
    gaussHeightFraction: 1.0,
    enableGaussianEstimate: 1,
    ternaryMaxItersCap: 64,
    ternaryWidthStop: 4,
    ternarySpanDivisor: 3,
    enableTernarySearch: 1,
    expandMaxStepDivisor: 1,
    expandStepMultiplier: 2,
    enableExpandFromBest: 1,
    subdivNarrowStepFactor: 2,
    enableSubdivNarrow: 1,
    centroidLogWeight: 1.0,
    finalMainRadius: 9,
    finalSideMinRadius: 25,
    finalSideMaxRadius: 99,
    finalSideSpanDivisor: 40,
    finalTinySpan: 12,
    parabolicFlatNegLog10: 12,
    rescanDivisors: [],
  }
  const cfg = { ...base, ...overrides }
  for (const spec of TUNABLE_SPECS) {
    const v = cfg[spec.key]
    if (spec.type === "int") {
      cfg[spec.key] = Math.round(Math.max(spec.min, Math.min(spec.max, v)))
    } else {
      const clamped = Math.max(spec.min, Math.min(spec.max, v))
      const steps = Math.round((clamped - spec.min) / spec.step)
      cfg[spec.key] = spec.min + steps * spec.step
    }
  }
  cfg.enableGaussianEstimate = cfg.enableGaussianEstimate ? 1 : 0
  cfg.enableTernarySearch = cfg.enableTernarySearch ? 1 : 0
  cfg.enableExpandFromBest = cfg.enableExpandFromBest ? 1 : 0
  cfg.enableSubdivNarrow = cfg.enableSubdivNarrow ? 1 : 0
  cfg.parabolicFlatEpsilon = 10 ** -cfg.parabolicFlatNegLog10
  cfg.rescanDivisors = [cfg.rescanDivisor1, cfg.rescanDivisor2, cfg.rescanDivisor3]
    .filter((d) => d > 0)
    .sort((a, b) => a - b)
  return cfg
}

export function computeImprovedFitness(objective, unsolved, totalGuesses, maxGuesses) {
  if (unsolved > 0) return Number.MAX_SAFE_INTEGER - unsolved * 1e9 + totalGuesses
  if (objective === "max") return maxGuesses * 1_000_000 + totalGuesses
  return totalGuesses * 1000 + maxGuesses
}

export function parseKingOfTheHillAltitude(feedback, message) {
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

export function kingOfTheHillHillCount(difficulty) {
  return Math.min(Math.floor(difficulty / KOTH_HILL_DIFFICULTY_DIVISOR), KOTH_HILL_DIFFICULTY_CAP) * 2 + 1
}

export function kingOfTheHillGaussianWidth(passwordLength) {
  return 10 ** Math.max(passwordLength - KOTH_GAUSS_WIDTH_LENGTH_OFFSET, 0) + KOTH_GAUSS_WIDTH_PLUS
}

function ceilDiv(a, b) {
  return Math.floor((a + b - 1) / b)
}

function clusterHalfWidth(hillCount, passwordLength, clusterMargin) {
  const width = kingOfTheHillGaussianWidth(passwordLength)
  return Math.ceil((hillCount - 1) * width * KOTH_HILL_SPACING_WIDTHS * clusterMargin)
}

function clusterSearchWindow(fullMin, fullMax, center, hillCount, passwordLength, cfg) {
  const half = clusterHalfWidth(hillCount, passwordLength, cfg.clusterMargin)
  return { min: Math.max(fullMin, center - half), max: Math.min(fullMax, center + half) }
}

function improvedSearchWindow(fullMin, fullMax, session, hillCount, passwordLength, gaussWidth, cfg) {
  if (session.bestAlt >= cfg.mainPeakDetectAlt) {
    const half = gaussWidth * cfg.mainPeakWindowWidths
    return { min: Math.max(fullMin, session.bestVal - half), max: Math.min(fullMax, session.bestVal + half) }
  }
  if (session.bestAlt > cfg.clusterDetectAlt) {
    return clusterSearchWindow(fullMin, fullMax, session.bestVal, hillCount, passwordLength, cfg)
  }
  return { min: fullMin, max: fullMax }
}

function parabolicPeak(x0, y0, x1, y1, x2, y2, cfg) {
  const denom = y0 - 2 * y1 + y2
  if (!Number.isFinite(denom) || Math.abs(denom) < cfg.parabolicFlatEpsilon) return x1
  return x1 + ((x1 - x0) * (y0 - y2)) / (2 * denom)
}

function findLocalPeaks(sorted) {
  if (sorted.length === 0) return []
  const peaks = []
  for (let i = 1; i < sorted.length - 1; i++) {
    if (sorted[i].alt >= sorted[i - 1].alt && sorted[i].alt > sorted[i + 1].alt) {
      peaks.push({ x: sorted[i].x, alt: sorted[i].alt })
    }
  }
  let best = sorted[0]
  for (const row of sorted) {
    if (row.alt > best.alt) best = row
  }
  peaks.push({ x: best.x, alt: best.alt })
  peaks.sort((a, b) => b.alt - a.alt)
  const seen = new Set()
  return peaks.filter((p) => {
    if (seen.has(p.x)) return false
    seen.add(p.x)
    return true
  })
}

function refinePeak(session, mn, mx, center, initialRadius, passes, cfg) {
  let c = center
  let r = Math.max(1, initialRadius)
  for (let p = 0; p < passes; p++) {
    const x0 = Math.max(mn, c - r)
    const x2 = Math.min(mx, c + r)
    const x1 = c
    const y0 = session.probe(x0)
    if (session.solved) return c
    const y1 = session.probe(x1)
    if (session.solved) return c
    const y2 = session.probe(x2)
    if (session.solved) return c
    const peak = parabolicPeak(x0, y0, x1, y1, x2, y2, cfg)
    c = Math.round(Math.max(mn, Math.min(mx, peak)))
    r = Math.max(1, ceilDiv(r, cfg.refineStepShrink))
  }
  return c
}

function weightedCentroid(session, minAlt) {
  let sumW = 0
  let sumX = 0
  for (const [x, alt] of session.samples) {
    if (alt < minAlt) continue
    sumW += alt
    sumX += x * alt
  }
  if (sumW <= 0) return null
  return Math.round(sumX / sumW)
}

function logWeightedCentroid(session, minAlt) {
  let sumW = 0
  let sumX = 0
  for (const [x, alt] of session.samples) {
    if (alt <= minAlt) continue
    const w = Math.log1p(alt - minAlt)
    sumW += w
    sumX += x * w
  }
  if (sumW <= 0) return null
  return Math.round(sumX / sumW)
}

function blendedCentroid(session, minAlt, cfg) {
  const linear = weightedCentroid(session, minAlt)
  const logc = logWeightedCentroid(session, minAlt)
  if (linear == null && logc == null) return null
  const w = cfg.centroidLogWeight
  if (logc == null || w <= 0) return linear
  if (linear == null || w >= 1) return logc
  return Math.round(linear * (1 - w) + logc * w)
}

function buildFinals(mn, mx, bestVal, bestAlt, cfg) {
  const span = mx - mn
  const out = []
  if (span <= cfg.finalTinySpan) {
    for (let d = 0; d <= span; d++) {
      if (d === 0) {
        if (bestVal >= mn && bestVal <= mx) out.push(bestVal)
        continue
      }
      for (const sign of [-1, 1]) {
        const c = bestVal + sign * d
        if (c >= mn && c <= mx) out.push(c)
      }
    }
    return out
  }
  const nearMainPeak = bestAlt >= cfg.mainPeakDetectAlt
  const maxRadius = nearMainPeak
    ? cfg.finalMainRadius
    : Math.min(cfg.finalSideMaxRadius, Math.max(cfg.finalSideMinRadius, ceilDiv(span, cfg.finalSideSpanDivisor)))
  for (let d = 0; d <= maxRadius; d++) {
    if (d === 0) {
      if (bestVal >= mn && bestVal <= mx) out.push(bestVal)
      continue
    }
    for (const sign of [-1, 1]) {
      const c = bestVal + sign * d
      if (c >= mn && c <= mx) out.push(c)
    }
  }
  return out
}

function tryFinalCandidates(session, mn, mx, cfg) {
  for (const c of buildFinals(mn, mx, session.bestVal, session.bestAlt, cfg)) {
    session.probe(c)
    if (session.solved) return
  }
}

function tryGaussianPeakEstimate(session, mn, mx, gaussWidth, cfg) {
  if (!cfg.enableGaussianEstimate) return
  if (session.bestAlt < cfg.gaussEstimateMinAlt) return
  const height = KOTH_PEAK_HEIGHT * cfg.gaussHeightFraction
  const ratio = Math.min(session.bestAlt / height, 0.999999)
  if (ratio <= 1e-12) return
  const offset = gaussWidth * Math.sqrt(-Math.log(ratio))
  const o = Math.max(1, Math.round(offset))
  for (const candidate of [session.bestVal - o, session.bestVal + o]) {
    if (candidate >= mn && candidate <= mx) {
      session.probe(candidate)
      if (session.solved) return
    }
  }
}

function sweep(session, start, end, step, stopAlt) {
  if (step <= 0) step = 1
  for (let x = start; x <= end; x += step) {
    session.probe(x)
    if (session.solved || session.exhausted) return
    if (stopAlt != null && session.bestAlt >= stopAlt) return
  }
  if (end >= start && end <= session.max && !session.samples.has(end)) {
    session.probe(end)
    if (session.solved || session.exhausted) return
    if (stopAlt != null && session.bestAlt >= stopAlt) return
  }
}

function tryTernaryPeakSearch(session, lo, hi, maxIters, widthStop) {
  if (lo >= hi || session.solved || session.exhausted) return
  const initialWidth = hi - lo
  const safeWidthStop = Math.max(1, widthStop)
  const minIters = Math.ceil(Math.log(initialWidth / safeWidthStop) / Math.log(1.5))
  const itersBudget = Math.min(64, Math.max(maxIters, minIters))
  let iters = 0
  while (hi - lo > safeWidthStop && iters < itersBudget && !session.solved && !session.exhausted) {
    const m1 = lo + Math.floor((hi - lo) / 3)
    const m2 = hi - Math.floor((hi - lo) / 3)
    const a1 = session.probe(m1)
    if (session.solved || session.exhausted) return
    const a2 = session.probe(m2)
    if (session.solved || session.exhausted) return
    if (a1 < a2) lo = m1
    else hi = m2
    iters++
  }
  const width = hi - lo
  if (width <= TERNARY_MAX_LINEAR_SCAN) {
    for (let x = lo; x <= hi && !session.solved && !session.exhausted; x++) {
      session.probe(x)
    }
    return
  }
  sweep(session, lo, hi, Math.max(1, ceilDiv(width, safeWidthStop)), null)
}

function tryExpandFromBest(session, mn, mx, gaussWidth, stopAlt, cfg) {
  if (!cfg.enableExpandFromBest) return
  let step = 1
  const maxStep = Math.max(1, ceilDiv(gaussWidth, cfg.expandMaxStepDivisor))
  const mult = Math.max(2, cfg.expandStepMultiplier)
  while (step <= maxStep && !session.solved && !session.exhausted) {
    let improved = false
    for (const sign of [-1, 1]) {
      const x = session.bestVal + sign * step
      if (x < mn || x > mx) continue
      const before = session.bestAlt
      session.probe(x)
      if (session.solved) return
      if (session.bestAlt > before) improved = true
      if (session.bestAlt >= stopAlt) return
    }
    if (!improved && step > 1) break
    step = Math.max(1, step * mult)
  }
}

function refinePeakCount(session, hillCount, cfg) {
  if (session.bestAlt >= cfg.mainPeakModeAlt) return cfg.refinePeakCountMain
  return hillCount
}

function findHillBySubdivision(
  session,
  lo,
  hi,
  quickRounds,
  fullMin,
  fullMax,
  hillCount,
  passwordLength,
  gaussWidth,
  cfg,
) {
  let step = hi - lo
  for (let round = 0; round < quickRounds && !session.solved && !session.exhausted; round++) {
    const nextStep = Math.max(1, ceilDiv(step, 2))
    if (nextStep >= step) break
    step = nextStep
    for (let x = lo + step; x < hi; x += step) {
      session.probe(Math.round(x))
      if (session.solved) return
    }
    if (session.bestAlt >= cfg.mainPeakModeAlt) return
    if (!cfg.enableSubdivNarrow) continue
    if (session.bestAlt >= cfg.clusterDetectAlt) {
      const win = clusterSearchWindow(fullMin, fullMax, session.bestVal, hillCount, passwordLength, cfg)
      lo = Math.max(lo, win.min)
      hi = Math.min(hi, win.max)
    } else if (session.bestAlt > 0) {
      const half = Math.max(step * cfg.subdivNarrowStepFactor, gaussWidth)
      lo = Math.max(lo, session.bestVal - half)
      hi = Math.min(hi, session.bestVal + half)
    }
  }
}

function findHillLinearFallback(session, lo, hi, hillCount, cfg) {
  const span = hi - lo
  const step = Math.max(1, ceilDiv(span, Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)))
  sweep(session, lo, hi, step, cfg.mainPeakModeAlt)
}

function tryHillClimbFinals(session, searchMin, searchMax, gaussWidth, fullMin, fullMax, cfg) {
  let step = Math.max(1, ceilDiv(gaussWidth, cfg.hillClimbInitialDivisor))
  let x = session.bestVal
  while (step >= 1 && !session.solved && !session.exhausted) {
    const left = Math.max(searchMin, x - step)
    const right = Math.min(searchMax, x + step)
    const yL = session.probe(left)
    if (session.solved) return
    const yC = left === right ? yL : session.probe(x)
    if (session.solved) return
    const yR = session.probe(right)
    if (session.solved) return
    if (yL > yC) x = left
    else if (yR > yC) x = right
    const flat =
      Math.abs(yL - yC) <= cfg.hillClimbFlatAltDelta && Math.abs(yR - yC) <= cfg.hillClimbFlatAltDelta
    if (flat || (yC >= yL && yC >= yR)) {
      const nextStep = Math.max(1, ceilDiv(step, cfg.hillClimbShrink))
      if (nextStep >= step) break
      step = nextStep
    }
  }
  tryFinalCandidates(session, fullMin, fullMax, cfg)
}

function tryZoomFinals(session, searchMin, searchMax, fullMin, fullMax, cfg) {
  let step = Math.max(1, ceilDiv(searchMax - searchMin, cfg.zoomInitialDivisor))
  for (let pass = 0; pass < cfg.zoomMaxPasses && !session.solved && !session.exhausted; pass++) {
    const lo = Math.max(searchMin, session.bestVal - step)
    const hi = Math.min(searchMax, session.bestVal + step)
    sweep(session, lo, hi, Math.max(1, ceilDiv(step, cfg.zoomStepDivisor)), null)
    if (session.solved) return
    tryFinalCandidates(session, fullMin, fullMax, cfg)
    if (session.solved) return
    const nextStep = Math.max(1, ceilDiv(step, cfg.zoomStepDivisor))
    if (nextStep >= step) break
    step = nextStep
  }
}

function refinePeakCandidates(session, searchMin, searchMax, peaks, refineRadius, count, cfg) {
  for (let i = 0; i < Math.min(count, peaks.length); i++) {
    const peak = peaks[i]
    const refined = refinePeak(session, searchMin, searchMax, peak.x, refineRadius, cfg.refineCoarsePasses, cfg)
    if (session.solved) return true
    refinePeak(
      session,
      searchMin,
      searchMax,
      refined,
      Math.max(1, ceilDiv(refineRadius, cfg.refineRadiusShrink)),
      cfg.refineFinePasses,
      cfg,
    )
    if (session.solved) return true
  }
  return session.solved
}

function sortedSamples(session) {
  return [...session.samples.entries()].map(([x, alt]) => ({ x, alt })).sort((a, b) => a.x - b.x)
}

export function runSolverImprovedCore(session, ctx, cfgIn, options = {}) {
  const cfg = normalizeImprovedConfig(cfgIn)
  const returnSamples = options.returnSamples === true
  const { min, max, hillCount, passwordLength, gaussWidth } = ctx

  findHillBySubdivision(session, min, max, cfg.findHillQuickRounds, min, max, hillCount, passwordLength, gaussWidth, cfg)
  if (!session.solved && session.bestAlt >= cfg.clusterDetectAlt) {
    tryGaussianPeakEstimate(session, min, max, gaussWidth, cfg)
  }
  if (!session.solved && session.bestAlt < cfg.mainPeakDetectAlt) {
    let fallbackLo = min
    let fallbackHi = max
    if (session.bestAlt >= cfg.clusterDetectAlt) {
      const win = clusterSearchWindow(min, max, session.bestVal, hillCount, passwordLength, cfg)
      fallbackLo = win.min
      fallbackHi = win.max
    }
    findHillLinearFallback(session, fallbackLo, fallbackHi, hillCount, cfg)
  }
  if (session.solved) {
    return finish()
  }

  let search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg)
  let searchSpan = search.max - search.min
  let coarseStep = Math.max(1, ceilDiv(searchSpan, Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)))

  for (const divisor of cfg.rescanDivisors) {
    if (session.bestAlt >= cfg.centroidMinAlt) break
    if (session.bestAlt >= cfg.mainPeakModeAlt) break
    search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg)
    searchSpan = search.max - search.min
    sweep(session, search.min, search.max, Math.max(1, ceilDiv(searchSpan, divisor)), cfg.mainPeakModeAlt)
    if (session.solved) return finish()
  }

  search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg)
  searchSpan = search.max - search.min
  coarseStep = Math.max(1, ceilDiv(searchSpan, Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)))

  {
    const peaks = findLocalPeaks(sortedSamples(session))
    const refineRadius = Math.max(coarseStep, ceilDiv(searchSpan, hillCount * cfg.refineSpanHillDivisor))
    refinePeakCandidates(session, search.min, search.max, peaks, refineRadius, refinePeakCount(session, hillCount, cfg), cfg)
    if (session.solved) return finish()
  }

  if (session.bestAlt < cfg.mainPeakDetectAlt) {
    search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg)
    tryExpandFromBest(session, search.min, search.max, gaussWidth, cfg.mainPeakDetectAlt, cfg)
    if (session.solved) return finish()
    sweep(
      session,
      search.min,
      search.max,
      Math.max(1, ceilDiv(gaussWidth, cfg.sideHillSweepWidthDivisor)),
      cfg.mainPeakDetectAlt,
    )
    if (session.solved) return finish()
    const peaks = findLocalPeaks(sortedSamples(session))
    const refineRadius = Math.max(1, gaussWidth)
    refinePeakCandidates(session, search.min, search.max, peaks, refineRadius, refinePeakCount(session, hillCount, cfg), cfg)
    if (session.solved) return finish()
  }

  if (session.bestAlt >= cfg.centroidMinAlt) {
    search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg)
    const centroidMin = session.bestAlt * cfg.centroidAltFraction
    const centroid = blendedCentroid(session, centroidMin, cfg)
    if (centroid != null) {
      session.probe(centroid)
      if (!session.solved) {
        refinePeak(session, search.min, search.max, centroid, cfg.centroidRefineRadius, cfg.centroidRefinePasses, cfg)
      }
    }
  }

  if (!session.solved) tryFinalCandidates(session, min, max, cfg)
  if (!session.solved && session.bestAlt >= cfg.mainPeakDetectAlt) {
    const climbWindow = clusterSearchWindow(min, max, session.bestVal, hillCount, passwordLength, cfg)
    if (cfg.enableTernarySearch) {
      const ternaryIters = Math.min(
        cfg.ternaryMaxItersCap,
        ceilDiv(climbWindow.max - climbWindow.min, Math.max(1, cfg.ternarySpanDivisor)),
      )
      tryTernaryPeakSearch(session, climbWindow.min, climbWindow.max, ternaryIters, cfg.ternaryWidthStop)
    }
    if (!session.solved) tryFinalCandidates(session, min, max, cfg)
    if (!session.solved) tryGaussianPeakEstimate(session, climbWindow.min, climbWindow.max, gaussWidth, cfg)
    if (!session.solved) tryFinalCandidates(session, min, max, cfg)
    if (!session.solved) tryHillClimbFinals(session, climbWindow.min, climbWindow.max, gaussWidth, min, max, cfg)
    if (!session.solved) tryZoomFinals(session, climbWindow.min, climbWindow.max, min, max, cfg)
    if (!session.solved) tryFinalCandidates(session, min, max, cfg)
  }

  return finish()

  function finish() {
    const result = {
      guesses: session.guesses,
      solved: session.solved,
      bestVal: session.bestVal,
      bestAlt: session.bestAlt,
    }
    if (returnSamples) result.samples = session.samples
    return result
  }
}

export function createAuthProbeSession(min, max, auth) {
  const samples = new Map()
  const session = {
    min,
    max,
    guesses: 0,
    solved: false,
    exhausted: false,
    bestVal: min,
    bestAlt: -1,
    samples,
    probe(x) {
      if (session.exhausted || session.solved) return 0
      const xi = Math.round(x)
      if (xi < min || xi > max) return 0
      if (samples.has(xi)) return samples.get(xi)
      if (session.guesses >= SOLVER_MAX_PROBES) {
        session.exhausted = true
        return 0
      }
      session.guesses++
      const result = auth(String(xi))
      if (result.success) {
        session.solved = true
        return Infinity
      }
      const alt = parseKingOfTheHillAltitude(result.feedback, result.message) ?? -1
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

function createReplayProbeSession(min, max, samples, onNeedProbe) {
  let bestVal = min
  let bestAlt = -1
  for (const [x, alt] of samples) {
    if (alt > bestAlt) {
      bestAlt = alt
      bestVal = x
    }
  }
  const session = {
    min,
    max,
    guesses: 0,
    solved: false,
    exhausted: false,
    bestVal,
    bestAlt,
    samples,
    probe(x) {
      if (session.exhausted || session.solved) return 0
      const xi = Math.round(x)
      if (xi < min || xi > max) return 0
      if (samples.has(xi)) {
        const alt = samples.get(xi)
        if (alt > session.bestAlt) {
          session.bestAlt = alt
          session.bestVal = xi
        }
        return alt
      }
      if (session.guesses >= SOLVER_MAX_PROBES) {
        session.exhausted = true
        return 0
      }
      onNeedProbe(xi)
      throw STOP_PROBE
    },
  }
  return session
}

export function runUntilNextProbe(samples, ctx, cfg) {
  let needProbe = null
  const session = createReplayProbeSession(ctx.min, ctx.max, samples, (x) => {
    needProbe = x
  })
  try {
    runSolverImprovedCore(session, ctx, cfg)
    return { type: "done", solved: session.solved }
  } catch (e) {
    if (e !== STOP_PROBE) throw e
  }
  if (needProbe != null) return { type: "probe", x: needProbe }
  return { type: "done", solved: session.solved }
}

/**
 * Run the improved solver on one assignment using a caller-supplied auth callback.
 * @param {object} assignment - { passwordLength, difficulty, ... }
 * @param {{ improvedConfig?: object, auth: (guess: string) => { success: boolean, feedback?: unknown, message?: string } }} options
 */
export function runSolverImproved(assignment, options = {}) {
  const cfg = normalizeImprovedConfig(options.improvedConfig ?? {})
  const min = 10 ** (assignment.passwordLength - 1)
  const max = 10 ** assignment.passwordLength - 1
  const ctx = {
    min,
    max,
    hillCount: kingOfTheHillHillCount(assignment.difficulty),
    passwordLength: assignment.passwordLength,
    gaussWidth: kingOfTheHillGaussianWidth(assignment.passwordLength),
  }
  const session = createAuthProbeSession(min, max, options.auth)
  return runSolverImprovedCore(session, ctx, cfg, { returnSamples: options.returnSamples === true })
}
