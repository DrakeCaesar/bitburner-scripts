/**
 * KingOfTheHill game + solver logic (bitburner-src accurate).
 * Shared by kingOfTheHillSim.mjs and kingOfTheHillViz.html.
 */

export const NUMBERS = "0123456789"
export const MAX_PASSWORD_LENGTH = 50
/** Difficulty 54+ -> 10-digit passwords; 32+ -> 9 Gaussian hills (max). */
export const DEFAULT_DIFFICULTY = 60
export const DEFAULT_COUNT = 10
export const DEFAULT_SEED = 0x4b6f7468 // "Koth"
export const KING_MAIN_PEAK_ALTITUDE = 7500

// --- Game model (bitburner-src authentication.ts; change only for experiments) ---

export const KOTH_PEAK_HEIGHT = 10000
export const KOTH_NEAR_ZONE_FRACTION = 0.03
export const KOTH_HILL_DIFFICULTY_DIVISOR = 8
export const KOTH_HILL_DIFFICULTY_CAP = 4
export const KOTH_HILL_SPACING_WIDTHS = 3
export const KOTH_LOCATION_JITTER_SCALE = 0.2
export const KOTH_LOCATION_JITTER_BASE = 0.9
export const KOTH_HEIGHT_OFFSET_BASE = 2600
export const KOTH_HEIGHT_JITTER_SCALE = 0.1
export const KOTH_HEIGHT_JITTER_BASE = 0.95
export const KOTH_GAUSS_WIDTH_LENGTH_OFFSET = 2
export const KOTH_GAUSS_WIDTH_PLUS = 1

// --- Assignment generation ---

export const ASSIGNMENT_PASSWORD_LENGTH_DIVISOR = 6
export const ASSIGNMENT_PASSWORD_LENGTH_CAP = 10
export const ASSIGNMENT_SEED_STRIDE = 9973
export const ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS = 15

// --- Altitude profile sampling (viz) ---

export const PROFILE_DEFAULT_POINT_COUNT = 800

// --- Legacy solver (grid search + zoom; mirrors src/dnet/solvers/impl/all.ts) ---

export const LEGACY_INITIAL_SWEEP_DIVISOR = 25
export const LEGACY_RESCAN_PHASES = 3
export const LEGACY_RESCAN_DIVISORS = [80, 250, 800]
export const LEGACY_ZOOM_STEP_DIVISOR = 8
export const LEGACY_BRUTE_FORCE_PASS = 999
export const LEGACY_RESCAN_PASS_BASE = 900
export const LEGACY_FINALS_TINY_SPAN = 12
export const LEGACY_FINAL_MAIN_RADIUS = 9
export const LEGACY_FINAL_SIDE_MIN_RADIUS = 25
export const LEGACY_FINAL_SIDE_MAX_RADIUS = 99
export const LEGACY_FINAL_SIDE_SPAN_DIVISOR = 40

// --- Improved solver (peak-picking + cluster window) ---

/** @typedef {ReturnType<typeof getDefaultImprovedConfig>} ImprovedSolverConfig */

export function getDefaultImprovedConfig() {
  return {
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
  }
}

/** Search bounds for the constant tuner (genetic / random search). */
export const IMPROVED_TUNABLE_SPECS = [
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
]

export function normalizeImprovedConfig(overrides = {}) {
  const cfg = { ...getDefaultImprovedConfig(), ...overrides }
  for (const spec of IMPROVED_TUNABLE_SPECS) {
    const v = cfg[spec.key]
    if (spec.type === "int") {
      cfg[spec.key] = Math.round(Math.max(spec.min, Math.min(spec.max, v)))
    } else {
      const clamped = Math.max(spec.min, Math.min(spec.max, v))
      const steps = Math.round((clamped - spec.min) / spec.step)
      cfg[spec.key] = spec.min + steps * spec.step
    }
  }
  cfg.rescanDivisors = [cfg.rescanDivisor1, cfg.rescanDivisor2, cfg.rescanDivisor3]
    .filter((d) => d > 0)
    .sort((a, b) => a - b)
  return cfg
}

