// Web Worker - runs solver state machine computation off the main thread.

import {
  SOLVER_REGISTRY,
  bellaCuoreRange,
  lookupSolver,
} from "./solverState.js"
import type {
  SolverState,
  SolverModule,
  SolverContext,
  SolverGuessResult,
  DarknetServerDetailsForFormulas,
} from "./config"

const _solverCache = new Map<string, SolverModule>()

function getModule(state: SolverState): SolverModule | null {
  const id = (state as unknown as Record<string, unknown>).type as string
  let mod = _solverCache.get(id)
  if (!mod) {
    const s = SOLVER_REGISTRY as Record<string, SolverModule>
    mod = s[id] ?? ((Object.values(s) as SolverModule[]).find((m) => {
      const dummy = m.initSolver?.({} as any)
      return dummy && (dummy as unknown as Record<string, unknown>).type === id
    }) ?? null)
    if (!mod && id === "bellaCuoreRange") mod = bellaCuoreRange
    if (mod) _solverCache.set(id, mod)
  }
  return mod
}

self.onmessage = (event: MessageEvent) => {
  const msg = event.data as {
    id: number
    type: "initSolver" | "nextGuess" | "applyResult" | "applyHeartbleed" | "applyLabreport"
    state?: SolverState
    details?: DarknetServerDetailsForFormulas
    target?: string
    guess?: string
    result?: SolverGuessResult
    logEntries?: string[]
    report?: { coords: number[]; north: boolean; east: boolean; south: boolean; west: boolean }
  }
  try {
    switch (msg.type) {
      case "initSolver": {
        if (!msg.details) throw new Error("missing details")
        let mod = lookupSolver(msg.details)
        if (!mod && msg.details.modelId === "BellaCuore" && msg.details.data.includes(",")) {
          mod = bellaCuoreRange
        }
        if (!mod) { postMessage({ id: msg.id, error: "no solver" }); return }
        const state = mod.initSolver(msg.details)
        _solverCache.set((state as unknown as Record<string, unknown>).type as string, mod)
        postMessage({ id: msg.id, state })
        return
      }
      case "nextGuess": {
        if (!msg.state || !msg.target || !msg.details) { postMessage({ id: msg.id, error: "missing context" }); return }
        const mod = getModule(msg.state)
        if (!mod) { postMessage({ id: msg.id, error: "unknown solver" }); return }
        const next = mod.nextGuess(msg.state, { target: msg.target, details: msg.details })
        postMessage({ id: msg.id, state: msg.state, next })
        return
      }
      case "applyResult": {
        if (!msg.state || msg.guess == null || !msg.result) { postMessage({ id: msg.id, error: "missing args" }); return }
        const mod = getModule(msg.state)
        if (!mod) { postMessage({ id: msg.id, error: "unknown solver" }); return }
        postMessage({ id: msg.id, state: mod.applyResult(msg.state, msg.guess, msg.result) })
        return
      }
      case "applyHeartbleed": {
        if (!msg.state || !msg.logEntries) { postMessage({ id: msg.id, error: "missing args" }); return }
        const mod = getModule(msg.state)
        if (!mod) { postMessage({ id: msg.id, error: "unknown solver" }); return }
        postMessage({ id: msg.id, state: mod.applyHeartbleed?.(msg.state, msg.logEntries) ?? msg.state })
        return
      }
      case "applyLabreport": {
        if (!msg.state || !msg.report) { postMessage({ id: msg.id, error: "missing args" }); return }
        const mod = getModule(msg.state)
        if (!mod) { postMessage({ id: msg.id, error: "unknown solver" }); return }
        postMessage({ id: msg.id, state: mod.applyLabreport?.(msg.state, msg.report) ?? msg.state })
        return
      }
      default: postMessage({ id: msg.id, error: "unknown message type" })
    }
  } catch (err) { postMessage({ id: msg.id, error: String(err) }) }
}
