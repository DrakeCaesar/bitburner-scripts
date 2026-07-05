/**
 * KingOfTheHill game + solver logic (bitburner-src accurate).
 * Shared by kingOfTheHillSim.mjs and kingOfTheHillViz.html.
 */

import {
  computeImprovedFitness,
  defaultImprovedConfig,
  getTunedImprovedConfig,
  kingOfTheHillGaussianWidth,
  kingOfTheHillHillCount,
  normalizeImprovedConfig,
  runSolverImproved as runSolverImprovedWithAuth,
  TUNABLE_SPECS as IMPROVED_TUNABLE_SPECS,
  TUNED_AVG_CONFIG,
  TUNED_MAX_CONFIG,
} from "./kingOfTheHillImprovedSolver.mjs"

export {
  computeImprovedFitness,
  defaultImprovedConfig,
  getTunedImprovedConfig,
  IMPROVED_TUNABLE_SPECS,
  kingOfTheHillHillCount,
  kingOfTheHillGaussianWidth,
  normalizeImprovedConfig,
  TUNED_AVG_CONFIG,
  TUNED_MAX_CONFIG,
}

/** @typedef {ReturnType<typeof defaultImprovedConfig>} ImprovedSolverConfig */
export const getDefaultImprovedConfig = defaultImprovedConfig

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

export function runSolver(assignment, options = {}) {
  return runSolverImproved(assignment, options)
}

export function kingOfTheHillClusterHalfWidth(
  hillCount,
  passwordLength,
  clusterMargin = getDefaultImprovedConfig().clusterMargin,
) {
  const width = kingOfTheHillGaussianWidth(passwordLength)
  return Math.ceil((hillCount - 1) * width * KOTH_HILL_SPACING_WIDTHS * clusterMargin)
}

export function runSolverImproved(assignment, options = {}) {
  const server = toServer(assignment)
  const improvedConfig = options.improvedConfig ?? getTunedImprovedConfig(options.objective ?? "max")
  const raw = runSolverImprovedWithAuth(assignment, {
    improvedConfig,
    auth: (guess) => authKingOfTheHill(server, guess),
    returnSamples: options.returnSamples === true,
  })
  const result = {
    guesses: raw.guesses,
    solved: raw.solved,
    bestVal: raw.bestVal,
    bestAlt: raw.bestAlt >= 0 ? raw.bestAlt : null,
  }
  if (options.returnSamples && raw.samples) {
    result.probes = [...raw.samples.entries()].map(([x, alt]) => ({ x, alt }))
  }
  return result
}

export function improvedConfigFitness({ objective = "avg", unsolved, totalGuesses = 0, maxGuesses = 0 }) {
  return computeImprovedFitness(objective, unsolved, totalGuesses, maxGuesses)
}

export function evaluateImprovedConfig(assignments, configOverrides = {}, objective = "avg") {
  const cfg = normalizeImprovedConfig(configOverrides)
  let totalGuesses = 0
  let solved = 0
  let maxGuesses = 0
  let minGuesses = Infinity
  const failed = []

  for (let i = 0; i < assignments.length; i++) {
    const result = runSolverImproved(assignments[i], { improvedConfig: cfg, objective })
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
    fitness: improvedConfigFitness({ objective, unsolved, totalGuesses, maxGuesses }),
  }
}
