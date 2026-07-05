/**
 * KingOfTheHill test harness (bitburner-src game model + assignment generation).
 * Solver logic is imported from src/dnet/solvers/kingOfTheHill/ (in-game source).
 *
 * Source for this module. Rebuild bundle before sim or viz:
 *   pnpm run test:koth:bundle
 *
 * Sim:  pnpm run test:koth
 * Viz:  pnpm dlx serve tests  ->  /kingOfTheHillViz.html
 */

import {
  computeImprovedFitness,
  finalizeImprovedConfig,
  getTunedBenchmark,
  getTunedImprovedConfig,
  getTunedJsonScores,
  TUNED_AVG_CONFIG,
  TUNED_MAX_CONFIG,
  type FitnessObjective,
  type ImprovedConfig,
  type TunedBenchmarkMeta,
} from "../src/dnet/solvers/kingOfTheHill/config.js"
import {
  KOTH_GAUSS_WIDTH_LENGTH_OFFSET,
  KOTH_GAUSS_WIDTH_PLUS,
  KOTH_HILL_DIFFICULTY_CAP,
  KOTH_HILL_DIFFICULTY_DIVISOR,
  KOTH_HILL_SPACING_WIDTHS,
  KOTH_PEAK_HEIGHT,
  kingOfTheHillGaussianWidth,
  kingOfTheHillHillCount,
  runSolverImproved as runSolverImprovedWithAuth,
} from "../src/dnet/solvers/kingOfTheHill/solverCore.js"

export {
  computeImprovedFitness,
  finalizeImprovedConfig,
  getTunedBenchmark,
  getTunedImprovedConfig,
  getTunedJsonScores,
  kingOfTheHillGaussianWidth,
  kingOfTheHillHillCount,
  TUNED_AVG_CONFIG,
  TUNED_MAX_CONFIG,
}

export type { TunedBenchmarkMeta }

export type ImprovedSolverConfig = ImprovedConfig

export const getDefaultImprovedConfig = () => getTunedImprovedConfig("max")

export const NUMBERS = "0123456789"
export const MAX_PASSWORD_LENGTH = 50
/** Difficulty 54+ -> 10-digit passwords; 32+ -> 9 Gaussian hills (max). */
export const DEFAULT_DIFFICULTY = 60
export const DEFAULT_COUNT = 10
export const DEFAULT_SEED = 0x4b6f7468 // "Koth"
export const KING_MAIN_PEAK_ALTITUDE = 7500

export const KOTH_NEAR_ZONE_FRACTION = 0.03
export const KOTH_LOCATION_JITTER_SCALE = 0.2
export const KOTH_LOCATION_JITTER_BASE = 0.9
export const KOTH_HEIGHT_OFFSET_BASE = 2600
export const KOTH_HEIGHT_JITTER_SCALE = 0.1
export const KOTH_HEIGHT_JITTER_BASE = 0.95

export { KOTH_PEAK_HEIGHT, KOTH_HILL_SPACING_WIDTHS }

export const ASSIGNMENT_PASSWORD_LENGTH_DIVISOR = 6
export const ASSIGNMENT_PASSWORD_LENGTH_CAP = 10
export const ASSIGNMENT_SEED_STRIDE = 9973
export const ASSIGNMENT_MAX_SAFE_PASSWORD_DIGITS = 15

export const PROFILE_DEFAULT_POINT_COUNT = 800

export interface KingOfTheHillAssignment {
  difficulty: number
  password: string
  passwordLength: number
  modelId: string
  staticPasswordHint: string
}

export interface KingOfTheHillServer {
  password: string
  difficulty: number
}

export interface SolverProbe {
  x: number
  alt: number
}

export interface SolverResult {
  guesses: number
  solved: boolean
  bestVal: number
  bestAlt: number | null
  probes?: SolverProbe[]
}

class WHRNG {
  s1: number
  s2: number
  s3: number

