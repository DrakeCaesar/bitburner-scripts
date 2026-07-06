import type { ImprovedConfig } from "./config.js"
import { finalizeImprovedConfig, TUNED_MAX_CONFIG } from "./config.js"

export const KOTH_PEAK_HEIGHT = 10000
export const KOTH_HILL_SPACING_WIDTHS = 3
export const KOTH_HILL_DIFFICULTY_DIVISOR = 8
export const KOTH_HILL_DIFFICULTY_CAP = 4
export const KOTH_GAUSS_WIDTH_LENGTH_OFFSET = 2
export const KOTH_GAUSS_WIDTH_PLUS = 1
export const SOLVER_MAX_PROBES = 5000
export const TERNARY_MAX_LINEAR_SCAN = 64

export const STOP_PROBE = Symbol("koth-stop-probe")

export interface ProbeSample {
  x: number
  alt: number
}

export interface ProbeSession {
  min: number
  max: number
  guesses: number
  solved: boolean
  exhausted: boolean
  bestVal: number
  bestAlt: number
  samples: Map<number, number>
  probe(x: number): number
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

function ceilDiv(a: number, b: number): number {
  return Math.floor((a + b - 1) / b)
}

function clusterHalfWidth(hillCount: number, passwordLength: number, clusterMargin: number): number {
  const width = kingOfTheHillGaussianWidth(passwordLength)
  return Math.ceil((hillCount - 1) * width * KOTH_HILL_SPACING_WIDTHS * clusterMargin)
}

function clusterSearchWindow(
  fullMin: number,
  fullMax: number,
  center: number,
  hillCount: number,
  passwordLength: number,
  cfg: ImprovedConfig,
) {
  const half = clusterHalfWidth(hillCount, passwordLength, cfg.clusterMargin)
  return { min: Math.max(fullMin, center - half), max: Math.min(fullMax, center + half) }
}

function improvedSearchWindow(
  fullMin: number,
  fullMax: number,
  session: ProbeSession,
  hillCount: number,
  passwordLength: number,
  gaussWidth: number,
  cfg: ImprovedConfig,
) {
  if (session.bestAlt >= cfg.mainPeakDetectAlt) {
    const half = gaussWidth * cfg.mainPeakWindowWidths
    let winMin = Math.max(fullMin, session.bestVal - half)
    let winMax = Math.min(fullMax, session.bestVal + half)
    if (session.bestVal - fullMin <= half * 2) winMin = fullMin
    if (fullMax - session.bestVal <= half * 2) winMax = fullMax
    return { min: winMin, max: winMax }
  }
  if (session.bestAlt > cfg.clusterDetectAlt) {
    return clusterSearchWindow(fullMin, fullMax, session.bestVal, hillCount, passwordLength, cfg)
  }
  return { min: fullMin, max: fullMax }
}

function parabolicPeak(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, cfg: ImprovedConfig): number {
  const denom = y0 - 2 * y1 + y2
  if (!Number.isFinite(denom) || Math.abs(denom) < cfg.parabolicFlatEpsilon) return x1
  return x1 + ((x1 - x0) * (y0 - y2)) / (2 * denom)
}

function findLocalPeaks(sorted: ProbeSample[]) {
  if (sorted.length === 0) return [] as { x: number; alt: number }[]
  const peaks: { x: number; alt: number }[] = []
  for (let i = 1; i < sorted.length - 1; i++) {
    if (sorted[i]!.alt >= sorted[i - 1]!.alt && sorted[i]!.alt > sorted[i + 1]!.alt) {
      peaks.push({ x: sorted[i]!.x, alt: sorted[i]!.alt })
    }
  }
  let best = sorted[0]!
  for (const row of sorted) {
    if (row.alt > best.alt) best = row
  }
  peaks.push({ x: best.x, alt: best.alt })
  peaks.sort((a, b) => b.alt - a.alt)
  const seen = new Set<number>()
  return peaks.filter((p) => {
    if (seen.has(p.x)) return false
    seen.add(p.x)
    return true
  })
}

function refinePeak(
  session: ProbeSession,
  mn: number,
  mx: number,
  center: number,
  initialRadius: number,
  passes: number,
  cfg: ImprovedConfig,
): number {
  let c = center
  let r = Math.max(1, initialRadius)
  const onMainHill = session.bestAlt >= cfg.mainPeakDetectAlt
  const maxPasses = onMainHill ? Math.min(passes, 2) : passes
  for (let p = 0; p < maxPasses; p++) {
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

function tryParabolicPinpointMain(
  session: ProbeSession,
  mn: number,
  mx: number,
  gaussWidth: number,
  cfg: ImprovedConfig,
): void {
  if (session.bestAlt < cfg.mainPeakDetectAlt) return
  const r = Math.max(1, Math.ceil(gaussWidth / 4))
  const c = session.bestVal
  const x0 = Math.max(mn, c - r)
  const x2 = Math.min(mx, c + r)
  if (x0 >= x2) return
  const y0 = session.probe(x0)
  if (session.solved) return
  const y1 = session.samples.get(c) ?? session.probe(c)
  if (session.solved) return
  const y2 = session.probe(x2)
  if (session.solved) return
  const peak = parabolicPeak(x0, y0, c, y1, x2, y2, cfg)
  const px = Math.round(Math.max(mn, Math.min(mx, peak)))
  if (px !== c) session.probe(px)
}

function probeRangeAnchors(session: ProbeSession, lo: number, hi: number): void {
  session.probe(Math.round(lo))
  if (session.solved || session.exhausted) return
  session.probe(Math.round(hi))
  if (session.solved || session.exhausted) return
  const span = hi - lo
  if (span < 4) return
  for (const frac of [0.25, 0.5, 0.75]) {
    session.probe(Math.round(lo + span * frac))
    if (session.solved || session.exhausted) return
  }
}

function weightedCentroid(session: ProbeSession, minAlt: number): number | null {
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

function logWeightedCentroid(session: ProbeSession, minAlt: number): number | null {
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

function blendedCentroid(session: ProbeSession, minAlt: number, cfg: ImprovedConfig): number | null {
  const linear = weightedCentroid(session, minAlt)
  const logc = logWeightedCentroid(session, minAlt)
  if (linear == null && logc == null) return null
  const w = cfg.centroidLogWeight
  if (logc == null || w <= 0) return linear
  if (linear == null || w >= 1) return logc
  return Math.round(linear * (1 - w) + logc * w)
}

function buildFinals(mn: number, mx: number, bestVal: number, bestAlt: number, cfg: ImprovedConfig): number[] {
  const span = mx - mn
  const out: number[] = []
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

function tryFinalCandidates(session: ProbeSession, mn: number, mx: number, cfg: ImprovedConfig): void {
  for (const c of buildFinals(mn, mx, session.bestVal, session.bestAlt, cfg)) {
    session.probe(c)
    if (session.solved) return
  }
}

function applyGaussianJump(session: ProbeSession, mn: number, mx: number, gaussWidth: number, cfg: ImprovedConfig): void {
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

function tryGaussianPeakEstimate(session: ProbeSession, mn: number, mx: number, gaussWidth: number, cfg: ImprovedConfig): void {
  if (!cfg.enableGaussianEstimate) return
  applyGaussianJump(session, mn, mx, gaussWidth, cfg)
}

function sweep(
  session: ProbeSession,
  start: number,
  end: number,
  step: number,
  stopAlt: number | null,
  cfg?: ImprovedConfig,
): void {
  if (step <= 0) step = 1
  let peakX = session.bestVal
  let peakAlt = session.bestAlt
  for (let x = start; x <= end; x += step) {
    session.probe(x)
    if (session.solved || session.exhausted) return
    if (stopAlt != null && session.bestAlt >= stopAlt) return
    if (cfg != null && peakAlt >= cfg.mainPeakDetectAlt) {
      const xi = Math.round(x)
      if (xi > peakX) {
        const alt = session.samples.get(xi)
        if (alt != null && alt < peakAlt * 0.7 && alt < cfg.clusterDetectAlt) return
      }
    }
    if (session.bestAlt > peakAlt) {
      peakX = session.bestVal
      peakAlt = session.bestAlt
    }
  }
  if (end >= start && end <= session.max && !session.samples.has(end)) {
    session.probe(end)
    if (session.solved || session.exhausted) return
    if (stopAlt != null && session.bestAlt >= stopAlt) return
  }
}

function tryTernaryPeakSearch(session: ProbeSession, lo: number, hi: number, maxIters: number, widthStop: number): void {
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

function gallopFromBest(
  session: ProbeSession,
  lo: number,
  hi: number,
  initialStep: number,
  stopAlt: number,
  mult: number,
): void {
  if (initialStep <= 0) initialStep = 1
  mult = Math.max(2, mult)
  for (const sign of [-1, 1]) {
    let dist = initialStep
    let lastGoodDist = 0
    while (dist <= hi - lo && !session.solved && !session.exhausted) {
      const x = session.bestVal + sign * dist
      if (x < lo || x > hi) break
      const before = session.bestAlt
      session.probe(x)
      if (session.solved || session.exhausted) return
      if (session.bestAlt >= stopAlt) return
      if (session.bestAlt > before) {
        lastGoodDist = dist
        dist *= mult
        continue
      }
      if (lastGoodDist > 0) break
      dist *= mult
    }
  }
}

function tryExpandFromBest(
  session: ProbeSession,
  mn: number,
  mx: number,
  gaussWidth: number,
  stopAlt: number,
  cfg: ImprovedConfig,
): void {
  if (!cfg.enableExpandFromBest) return
  let step = Math.max(1, ceilDiv(gaussWidth, cfg.expandMaxStepDivisor))
  const maxStep = Math.max(step, ceilDiv(mx - mn, Math.max(cfg.coarseMinDivisor, 8)))
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
    if (!improved && step >= gaussWidth) break
    step = Math.max(1, step * mult)
  }
}

function refinePeakCount(session: ProbeSession, hillCount: number, cfg: ImprovedConfig): number {
  if (session.bestAlt >= cfg.mainPeakModeAlt) return cfg.refinePeakCountMain
  return hillCount
}

function probeSparseFractions(session: ProbeSession, lo: number, hi: number, count: number): void {
  const span = hi - lo
  if (span <= 0 || count <= 1) return
  for (let i = 1; i < count; i++) {
    session.probe(lo + Math.floor((span * i) / count))
    if (session.solved || session.exhausted) return
  }
}

function locateHill(
  session: ProbeSession,
  fullMin: number,
  fullMax: number,
  hillCount: number,
  passwordLength: number,
  gaussWidth: number,
  cfg: ImprovedConfig,
): void {
  let lo = fullMin
  let hi = fullMax
  const span = hi - lo
  if (span <= 0) return

  const sparseCount = Math.max(4, cfg.findHillQuickRounds * 4)
  probeSparseFractions(session, lo, hi, sparseCount)
  if (session.solved || session.exhausted || session.bestAlt >= cfg.mainPeakDetectAlt) return

  const coarseStep = Math.max(1, ceilDiv(span, Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)))
  const gallopStep = Math.max(coarseStep, gaussWidth)
  const mult = Math.max(2, cfg.expandStepMultiplier)
  const stopAlt = cfg.mainPeakDetectAlt

  for (let pass = 0; pass < Math.max(1, cfg.findHillQuickRounds) && !session.solved && !session.exhausted; pass++) {
    if (session.bestAlt >= stopAlt) return

    gallopFromBest(session, lo, hi, gallopStep, stopAlt, mult)
    if (session.solved || session.exhausted || session.bestAlt >= stopAlt) return

    if (session.bestAlt >= cfg.clusterDetectAlt) {
      applyGaussianJump(session, lo, hi, gaussWidth, cfg)
      if (session.solved || session.exhausted || session.bestAlt >= stopAlt) return
    }

    if (session.bestAlt >= cfg.clusterDetectAlt) {
      const win = clusterSearchWindow(fullMin, fullMax, session.bestVal, hillCount, passwordLength, cfg)
      lo = win.min
      hi = win.max
    } else if (session.bestAlt > 0) {
      const half = Math.max(gaussWidth * 2, coarseStep * 2)
      lo = Math.max(fullMin, session.bestVal - half)
      hi = Math.min(fullMax, session.bestVal + half)
    }
  }

  if (!session.solved && !session.exhausted && session.bestAlt < cfg.mainPeakDetectAlt) {
    sweep(session, lo, hi, coarseStep, stopAlt, cfg)
  }
}

function tryHillClimbFinals(
  session: ProbeSession,
  searchMin: number,
  searchMax: number,
  gaussWidth: number,
  fullMin: number,
  fullMax: number,
  cfg: ImprovedConfig,
): void {
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
    const flat = Math.abs(yL - yC) <= cfg.hillClimbFlatAltDelta && Math.abs(yR - yC) <= cfg.hillClimbFlatAltDelta
    if (flat || (yC >= yL && yC >= yR)) {
      const nextStep = Math.max(1, ceilDiv(step, cfg.hillClimbShrink))
      if (nextStep >= step) break
      step = nextStep
    }
  }
  tryFinalCandidates(session, fullMin, fullMax, cfg)
}

function tryZoomFinals(
  session: ProbeSession,
  searchMin: number,
  searchMax: number,
  fullMin: number,
  fullMax: number,
  cfg: ImprovedConfig,
): void {
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

function refinePeakCandidates(
  session: ProbeSession,
  searchMin: number,
  searchMax: number,
  peaks: { x: number; alt: number }[],
  refineRadius: number,
  count: number,
  cfg: ImprovedConfig,
): boolean {
  for (let i = 0; i < Math.min(count, peaks.length); i++) {
    const peak = peaks[i]!
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

function sortedSamples(session: ProbeSession): ProbeSample[] {
  return [...session.samples.entries()]
    .map(([x, alt]) => ({ x, alt }))
    .sort((a, b) => a.x - b.x)
}

export function runSolverImprovedCore(
  session: ProbeSession,
  ctx: SolverContext,
  cfgIn: ImprovedConfig,
  options: SolverCoreOptions = {},
): SolverRunResult {
  const cfg = finalizeImprovedConfig(cfgIn)
  const returnSamples = options.returnSamples === true
  const { min, max, hillCount, passwordLength, gaussWidth } = ctx

  probeRangeAnchors(session, min, max)
  if (session.solved) {
    return { guesses: session.guesses, solved: true, bestVal: session.bestVal, bestAlt: session.bestAlt }
  }

  locateHill(session, min, max, hillCount, passwordLength, gaussWidth, cfg)
  if (!session.solved && session.bestAlt >= cfg.clusterDetectAlt) {
    tryGaussianPeakEstimate(session, min, max, gaussWidth, cfg)
  }
  if (!session.solved && session.bestAlt < cfg.mainPeakDetectAlt && cfg.enableTernarySearch) {
    const win = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg)
    const ternaryIters = Math.min(
      cfg.ternaryMaxItersCap,
      ceilDiv(win.max - win.min, Math.max(1, cfg.ternarySpanDivisor)),
    )
    tryTernaryPeakSearch(session, win.min, win.max, ternaryIters, cfg.ternaryWidthStop)
  }
  if (session.solved) {
    return { guesses: session.guesses, solved: true, bestVal: session.bestVal, bestAlt: session.bestAlt }
  }

  let search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg)
  let searchSpan = search.max - search.min
  let coarseStep = Math.max(1, ceilDiv(searchSpan, Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)))

  for (const divisor of cfg.rescanDivisors) {
    if (session.bestAlt >= cfg.centroidMinAlt) break
    if (session.bestAlt >= cfg.mainPeakModeAlt) break
    if (session.bestAlt >= cfg.mainPeakDetectAlt) break
    search = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg)
    searchSpan = search.max - search.min
    sweep(session, search.min, search.max, Math.max(1, ceilDiv(searchSpan, divisor)), cfg.mainPeakModeAlt, cfg)
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
    applyGaussianJump(session, search.min, search.max, gaussWidth, cfg)
    if (session.solved) return finish()
    sweep(session, search.min, search.max, Math.max(1, ceilDiv(gaussWidth, cfg.sideHillSweepWidthDivisor)), cfg.mainPeakDetectAlt)
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
    const climbWindow = improvedSearchWindow(min, max, session, hillCount, passwordLength, gaussWidth, cfg)
    tryParabolicPinpointMain(session, climbWindow.min, climbWindow.max, gaussWidth, cfg)
    if (!session.solved) tryFinalCandidates(session, min, max, cfg)
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
    if (!session.solved && session.bestAlt < cfg.mainPeakModeAlt) {
      tryZoomFinals(session, climbWindow.min, climbWindow.max, min, max, cfg)
    }
    if (!session.solved) tryFinalCandidates(session, min, max, cfg)
  }

  return finish()

  function finish(): SolverRunResult {
    const result: SolverRunResult = {
      guesses: session.guesses,
      solved: session.solved,
      bestVal: session.bestVal,
      bestAlt: session.bestAlt,
    }
    if (returnSamples) result.samples = session.samples
    return result
  }
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
    bestAlt: -1,
    samples,
    probe(x: number): number {
      if (session.exhausted || session.solved) return 0
      const xi = Math.round(x)
      if (xi < min || xi > max) return 0
      if (samples.has(xi)) return samples.get(xi)!
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

export function createReplayProbeSession(
  min: number,
  max: number,
  samples: Map<number, number>,
  onNeedProbe: (x: number) => void,
): ProbeSession {
  let bestVal = min
  let bestAlt = -1
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
    probe(x: number): number {
      if (session.exhausted || session.solved) return 0
      const xi = Math.round(x)
      if (xi < min || xi > max) return 0
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
        return 0
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
  cfg: ImprovedConfig,
): { type: "probe"; x: number } | { type: "done"; solved: boolean } {
  let needProbe: number | null = null
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

export interface KingOfTheHillAssignment {
  difficulty: number
  passwordLength: number
}

export interface SolverAuthResult {
  success: boolean
  feedback?: unknown
  message?: string
}

/** Run the improved solver synchronously with a caller-supplied auth callback. */
export function runSolverImproved(
  assignment: KingOfTheHillAssignment,
  options: {
    improvedConfig?: ImprovedConfig
    auth: (guess: string) => SolverAuthResult
    returnSamples?: boolean
  },
): SolverRunResult {
  const cfg = finalizeImprovedConfig(options.improvedConfig ?? TUNED_MAX_CONFIG)
  const min = 10 ** (assignment.passwordLength - 1)
  const max = 10 ** assignment.passwordLength - 1
  const ctx: SolverContext = {
    min,
    max,
    hillCount: kingOfTheHillHillCount(assignment.difficulty),
    passwordLength: assignment.passwordLength,
    gaussWidth: kingOfTheHillGaussianWidth(assignment.passwordLength),
  }
  const session = createAuthProbeSession(min, max, options.auth)
  return runSolverImprovedCore(session, ctx, cfg, { returnSamples: options.returnSamples === true })
}
