import { NS } from "@ns"
import { LABYRINTH_MODEL } from "../constants.js"
import type { ServerDetails } from "../types.js"
import { labyrinthSolver } from "./labyrinth.js"
import { SOLVER_MODULES } from "./impl/all.js"
import type { GuessRequest, GuessResult, SolverContext, SolverState } from "./types.js"

export const SOLVER_WORKER_SCRIPT = "dnet/solvers/solverWorker.js"
export const SOLVER_WORKER_TIMEOUT_MS = 10_000

export type SolverComputeOp = "init" | "nextGuess" | "applyResult" | "applyHeartbleed"

export type SolverFatalCause = "timeout" | "crash" | "solver" | "protocol"

export interface SolverComputeContext {
  op: SolverComputeOp
  solverKey: string
  solverId?: string
  host?: string
  modelId?: string
  session?: number
  guess?: string
  detail?: string
  feedback?: string
}

export function formatSolverWorkerError(
  ctx: SolverComputeContext,
  cause: SolverFatalCause,
  message?: string,
): string {
  const lines = ["Solver web worker failed", ""]
  if (cause === "timeout") {
    lines.push(`Cause: timeout (${SOLVER_WORKER_TIMEOUT_MS}ms)`)
  } else if (cause === "crash") {
    lines.push(`Cause: crash${message ? ` (${message})` : ""}`)
  } else if (cause === "solver") {
    lines.push(`Cause: solver error${message ? ` (${message})` : ""}`)
  } else {
    lines.push(`Cause: protocol error${message ? ` (${message})` : ""}`)
  }
  lines.push(`Operation: ${ctx.op}`)
  lines.push(`Solver: ${ctx.solverKey}`)
  if (ctx.solverId) lines.push(`State type: ${ctx.solverId}`)
  if (ctx.host) lines.push(`Host: ${ctx.host}`)
  if (ctx.modelId) lines.push(`Model: ${ctx.modelId}`)
  if (ctx.session != null) lines.push(`Session: ${ctx.session}`)
  if (ctx.guess) lines.push(`Guess: ${ctx.guess}`)
  if (ctx.detail) lines.push(`Detail: ${ctx.detail}`)
  if (ctx.feedback) lines.push(`Feedback: ${ctx.feedback}`)
  return lines.join("\n")
}

export class SolverWorkerFatalError extends Error {
  readonly fatalCause: SolverFatalCause
  readonly computeContext: SolverComputeContext

  constructor(cause: SolverFatalCause, ctx: SolverComputeContext, message?: string) {
    super(formatSolverWorkerError(ctx, cause, message))
    this.name = "SolverWorkerFatalError"
    this.fatalCause = cause
    this.computeContext = ctx
  }
}

type WorkerResponsePayload = {
  id: number
  state?: SolverState
  guess?: GuessRequest | null
  error?: string
}