  constructor(totalPlaytime: number) {
    const v = (totalPlaytime / 1000) % 30000
    this.s1 = v
    this.s2 = v
    this.s3 = v
  }

  step(): void {
    this.s1 = (171 * this.s1) % 30269
    this.s2 = (172 * this.s2) % 30307
    this.s3 = (170 * this.s3) % 30323
  }

  random(): number {
    this.step()
    return (this.s1 / 30269.0 + this.s2 / 30307.0 + this.s3 / 30323.0) % 1.0
  }
}

function getAltitudeGivenHillSpecs(x: number, location: number, height: number, width: number): number {
  return height * Math.exp(((x - location) ** 2 / width ** 2) * -1)
}

/** Same as getKingOfTheHillAltitude(server, attemptedPassword) in bitburner-src. */
export function getKingOfTheHillAltitude(server: KingOfTheHillServer, attemptedPassword: string): number {
  const password = Number(server.password)
  const x = Number(attemptedPassword)
  const rng = new WHRNG(password)
  const hillCount =
    Math.min(Math.floor(server.difficulty / KOTH_HILL_DIFFICULTY_DIVISOR), KOTH_HILL_DIFFICULTY_CAP) * 2 + 1
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

export function authKingOfTheHill(server: KingOfTheHillServer, attemptedPassword: string) {
  if (server.password === attemptedPassword) {
    return { success: true as const }
  }
  const altitude = getKingOfTheHillAltitude(server, attemptedPassword)
  const message = `current altitude: ${altitude.toFixed(5)} m; highest peak: ${KOTH_PEAK_HEIGHT.toLocaleString()} m`
  return { success: false as const, feedback: `${altitude}`, message }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function getPasswordSeeded(length: number, rng: () => number, allowLetters = false): string {
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

export function buildAssignment(difficulty: number, rng: () => number): KingOfTheHillAssignment {
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

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function assignmentNumericRange(assignment: Pick<KingOfTheHillAssignment, "passwordLength">) {
  const min = 10 ** (assignment.passwordLength - 1)
  const max = 10 ** assignment.passwordLength - 1
  return { min, max }
}

export function toServer(assignment: Pick<KingOfTheHillAssignment, "password" | "difficulty">): KingOfTheHillServer {
  return { password: assignment.password, difficulty: assignment.difficulty }
}

export function sampleAltitudeProfile(
  assignment: KingOfTheHillAssignment,
  options: { pointCount?: number } = {},
) {
  const pointCount = options.pointCount ?? PROFILE_DEFAULT_POINT_COUNT
  const password = Number(assignment.password)
  const { min, max } = assignmentNumericRange(assignment)
  const server = toServer(assignment)
  const start = min
  const end = max

  const step = Math.max(1, Math.ceil((end - start) / pointCount))
  const points: { x: number; altitude: number; nearZone: boolean }[] = []
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

export function generateAssignments(seed: number, count: number, difficulty: number) {
  const rows: { index: number; assignment: KingOfTheHillAssignment }[] = []
  for (let i = 0; i < count; i++) {
    const rng = mulberry32((seed + i * ASSIGNMENT_SEED_STRIDE) >>> 0)
    rows.push({ index: i + 1, assignment: buildAssignment(difficulty, rng) })
  }
  return rows
}

export function runSolver(
  assignment: KingOfTheHillAssignment,
  options: { returnSamples?: boolean; improvedConfig?: ImprovedConfig; objective?: FitnessObjective } = {},
): SolverResult {
  return runSolverImproved(assignment, options)
}

export function kingOfTheHillClusterHalfWidth(
  hillCount: number,
  passwordLength: number,
  clusterMargin = getDefaultImprovedConfig().clusterMargin,
): number {
  const width = kingOfTheHillGaussianWidth(passwordLength)
  return Math.ceil((hillCount - 1) * width * KOTH_HILL_SPACING_WIDTHS * clusterMargin)
}

export function runSolverImproved(
  assignment: KingOfTheHillAssignment,
  options: {
    returnSamples?: boolean
    improvedConfig?: ImprovedConfig
    objective?: FitnessObjective
  } = {},
): SolverResult {
  const server = toServer(assignment)
  const improvedConfig = options.improvedConfig ?? getTunedImprovedConfig(options.objective ?? "max")
  const raw = runSolverImprovedWithAuth(assignment, {
    improvedConfig,
    auth: (guess) => authKingOfTheHill(server, guess),
    returnSamples: options.returnSamples === true,
  })
  const result: SolverResult = {
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

export function improvedConfigFitness({
  objective = "avg",
  unsolved,
  totalGuesses = 0,
  maxGuesses = 0,
}: {
  objective?: FitnessObjective
  unsolved: number
  totalGuesses?: number
  maxGuesses?: number
}): number {
  return computeImprovedFitness(objective, unsolved, totalGuesses, maxGuesses)
}

export function evaluateImprovedConfig(
  assignments: KingOfTheHillAssignment[],
  configOverrides: Partial<ImprovedConfig> = {},
  objective: FitnessObjective = "avg",
) {
  const base = objective === "avg" ? TUNED_AVG_CONFIG : TUNED_MAX_CONFIG
  const cfg = finalizeImprovedConfig({ ...base, ...configOverrides })
  let totalGuesses = 0
  let solved = 0
  let maxGuesses = 0
  let minGuesses = Infinity
  const failed: number[] = []

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

export interface TunedBenchmarkVerifyResult {
  ok: boolean
  objective: FitnessObjective
  benchmark: TunedBenchmarkMeta | null
  checked: number
  unsolved: number
  jsAvgGuesses: number | null
  jsMaxGuesses: number | null
  jsTotalGuesses: number | null
  jsonAvgGuesses: number | null
  jsonMaxGuesses: number | null
  jsonTotalGuesses: number | null
}

export function runTunedBenchmarkAssignments(objective: FitnessObjective = "max") {
  const benchmark = getTunedBenchmark(objective)
  if (benchmark == null) return null
  return generateAssignments(benchmark.seed, benchmark.count, benchmark.difficulty)
}

export function verifyTunedConfigBenchmark(objective: FitnessObjective = "max"): TunedBenchmarkVerifyResult {
  const benchmark = getTunedBenchmark(objective)
  const jsonScores = getTunedJsonScores(objective)
  const cfg = getTunedImprovedConfig(objective)
  const result: TunedBenchmarkVerifyResult = {
    ok: false,
    objective,
    benchmark,
    checked: 0,
    unsolved: 0,
    jsAvgGuesses: null,
    jsMaxGuesses: null,
    jsTotalGuesses: null,
    jsonAvgGuesses: jsonScores.avgGuesses,
    jsonMaxGuesses: jsonScores.maxGuesses,
    jsonTotalGuesses: jsonScores.totalGuesses,
  }
  if (benchmark == null) return result

  const rows = generateAssignments(benchmark.seed, benchmark.count, benchmark.difficulty)
  let totalGuesses = 0
  let maxGuesses = 0
  let solved = 0

  for (const { assignment } of rows) {
    result.checked++
    const run = runSolverImproved(assignment, { improvedConfig: cfg, objective })
    if (run.solved) {
      solved++
      totalGuesses += run.guesses
      maxGuesses = Math.max(maxGuesses, run.guesses)
    }
  }

  result.unsolved = result.checked - solved
  if (solved === result.checked) {
    result.jsAvgGuesses = totalGuesses / solved
    result.jsMaxGuesses = maxGuesses
    result.jsTotalGuesses = totalGuesses
  }

  const sameNumber = (a: number | null, b: number | null) =>
    a != null && b != null && Math.abs(a - b) < 1e-6

  result.ok =
    result.unsolved === 0 &&
    sameNumber(result.jsAvgGuesses, result.jsonAvgGuesses) &&
    result.jsMaxGuesses === result.jsonMaxGuesses &&
    result.jsTotalGuesses === result.jsonTotalGuesses

  return result
}