function improvedRescanDivisors(cfg) {
  return cfg.rescanDivisors ?? [cfg.rescanDivisor1, cfg.rescanDivisor2, cfg.rescanDivisor3].filter((d) => d > 0).sort((a, b) => a - b)
}

// --- Game: bitburner-src/src/Casino/RNG.ts (WHRNG) ---

class WHRNG {
  constructor(totalPlaytime) {
    const v = (totalPlaytime / 1000) % 30000
    this.s1 = v
    this.s2 = v
    this.s3 = v
  }

  step() {
    this.s1 = (171 * this.s1) % 30269
    this.s2 = (172 * this.s2) % 30307
    this.s3 = (170 * this.s3) % 30323
  }

  random() {
    this.step()
    return (this.s1 / 30269.0 + this.s2 / 30307.0 + this.s3 / 30323.0) % 1.0
  }
}

function getAltitudeGivenHillSpecs(x, location, height, width) {
  return height * Math.exp(((x - location) ** 2 / width ** 2) * -1)
}

/** Same as getKingOfTheHillAltitude(server, attemptedPassword). */
export function getKingOfTheHillAltitude(server, attemptedPassword) {
  const password = Number(server.password)
  const x = Number(attemptedPassword)
  const rng = new WHRNG(password)
  const hillCount = Math.min(Math.floor(server.difficulty / KOTH_HILL_DIFFICULTY_DIVISOR), KOTH_HILL_DIFFICULTY_CAP) * 2 + 1
  const passwordHillIndex = Math.floor(rng.random() * (hillCount - 2)) + 1
  const width = 10 ** Math.max(server.password.length - KOTH_GAUSS_WIDTH_LENGTH_OFFSET, 0) + KOTH_GAUSS_WIDTH_PLUS

  if (Math.abs((x - password) / password) < KOTH_NEAR_ZONE_FRACTION) {
    return getAltitudeGivenHillSpecs(x, password, KOTH_PEAK_HEIGHT, width)
  }

  let altitude = 0
  for (let i = 0; i < hillCount; i++) {
    const locationOffset =
      (i - passwordHillIndex) * width * KOTH_HILL_SPACING_WIDTHS * (rng.random() * KOTH_LOCATION_JITTER_SCALE + KOTH_LOCATION_JITTER_BASE)
    const heightOffset =
      Math.abs((i - passwordHillIndex) * KOTH_HEIGHT_OFFSET_BASE) * (rng.random() * KOTH_HEIGHT_JITTER_SCALE + KOTH_HEIGHT_JITTER_BASE)
    altitude += getAltitudeGivenHillSpecs(x, password + locationOffset, KOTH_PEAK_HEIGHT - heightOffset, width)
  }

  return altitude
}

