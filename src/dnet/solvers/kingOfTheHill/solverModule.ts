import type { ServerDetails } from "../../types.js"
import type { GuessRequest, GuessResult, SolverModule, SolverState } from "../types.js"
import {
  kingOfTheHillGaussianWidth,
  kingOfTheHillHillCount,
  parseKingOfTheHillAltitude,
  runUntilNextProbe,
  TUNED_LADDER_SNIPE_DIFF60,
  type SolverContext,
} from "./solverCore.js"

interface KingOfTheHillState extends SolverState {
  type: "kingOfTheHill"
  min: number
  max: number
  samples: Map<number, number>
  bestVal: number
  bestAlt: number | null
  solved: boolean
  dispatched: boolean
  ctx: SolverContext
}

function buildContext(details: ServerDetails): { min: number; max: number; ctx: SolverContext } {
  let min = 10 ** (details.passwordLength - 1)
  const max = 10 ** details.passwordLength - 1
  if (details.passwordLength === 1) min = 0
  const ctx: SolverContext = {
    min,
    max,
    hillCount: kingOfTheHillHillCount(details.difficulty),
    passwordLength: details.passwordLength,
    gaussWidth: kingOfTheHillGaussianWidth(details.passwordLength),
    tuning: TUNED_LADDER_SNIPE_DIFF60,
  }
  return { min, max, ctx }
}

export const kingOfTheHillImprovedSolver: SolverModule<KingOfTheHillState> = {
  init(details) {
    const { min, max, ctx } = buildContext(details)
    return {
      type: "kingOfTheHill",
      min,
      max,
      samples: new Map(),
      bestVal: min,
      bestAlt: null,
      solved: false,
      dispatched: false,
      ctx,
    }
  },

  nextGuess(state) {
    if (state.dispatched || state.solved) return null
    const next = runUntilNextProbe(state.samples, state.ctx)
    if (next.type === "probe") {
      state.dispatched = true
      return { guess: String(next.x), detail: `koth-${next.x}` }
    }
    state.solved = next.solved
    return null
  },

  applyResult(state, guess, result) {
    state.dispatched = false
    if (result.success) {
      state.solved = true
      return state
    }
    const g = Number(guess)
    const alt = parseKingOfTheHillAltitude(result.feedback, result.message)
    if (alt != null) {
      state.samples.set(g, alt)
      if (state.bestAlt == null || alt > state.bestAlt) {
        state.bestAlt = alt
        state.bestVal = g
      }
    }
    return state
  },
}

export type { KingOfTheHillState }
