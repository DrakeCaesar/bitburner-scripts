import type { ServerDetails } from "../../types.js"
import type { GuessRequest, GuessResult, SolverModule, SolverState } from "../types.js"
import { getTunedImprovedConfig, type ImprovedConfig } from "./config.js"
import {
  kingOfTheHillGaussianWidth,
  kingOfTheHillHillCount,
  parseKingOfTheHillAltitude,
  runUntilNextProbe,
  type SolverContext,
} from "./solverCore.js"

interface KingOfTheHillState extends SolverState {
  type: "kingOfTheHill"
  min: number
  max: number
  difficulty: number
  passwordLength: number
  samples: Map<number, number>
  bestVal: number
  bestAlt: number | null
  solved: boolean
  dispatched: boolean
  cfg: ImprovedConfig
  ctx: SolverContext
}

function buildContext(details: ServerDetails): { min: number; max: number; ctx: SolverContext } {
  const min = 10 ** (details.passwordLength - 1)
  const max = 10 ** details.passwordLength - 1
  const ctx: SolverContext = {
    min,
    max,
    hillCount: kingOfTheHillHillCount(details.difficulty),
    passwordLength: details.passwordLength,
    gaussWidth: kingOfTheHillGaussianWidth(details.passwordLength),
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
      difficulty: details.difficulty,
      passwordLength: details.passwordLength,
      samples: new Map(),
      bestVal: min,
      bestAlt: null,
      solved: false,
      dispatched: false,
      cfg: getTunedImprovedConfig("max"),
      ctx,
    }
  },

  nextGuess(state) {
    if (state.dispatched || state.solved) return null
    const next = runUntilNextProbe(state.samples, state.ctx, state.cfg)
    if (next.type === "probe") {
      state.dispatched = true
      return { guess: String(next.x), detail: `improved-${next.x}` }
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
