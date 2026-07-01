import type { ServerDetails } from "../types.js"

export interface SolverState {
  type: string
}

export interface GuessRequest {
  guess: string
  detail: string | null
}

export interface GuessResult {
  success: boolean
  feedback?: string
  message?: string
}

export interface SolverContext {
  target: string
  details: ServerDetails
  /** Labyrinth explorers: game tracks maze position per worker PID. */
  workerHost?: string
}

export interface SolverModule<S extends SolverState = SolverState> {
  init(details: ServerDetails): S
  nextGuess(state: S, ctx: SolverContext): GuessRequest | null
  applyResult(state: S, guess: string, result: GuessResult, ctx?: SolverContext): S
  applyHeartbleed?(state: S, logs: string[]): S
}

export function solverStateId(state: SolverState): string {
  return state.type
}
