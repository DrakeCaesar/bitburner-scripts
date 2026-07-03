/**
 * Browser Web Worker entry for auth solver computation (no Netscript APIs).
 */
import { SOLVER_MODULES } from "./impl/all.js"
import type { GuessRequest, GuessResult, SolverContext, SolverState } from "./types.js"
import type { ServerDetails } from "../types.js"

type SolverOp = "init" | "nextGuess" | "applyResult" | "applyHeartbleed"

interface WorkerRequest {
  id: number
  op: SolverOp
  solverKey: string
  state?: SolverState
  guess?: string
  result?: GuessResult
  details?: ServerDetails
  ctx?: SolverContext
  logs?: string[]
}

interface WorkerResponse {
  id: number
  state?: SolverState
  guess?: GuessRequest | null
  error?: string
}

onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  try {
    const solver = SOLVER_MODULES[req.solverKey]
    if (!solver) {
      const res: WorkerResponse = { id: req.id, error: `unknown solver key: ${req.solverKey}` }
      postMessage(res)
      return
    }

    switch (req.op) {
      case "init": {
        if (!req.details) {
          postMessage({ id: req.id, error: "init requires details" })
          return
        }
        postMessage({ id: req.id, state: solver.init(req.details) })
        break
      }
      case "nextGuess": {
        if (req.state == null || !req.ctx) {
          postMessage({ id: req.id, error: "nextGuess requires state and ctx" })
          return
        }
        const state = req.state
        const guess = solver.nextGuess(state, req.ctx)
        postMessage({ id: req.id, state, guess })
        break
      }
      case "applyResult": {
        if (req.state == null || req.guess == null || !req.result) {
          postMessage({ id: req.id, error: "applyResult requires state, guess, and result" })
          return
        }
        postMessage({
          id: req.id,
          state: solver.applyResult(req.state, req.guess, req.result, req.ctx),
        })
        break
      }
      case "applyHeartbleed": {
        if (req.state == null || !req.logs) {
          postMessage({ id: req.id, error: "applyHeartbleed requires state and logs" })
          return
        }
        if (!solver.applyHeartbleed) {
          postMessage({ id: req.id, error: "solver does not support applyHeartbleed" })
          return
        }
        postMessage({ id: req.id, state: solver.applyHeartbleed(req.state, req.logs) })
        break
      }
      default:
        postMessage({ id: req.id, error: `unknown op: ${String((req as WorkerRequest).op)}` })
    }
  } catch (err) {
    postMessage({
      id: req.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