type PendingRequest = {
  ctx: SolverComputeContext
  resolve: (value: WorkerResponsePayload) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function inlineSolver(solverKey: string) {
  return SOLVER_MODULES[solverKey] ?? null
}

/** Routes impl/all.ts solvers through a browser Web Worker; labyrinth stays inline. */
export class SolverBridge {
  private worker: Worker | null = null
  private objectUrl: string | null = null
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private queue: Promise<void> = Promise.resolve()
  private terminated = false

  constructor(private readonly ns: NS) {
    ns.atExit(() => this.terminate())
  }

  usesWorkerSolver(solverKey: string | null): solverKey is string {
    return solverKey != null && solverKey.length > 0
  }

  async init(
    solverKey: string,
    details: ServerDetails,
    partial: Omit<SolverComputeContext, "op" | "solverKey">,
  ): Promise<SolverState> {
    const ctx: SolverComputeContext = { op: "init", solverKey, ...partial }
    const res = await this.dispatch(ctx, { op: "init", solverKey, details })
    if (res.state == null) {
      throw new SolverWorkerFatalError("protocol", ctx, "init returned no state")
    }
    return res.state
  }

  async nextGuess(
    solverKey: string,
    state: SolverState,
    solverCtx: SolverContext,
    partial: Omit<SolverComputeContext, "op" | "solverKey">,
  ): Promise<{ state: SolverState; guess: GuessRequest | null }> {
    const ctx: SolverComputeContext = {
      op: "nextGuess",
      solverKey,
      host: partial.host ?? solverCtx.target,
      modelId: partial.modelId ?? solverCtx.details.modelId,
      ...partial,
    }
    const res = await this.dispatch(ctx, { op: "nextGuess", solverKey, state, ctx: solverCtx })
    if (res.state == null) {
      throw new SolverWorkerFatalError("protocol", ctx, "nextGuess returned no state")
    }
    return { state: res.state, guess: res.guess ?? null }
  }

  async applyResult(
    solverKey: string,
    state: SolverState,
    guess: string,
    result: GuessResult,
    solverCtx: SolverContext | undefined,
    partial: Omit<SolverComputeContext, "op" | "solverKey">,
  ): Promise<SolverState> {
    const ctx: SolverComputeContext = {
      op: "applyResult",
      solverKey,
      guess,
      feedback: result.feedback,
      host: partial.host ?? solverCtx?.target,
      modelId: partial.modelId ?? solverCtx?.details.modelId,
      ...partial,
    }
    const res = await this.dispatch(ctx, {
      op: "applyResult",
      solverKey,
      state,
      guess,
      result,
      ctx: solverCtx,
    })
    if (res.state == null) {
      throw new SolverWorkerFatalError("protocol", ctx, "applyResult returned no state")
    }
    return res.state
  }

  async applyHeartbleed(
    solverKey: string,
    state: SolverState,
    logs: string[],
    partial: Omit<SolverComputeContext, "op" | "solverKey">,
  ): Promise<SolverState> {
    const ctx: SolverComputeContext = { op: "applyHeartbleed", solverKey, ...partial }
    const res = await this.dispatch(ctx, { op: "applyHeartbleed", solverKey, state, logs })
    if (res.state == null) {
      throw new SolverWorkerFatalError("protocol", ctx, "applyHeartbleed returned no state")
    }
    return res.state
  }

  /** Labyrinth and other non-worker solvers run synchronously on the main thread. */
  initInline(modelId: string, details: ServerDetails): SolverState {
    if (modelId === LABYRINTH_MODEL) return labyrinthSolver.init(details)
    throw new Error(`initInline: unsupported model ${modelId}`)
  }

  applyResultInline(
    solverKey: string | null,
    modelId: string,
    state: SolverState,
    guess: string,
    result: GuessResult,
    solverCtx?: SolverContext,
  ): SolverState {
    const solver =
      modelId === LABYRINTH_MODEL
        ? labyrinthSolver
        : solverKey
          ? inlineSolver(solverKey)
          : null
    if (!solver) throw new Error(`applyResultInline: no solver for ${modelId}`)
    return solver.applyResult(state, guess, result, solverCtx)
  }

  applyHeartbleedInline(
    solverKey: string,
    state: SolverState,
    logs: string[],
  ): SolverState {
    const solver = inlineSolver(solverKey)
    if (!solver?.applyHeartbleed) return state
    return solver.applyHeartbleed(state, logs)
  }

  terminate(): void {
    this.terminated = true
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(
        new SolverWorkerFatalError("crash", pending.ctx, "solver worker terminated"),
      )
      this.pending.delete(id)
    }
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
  }

  private ensureWorker(): Worker {
    if (this.terminated) {
      throw new Error("solver worker already terminated")
    }
    if (this.worker) return this.worker

    const source = this.ns.read(SOLVER_WORKER_SCRIPT)
    if (!source) {
      throw new Error(`solver worker script missing on home: ${SOLVER_WORKER_SCRIPT}`)
    }
    this.objectUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }))
    const worker = new Worker(this.objectUrl)
    worker.onmessage = (event: MessageEvent<WorkerResponsePayload>) => {
      this.onWorkerMessage(event.data)
    }
    worker.onerror = (event) => {
      this.onWorkerCrash(event.message || "unknown worker error")
    }
    this.worker = worker
    return worker
  }

  private onWorkerMessage(data: WorkerResponsePayload): void {
    const pending = this.pending.get(data.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(data.id)

    if (data.error) {
      pending.reject(new SolverWorkerFatalError("solver", pending.ctx, data.error))
      return
    }
    pending.resolve(data)
  }

  private onWorkerCrash(message: string): void {
    for (const [id, pending] of [...this.pending]) {
      clearTimeout(pending.timer)
      pending.reject(new SolverWorkerFatalError("crash", pending.ctx, message))
      this.pending.delete(id)
    }
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
    this.terminated = true
  }

  private dispatch(
    ctx: SolverComputeContext,
    payload: Record<string, unknown>,
  ): Promise<WorkerResponsePayload> {
    return this.enqueue(() => this.dispatchNow(ctx, payload))
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private dispatchNow(
    ctx: SolverComputeContext,
    payload: Record<string, unknown>,
  ): Promise<WorkerResponsePayload> {
    const worker = this.ensureWorker()
    const id = this.nextId++

    return new Promise<WorkerResponsePayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(id)
        this.terminate()
        reject(new SolverWorkerFatalError("timeout", ctx))
      }, SOLVER_WORKER_TIMEOUT_MS)

      this.pending.set(id, { ctx, resolve, reject, timer })
      worker.postMessage({ id, ...payload })
    })
  }
}

export function createSolverBridge(ns: NS): SolverBridge {
  return new SolverBridge(ns)
}
