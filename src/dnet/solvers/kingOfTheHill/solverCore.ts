export const KOTH_PEAK_HEIGHT = 10000
export const KOTH_HILL_SPACING_WIDTHS = 3
export const KOTH_HILL_DIFFICULTY_DIVISOR = 8
export const KOTH_HILL_DIFFICULTY_CAP = 4
export const KOTH_HEIGHT_OFFSET_BASE = 2600
export const KOTH_GAUSS_WIDTH_LENGTH_OFFSET = 2
export const KOTH_GAUSS_WIDTH_PLUS = 1
export const SOLVER_MAX_PROBES = 600

export { DEFAULT_LADDER_SNIPE_TUNING, TUNED_LADDER_SNIPE_DIFF60, type LadderSnipeTuning } from "./tuning.js"
export { runSolverCoreLadderSnipe } from "./ladderSnipeSolver.js"

import { runSolverCoreLadderSnipe } from "./ladderSnipeSolver.js"
import { TUNED_LADDER_SNIPE_DIFF60, type LadderSnipeTuning } from "./tuning.js"

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
  restoreBest(x: number, a: number): void
}

export interface SolverContext {
  min: number
  max: number
  hillCount: number
  passwordLength: number
  gaussWidth: number
  /** Ladder_snipe heuristic constants; defaults to GA-tuned diff-60 values. */
  tuning: LadderSnipeTuning
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
  tuning?: LadderSnipeTuning
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
    restoreBest(x: number, a: number) {
      session.bestVal = x
      session.bestAlt = a
    },
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
    restoreBest(x: number, a: number) {
      session.bestVal = x
      session.bestAlt = a
    },
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
    runSolverCoreLadderSnipe(session, ctx.min, ctx.max, ctx.gaussWidth, ctx.hillCount, ctx.tuning)
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

/** Run ladder_snipe_tuned (GA diff-60 constants) synchronously with a caller-supplied auth callback. */
export function runSolverImproved(
  assignment: KingOfTheHillAssignment,
  options: {
    auth: (guess: string) => SolverAuthResult
    returnSamples?: boolean
    tuning?: LadderSnipeTuning
  },
): SolverRunResult {
  const { min, max } = numericRange(assignment.passwordLength)
  const tuning = options.tuning ?? TUNED_LADDER_SNIPE_DIFF60
  const session = createAuthProbeSession(min, max, options.auth)
  runSolverCoreLadderSnipe(session, min, max, kingOfTheHillGaussianWidth(assignment.passwordLength), kingOfTheHillHillCount(assignment.difficulty), tuning)
  const result: SolverRunResult = {
    guesses: session.guesses,
    solved: session.solved,
    bestVal: session.bestVal,
    bestAlt: session.bestAlt,
  }
  if (options.returnSamples === true) result.samples = session.samples
  return result
}

export function buildSolverContext(assignment: KingOfTheHillAssignment, tuning?: LadderSnipeTuning): SolverContext {
  const { min, max } = numericRange(assignment.passwordLength)
  return {
    min,
    max,
    hillCount: kingOfTheHillHillCount(assignment.difficulty),
    passwordLength: assignment.passwordLength,
    gaussWidth: kingOfTheHillGaussianWidth(assignment.passwordLength),
    tuning: tuning ?? TUNED_LADDER_SNIPE_DIFF60,
  }
}