export function authKingOfTheHill(server, attemptedPassword) {
  if (server.password === attemptedPassword) {
    return { success: true }
  }
  const altitude = getKingOfTheHillAltitude(server, attemptedPassword)
  const message = `current altitude: ${altitude.toFixed(5)} m; highest peak: ${KOTH_PEAK_HEIGHT.toLocaleString()} m`
  return { success: false, feedback: `${altitude}`, message }
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function getPasswordSeeded(length, rng, allowLetters = false) {
  const characters = NUMBERS + (allowLetters ? "" : "")
  let password = ""
  const cappedLength = clampNumber(length, 1, MAX_PASSWORD_LENGTH)
  for (let i = 0; i < cappedLength; i++) {
    password += characters[Math.floor(rng() * characters.length)]
  }
  if (!allowLetters && Number(password) > Number.MAX_SAFE_INTEGER) {
    password = password.slice(0, ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS)
  }
  if (!allowLetters) {
    return Number(password).toString()
  }
  return password
}

export function buildAssignment(difficulty, rng) {
  const passwordLength = Math.min(1 + difficulty / ASSIGNMENT_PASSWORD_LENGTH_DIVISOR, ASSIGNMENT_PASSWORD_LENGTH_CAP)
  const password = getPasswordSeeded(passwordLength, rng, false)
  return {
    difficulty,
    password,
    passwordLength: password.length,
    modelId: "globalMaxima",
    staticPasswordHint: "Ascend the highest mountain!",
  }
}

export function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function assignmentNumericRange(assignment) {
  const min = 10 ** (assignment.passwordLength - 1)
  const max = 10 ** assignment.passwordLength - 1
  return { min, max }
}

export function toServer(assignment) {
  return { password: assignment.password, difficulty: assignment.difficulty }
}

/**
 * Sample altitude along guess values for one assignment (full valid numeric range).
 */
export function sampleAltitudeProfile(assignment, options = {}) {
  const pointCount = options.pointCount ?? PROFILE_DEFAULT_POINT_COUNT
  const password = Number(assignment.password)
  const { min, max } = assignmentNumericRange(assignment)
  const server = toServer(assignment)
  const start = min
  const end = max

  const step = Math.max(1, Math.ceil((end - start) / pointCount))
  const points = []
  for (let x = start; x <= end; x += step) {
    points.push({
      x,
      altitude: getKingOfTheHillAltitude(server, String(x)),
      nearZone: Math.abs((x - password) / password) < KOTH_NEAR_ZONE_FRACTION,
    })
  }
  const last = points[points.length - 1]
  if (!last || last.x !== end) {
    points.push({
      x: end,
      altitude: getKingOfTheHillAltitude(server, String(end)),
      nearZone: Math.abs((end - password) / password) < KOTH_NEAR_ZONE_FRACTION,
    })
  }

  return { points, password, min, max, start, end }
}

export function generateAssignments(seed, count, difficulty) {
  const rows = []
  for (let i = 0; i < count; i++) {
    const rng = mulberry32((seed + i * ASSIGNMENT_SEED_STRIDE) >>> 0)
    rows.push({ index: i + 1, assignment: buildAssignment(difficulty, rng) })
  }
  return rows
}

// --- Solver (src/dnet/solvers/impl/all.ts) ---

function kingOfTheHillStartRescan(state, phase) {
  const span = state.max - state.min
  state.rescanPhase = phase
  state.finished = false
  state.finals = []
  state.finalIdx = 0
  state.sweepIdx = state.min
  state.sweepEnd = state.max
  state.passNum = LEGACY_RESCAN_PASS_BASE + phase
  if (phase === 1) {
    state.step = Math.max(1, Math.ceil(span / LEGACY_RESCAN_DIVISORS[0]))
  } else if (phase === 2) {
    state.step = Math.max(1, Math.ceil(span / LEGACY_RESCAN_DIVISORS[1]))
  } else {
    state.step = Math.max(1, Math.ceil(span / LEGACY_RESCAN_DIVISORS[2]))
  }
}

function kingOfTheHillNeedsRescan(state) {
  return state.bestAlt != null && state.bestAlt < KING_MAIN_PEAK_ALTITUDE
}

function kingOfTheHillMaybeRescan(state) {
  if (!kingOfTheHillNeedsRescan(state)) return false
  if (state.rescanPhase >= LEGACY_RESCAN_PHASES) return false
  kingOfTheHillStartRescan(state, state.rescanPhase + 1)
  return true
}

function parseKingOfTheHillAltitude(feedback, message) {
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

function kingOfTheHillBuildFinals(state) {
  const span = state.max - state.min
  const out = []
  if (span <= LEGACY_FINALS_TINY_SPAN) {
    for (let d = 0; d <= span; d++) {
      if (d === 0) {
        if (state.bestVal >= state.min && state.bestVal <= state.max) out.push(state.bestVal)
        continue
      }
      for (const sign of [-1, 1]) {
        const c = state.bestVal + sign * d
        if (c >= state.min && c <= state.max) out.push(c)
      }
    }
    return out
  }

  const nearMainPeak = state.bestAlt != null && state.bestAlt >= KING_MAIN_PEAK_ALTITUDE
  const maxRadius = nearMainPeak
    ? LEGACY_FINAL_MAIN_RADIUS
    : Math.min(LEGACY_FINAL_SIDE_MAX_RADIUS, Math.max(LEGACY_FINAL_SIDE_MIN_RADIUS, Math.ceil(span / LEGACY_FINAL_SIDE_SPAN_DIVISOR)))
  for (let d = 0; d <= maxRadius; d++) {
    if (d === 0) {
      if (state.bestVal >= state.min && state.bestVal <= state.max) out.push(state.bestVal)
      continue
    }
    for (const sign of [-1, 1]) {
      const c = state.bestVal + sign * d
      if (c >= state.min && c <= state.max) out.push(c)
    }
  }
  return out
}

function initKingOfTheHillState(details) {
  const min = 10 ** (details.passwordLength - 1)
  const max = 10 ** details.passwordLength - 1
  const step = Math.max(1, Math.ceil((max - min) / LEGACY_INITIAL_SWEEP_DIVISOR))
  return {
    type: "kingOfTheHill",
    min,
    max,
    bestVal: min,
    bestAlt: null,
    step,
    sweepIdx: min,
    sweepEnd: max,
    passNum: 0,
    finished: false,
    finals: [],
    finalIdx: 0,
    dispatched: false,
    rescanPhase: 0,
  }
}

function kingOfTheHillNextGuess(state) {
  if (state.dispatched) return null

  while (state.sweepIdx > state.sweepEnd) {
    if ((state.bestAlt == null || state.bestAlt <= 0) && state.passNum === 0) {
      state.sweepIdx = state.min
      state.sweepEnd = state.max
      state.step = 1
      state.passNum = LEGACY_BRUTE_FORCE_PASS
      continue
    }

    if (kingOfTheHillMaybeRescan(state)) continue

    const prevStep = state.step
    state.step = Math.max(1, Math.ceil(prevStep / LEGACY_ZOOM_STEP_DIVISOR))
    if (state.step >= prevStep) {
      if (kingOfTheHillMaybeRescan(state)) continue
      state.finished = true
      break
    }
    state.sweepIdx = Math.max(state.min, state.bestVal - prevStep)
    state.sweepEnd = Math.min(state.max, state.bestVal + prevStep)
    state.passNum++
  }

  if (!state.finished) {
    const g = state.sweepIdx
    return { guess: String(g), detail: `p${state.passNum}-${g}` }
  }

  if (state.finals.length === 0) {
    state.finals = kingOfTheHillBuildFinals(state)
  }
  if (state.finalIdx < state.finals.length) {
    const c = state.finals[state.finalIdx]
    return { guess: String(c), detail: `final ${c}` }
  }
  return null
}

function kingOfTheHillApplyResult(state, guess, result) {
  if (result.success) return state
  if (!state.finished) {
    state.sweepIdx += state.step
  } else if (state.finalIdx < state.finals.length) {
    state.finalIdx++
  }
  const g = Number(guess)
  const alt = parseKingOfTheHillAltitude(result.feedback, result.message)
  if (alt == null) return state
  if (state.bestAlt == null || alt > state.bestAlt) {
    state.bestAlt = alt
    state.bestVal = g
  }
  return state
}

export function runSolver(assignment) {
  return runSolverLegacy(assignment)
}

/** Game hill count from server difficulty (authentication.ts). */
export function kingOfTheHillHillCount(difficulty) {
  return Math.min(Math.floor(difficulty / KOTH_HILL_DIFFICULTY_DIVISOR), KOTH_HILL_DIFFICULTY_CAP) * 2 + 1
}

/** Gaussian width from password string length (authentication.ts). */
export function kingOfTheHillGaussianWidth(passwordLength) {
  return 10 ** Math.max(passwordLength - KOTH_GAUSS_WIDTH_LENGTH_OFFSET, 0) + KOTH_GAUSS_WIDTH_PLUS
}

/** Max distance from any hill center to the farthest hill in the cluster. */
export function kingOfTheHillClusterHalfWidth(hillCount, passwordLength, clusterMargin = getDefaultImprovedConfig().clusterMargin) {
  const width = kingOfTheHillGaussianWidth(passwordLength)
  return Math.ceil((hillCount - 1) * width * KOTH_HILL_SPACING_WIDTHS * clusterMargin)
}

function clusterSearchWindow(fullMin, fullMax, center, hillCount, passwordLength, cfg) {
  const half = kingOfTheHillClusterHalfWidth(hillCount, passwordLength, cfg.clusterMargin)
  return {
    min: Math.max(fullMin, center - half),
    max: Math.min(fullMax, center + half),
  }
}

/** Cluster window while hunting side hills; local Gaussian span once on the main peak. */
function improvedSearchWindow(fullMin, fullMax, session, hillCount, passwordLength, gaussWidth, cfg) {
  if (session.bestAlt >= KING_MAIN_PEAK_ALTITUDE) {
    const half = gaussWidth * KOTH_HILL_SPACING_WIDTHS
    return {
      min: Math.max(fullMin, session.bestVal - half),
      max: Math.min(fullMax, session.bestVal + half),
    }
  }
  if (session.bestAlt > cfg.clusterDetectAlt) {
    return clusterSearchWindow(fullMin, fullMax, session.bestVal, hillCount, passwordLength, cfg)
  }
  return { min: fullMin, max: fullMax }
}

function createProbeSession(server, min, max) {
  const samples = new Map()
  const session = {
    guesses: 0,
    solved: false,
    bestVal: min,
    bestAlt: -1,
    samples,
    probe(x) {
      const xi = Math.round(x)
      if (xi < min || xi > max) return null
      if (samples.has(xi)) return { alt: samples.get(xi), cached: true }
      session.guesses++
      const result = authKingOfTheHill(server, String(xi))
      if (result.success) {
        session.solved = true
        return { alt: Infinity, cached: false }
      }
      const alt = parseKingOfTheHillAltitude(result.feedback, result.message) ?? -1
      samples.set(xi, alt)
      if (alt > session.bestAlt) {
        session.bestAlt = alt
        session.bestVal = xi
      }
      return { alt, cached: false }
    },
    sweep(start, end, step, stopAlt) {
      if (step <= 0) step = 1
      for (let x = start; x <= end; x += step) {
        session.probe(x)
        if (session.solved) return
        if (stopAlt != null && session.bestAlt >= stopAlt) return
      }
      if (end >= start && end <= max && !samples.has(end)) {
        session.probe(end)
        if (session.solved) return
        if (stopAlt != null && session.bestAlt >= stopAlt) return
      }
    },
    sortedSamples() {
      return [...samples.entries()].sort((a, b) => a[0] - b[0])
    },
  }
  return session
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
    const [x, alt] = sorted[i]
    if (alt >= sorted[i - 1][1] && alt > sorted[i + 1][1]) peaks.push({ x, alt })
  }
  let best = sorted[0]
  for (const row of sorted) {
    if (row[1] > best[1]) best = row
  }
  peaks.push({ x: best[0], alt: best[1] })
  peaks.sort((a, b) => b.alt - a.alt)
  const seen = new Set()
  return peaks.filter((p) => {
    if (seen.has(p.x)) return false
    seen.add(p.x)
    return true
  })
}

function refinePeak(session, min, max, center, initialRadius, passes, cfg) {
  let c = center
  let r = Math.max(1, initialRadius)
  for (let p = 0; p < passes; p++) {
    const x0 = Math.max(min, c - r)
    const x2 = Math.min(max, c + r)
    const x1 = c
    const y0 = session.probe(x0)?.alt ?? -1
    if (session.solved) return c
    const y1 = session.probe(x1)?.alt ?? -1
    if (session.solved) return c
    const y2 = session.probe(x2)?.alt ?? -1
    if (session.solved) return c
    const peak = parabolicPeak(x0, y0, x1, y1, x2, y2, cfg)
    c = Math.round(Math.max(min, Math.min(max, peak)))
    r = Math.max(1, Math.ceil(r / cfg.refineStepShrink))
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

function tryFinalCandidates(session, min, max, bestVal, bestAlt) {
  const finals = kingOfTheHillBuildFinals({ min, max, bestVal, bestAlt })
  for (const c of finals) {
    session.probe(c)
    if (session.solved) return
  }
}

function refinePeakCount(session, hillCount, cfg) {
  if (session.bestAlt >= cfg.mainPeakModeAlt) return cfg.refinePeakCountMain
  return hillCount
}

/** Dyadic subdivision: midpoint, quarters, eighths, ... (quickRounds max). */
function findHillBySubdivision(session, lo, hi, quickRounds, cfg) {
  let step = hi - lo
  for (let round = 0; round < quickRounds && !session.solved; round++) {
    const nextStep = Math.max(1, Math.ceil(step / 2))
    if (nextStep >= step) break
    step = nextStep
    for (let x = lo + step; x < hi; x += step) {
      session.probe(Math.round(x))
      if (session.solved) return
    }
    if (session.bestAlt >= cfg.mainPeakModeAlt) return
  }
}

function findHillLinearFallback(session, lo, hi, hillCount, cfg) {
  const span = hi - lo
  const step = Math.max(1, Math.ceil(span / Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)))
  session.sweep(lo, hi, step, cfg.mainPeakModeAlt)
}

/** Hill-climb on the main peak with shrinking step. */
function tryHillClimbFinals(session, searchMin, searchMax, gaussWidth, fullMin, fullMax, cfg) {
  let step = Math.max(1, Math.ceil(gaussWidth / cfg.hillClimbInitialDivisor))
  let x = session.bestVal

  while (step >= 1 && !session.solved) {
    const left = Math.max(searchMin, x - step)
    const right = Math.min(searchMax, x + step)
    const yL = session.probe(left)?.alt ?? -1
    if (session.solved) return
    const yC = left === right ? yL : session.probe(x)?.alt ?? -1
    if (session.solved) return
    const yR = session.probe(right)?.alt ?? -1
    if (session.solved) return

    if (yL > yC) x = left
    else if (yR > yC) x = right

    const flat =
      Math.abs(yL - yC) <= cfg.hillClimbFlatAltDelta &&
      Math.abs(yR - yC) <= cfg.hillClimbFlatAltDelta
    if (flat || (yC >= yL && yC >= yR)) {
      const nextStep = Math.max(1, Math.ceil(step / cfg.hillClimbShrink))
      if (nextStep >= step) break
      step = nextStep
    }
  }

  tryFinalCandidates(session, fullMin, fullMax, session.bestVal, session.bestAlt)
}

/** Grid zoom fallback when hill-climb stalls on a flat 10k plateau. */
function tryZoomFinals(session, searchMin, searchMax, fullMin, fullMax, cfg) {
  let step = Math.max(1, Math.ceil((searchMax - searchMin) / cfg.zoomInitialDivisor))
  for (let pass = 0; pass < cfg.zoomMaxPasses && !session.solved; pass++) {
    const lo = Math.max(searchMin, session.bestVal - step)
    const hi = Math.min(searchMax, session.bestVal + step)
    session.sweep(lo, hi, Math.max(1, Math.ceil(step / cfg.zoomStepDivisor)))
    if (session.solved) return
    tryFinalCandidates(session, fullMin, fullMax, session.bestVal, session.bestAlt)
    if (session.solved) return
    const nextStep = Math.max(1, Math.ceil(step / cfg.zoomStepDivisor))
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
      Math.max(1, Math.ceil(refineRadius / cfg.refineRadiusShrink)),
      cfg.refineFinePasses,
      cfg,
    )
    if (session.solved) return true
  }
  return session.solved
}

/**
 * Peak-picking + parabolic refinement using known hill count and Gaussian width.
 * Standalone — does not call the legacy state machine.
 */
export function runSolverImproved(assignment, options = {}) {
  const cfg = normalizeImprovedConfig(options.improvedConfig)
  const server = toServer(assignment)
  const { min, max } = assignmentNumericRange(assignment)
  const hillCount = kingOfTheHillHillCount(assignment.difficulty)
  const gaussWidth = kingOfTheHillGaussianWidth(assignment.passwordLength)
  const session = createProbeSession(server, min, max)

  findHillBySubdivision(session, min, max, cfg.findHillQuickRounds, cfg)
  if (!session.solved && session.bestAlt < KING_MAIN_PEAK_ALTITUDE) {
    let fallbackLo = min
    let fallbackHi = max
    if (session.bestAlt >= cfg.clusterDetectAlt) {
      const win = clusterSearchWindow(min, max, session.bestVal, hillCount, assignment.passwordLength, cfg)
      fallbackLo = win.min
      fallbackHi = win.max
    }
    findHillLinearFallback(session, fallbackLo, fallbackHi, hillCount, cfg)
  }
  if (session.solved) return finishSession(session, options)

  let { min: searchMin, max: searchMax } = improvedSearchWindow(
    min,
    max,
    session,
    hillCount,
    assignment.passwordLength,
    gaussWidth,
    cfg,
  )
  let searchSpan = searchMax - searchMin
  let coarseStep = Math.max(
    1,
    Math.ceil(searchSpan / Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)),
  )

  for (const divisor of improvedRescanDivisors(cfg)) {
    if (session.bestAlt >= cfg.centroidMinAlt) break
    if (session.bestAlt >= cfg.mainPeakModeAlt) break
    ;({ min: searchMin, max: searchMax } = improvedSearchWindow(
      min,
      max,
      session,
      hillCount,
      assignment.passwordLength,
      gaussWidth,
      cfg,
    ))
    searchSpan = searchMax - searchMin
    session.sweep(
      searchMin,
      searchMax,
      Math.max(1, Math.ceil(searchSpan / divisor)),
      cfg.mainPeakModeAlt,
    )
    if (session.solved) return finishSession(session, options)
  }

  ;({ min: searchMin, max: searchMax } = improvedSearchWindow(
    min,
    max,
    session,
    hillCount,
    assignment.passwordLength,
    gaussWidth,
    cfg,
  ))
  searchSpan = searchMax - searchMin
  coarseStep = Math.max(
    1,
    Math.ceil(searchSpan / Math.max(cfg.coarseMinDivisor, hillCount * cfg.coarseHillFactor)),
  )

  let peaks = findLocalPeaks(session.sortedSamples())
  let refineRadius = Math.max(coarseStep, Math.ceil(searchSpan / (hillCount * cfg.refineSpanHillDivisor)))
  refinePeakCandidates(session, searchMin, searchMax, peaks, refineRadius, refinePeakCount(session, hillCount, cfg), cfg)
  if (session.solved) return finishSession(session, options)

  if (session.bestAlt < KING_MAIN_PEAK_ALTITUDE) {
    ;({ min: searchMin, max: searchMax } = improvedSearchWindow(
      min,
      max,
      session,
      hillCount,
      assignment.passwordLength,
      gaussWidth,
      cfg,
    ))
    session.sweep(
      searchMin,
      searchMax,
      Math.max(1, Math.ceil(gaussWidth / cfg.sideHillSweepWidthDivisor)),
      KING_MAIN_PEAK_ALTITUDE,
    )
    if (session.solved) return finishSession(session, options)
    peaks = findLocalPeaks(session.sortedSamples())
    refineRadius = Math.max(1, Math.ceil(gaussWidth))
    refinePeakCandidates(session, searchMin, searchMax, peaks, refineRadius, refinePeakCount(session, hillCount, cfg), cfg)
    if (session.solved) return finishSession(session, options)
  }

  if (session.bestAlt >= cfg.centroidMinAlt) {
    ;({ min: searchMin, max: searchMax } = improvedSearchWindow(
      min,
      max,
      session,
      hillCount,
      assignment.passwordLength,
      gaussWidth,
      cfg,
    ))
    const centroid = weightedCentroid(session, session.bestAlt * cfg.centroidAltFraction)
    if (centroid != null) {
      session.probe(centroid)
      if (!session.solved) {
        refinePeak(session, searchMin, searchMax, centroid, cfg.centroidRefineRadius, cfg.centroidRefinePasses, cfg)
      }
    }
  }

  if (!session.solved) tryFinalCandidates(session, min, max, session.bestVal, session.bestAlt)
  if (!session.solved && session.bestAlt >= KING_MAIN_PEAK_ALTITUDE) {
    const climbWindow = clusterSearchWindow(min, max, session.bestVal, hillCount, assignment.passwordLength, cfg)
    tryHillClimbFinals(session, climbWindow.min, climbWindow.max, gaussWidth, min, max, cfg)
    if (!session.solved) {
      tryZoomFinals(session, climbWindow.min, climbWindow.max, min, max, cfg)
    }
    if (!session.solved) tryFinalCandidates(session, min, max, session.bestVal, session.bestAlt)
  }
  return finishSession(session, options)
}

/** Score a config on a batch of assignments (lower totalGuesses is better). */
export function evaluateImprovedConfig(assignments, configOverrides = {}) {
  const cfg = normalizeImprovedConfig(configOverrides)
  let totalGuesses = 0
  let solved = 0
  let maxGuesses = 0
  let minGuesses = Infinity
  const failed = []

  for (let i = 0; i < assignments.length; i++) {
    const result = runSolverImproved(assignments[i], { improvedConfig: cfg })
    if (result.solved) {
      solved++
      totalGuesses += result.guesses
      maxGuesses = Math.max(maxGuesses, result.guesses)
      minGuesses = Math.min(minGuesses, result.guesses)
    } else {
      failed.push(i + 1)
    }
  }

  const count = assignments.length
  const unsolved = count - solved
  return {
    config: cfg,
    solved,
    total: count,
    unsolved,
    failed,
    totalGuesses: unsolved > 0 ? null : totalGuesses,
    avgGuesses: unsolved > 0 ? null : totalGuesses / count,
    maxGuesses: unsolved > 0 ? null : maxGuesses,
    minGuesses: unsolved > 0 ? null : minGuesses,
    fitness: unsolved > 0 ? Number.MAX_SAFE_INTEGER - unsolved * 1e6 + totalGuesses : totalGuesses,
  }
}

function finishSession(session, options = {}) {
  const result = {
    guesses: session.guesses,
    solved: session.solved,
    bestVal: session.bestVal,
    bestAlt: session.bestAlt >= 0 ? session.bestAlt : null,
  }
  if (options.returnSamples) {
    result.probes = [...session.samples.entries()].map(([x, alt]) => ({ x, alt }))
  }
  return result
}

export function runSolverLegacy(assignment) {
  const server = toServer(assignment)
  let state = initKingOfTheHillState({ passwordLength: assignment.passwordLength })
  let guesses = 0
  let solved = false

  while (true) {
    const next = kingOfTheHillNextGuess(state)
    if (!next) break
    guesses++
    const result = authKingOfTheHill(server, next.guess)
    state = kingOfTheHillApplyResult(state, next.guess, result)
    if (result.success) {
      solved = true
      break
    }
  }

  return { guesses, solved, bestVal: state.bestVal, bestAlt: state.bestAlt }
}
