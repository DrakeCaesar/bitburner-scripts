import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import {
  buildKataGoQuery,
  buildKataGoSnapshotQuery,
  compressBoardForKatago,
  deriveKataGoMovesFromHistory,
  parseKatagoIllegalMoveIndex,
  pickMoveFromAnalysis,
  toKataGoPayload,
} from "./katagoConvert.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KATAGO_DIR = path.join(__dirname, "katago")
const MODELS_DIR = path.join(KATAGO_DIR, "models")

const QUERY_TIMEOUT_MS = 180_000
/** First OpenCL/CUDA launch may GPU-autotune for several minutes before "ready". */
const STARTUP_TIMEOUT_MS = 600_000
/** Cap replay trim attempts per think; then fall back to board snapshot. */
const MAX_REPLAY_TRIM_ATTEMPTS = 128

function katagoExePath() {
  const isWindows = process.platform === "win32"
  return path.join(KATAGO_DIR, isWindows ? "katago.exe" : "katago")
}

export function modelPathForSize(boardSize) {
  const nine = path.join(MODELS_DIR, "nine.bin.gz")
  const main = path.join(MODELS_DIR, "main.bin.gz")
  if (boardSize === 9 && fs.existsSync(nine)) return nine
  return main
}

export function isKatagoInstalled() {
  const exe = katagoExePath()
  const main = path.join(MODELS_DIR, "main.bin.gz")
  return fs.existsSync(exe) && fs.existsSync(main)
}

class KataGoSession {
  constructor(modelPath) {
    this.modelPath = modelPath
    this.proc = null
    this.buffer = ""
    this.pending = new Map()
    this.nextId = 1
    this.starting = null
    /** Ply index to start move replay from; advances when KataGo reports illegal moves. */
    this.replayFromPly = 0
    this.lastHistoryLen = 0
    this.cancelledIds = new Set()
  }

  rejectPending(id, message) {
    if (!id || !this.pending.has(id)) return false
    const { reject } = this.pending.get(id)
    this.pending.delete(id)
    reject(new Error(message))
    return true
  }

  onStderr(chunk) {
    const msg = chunk.toString().trim()
    if (!msg) return
    console.error("[katago]", msg)
    if (/ready to begin handling requests/i.test(msg)) return

    const jsonStart = msg.indexOf("{")
    if (jsonStart < 0) return
    try {
      const payload = JSON.parse(msg.slice(jsonStart))
      if (payload.error && payload.id) {
        this.rejectPending(payload.id, payload.error)
      }
    } catch {
      /* ignore non-json stderr */
    }
  }

  async ensureStarted() {
    if (this.proc && !this.proc.killed) return
    if (this.starting) return this.starting

    const exe = katagoExePath()
    const config = path.join(KATAGO_DIR, "analysis.cfg")
    if (!fs.existsSync(exe)) throw new Error(`KataGo binary missing: ${exe}`)
    if (!fs.existsSync(this.modelPath)) throw new Error(`KataGo model missing: ${this.modelPath}`)
    if (!fs.existsSync(config)) throw new Error(`KataGo config missing: ${config}`)

    this.starting = new Promise((resolve, reject) => {
      const proc = spawn(exe, ["analysis", "-config", config, "-model", this.modelPath], {
        cwd: KATAGO_DIR,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      })
      this.proc = proc
      this.buffer = ""
      let settled = false

      const finish = (err) => {
        if (settled) return
        settled = true
        this.starting = null
        if (err) reject(err)
        else resolve()
      }

      proc.stdout.on("data", (chunk) => this.onStdout(chunk))
      proc.stderr.on("data", (chunk) => {
        this.onStderr(chunk)
        if (/ready to begin handling requests/i.test(chunk.toString())) finish()
      })
      proc.on("error", (err) => finish(err))
      proc.on("exit", (code) => {
        this.proc = null
        for (const { reject: pendingReject } of this.pending.values()) {
          pendingReject(new Error(`KataGo exited with code ${code ?? "unknown"}`))
        }
        this.pending.clear()
        if (!settled) finish(new Error(`KataGo exited during startup (code ${code ?? "unknown"})`))
      })

      setTimeout(() => {
        if (!settled) finish(new Error(`KataGo startup timed out after ${STARTUP_TIMEOUT_MS}ms`))
      }, STARTUP_TIMEOUT_MS)
    })

    return this.starting
  }

  onStdout(chunk) {
    this.buffer += chunk.toString()
    let newlineIndex = this.buffer.indexOf("\n")
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)
      if (line) this.handleLine(line)
      newlineIndex = this.buffer.indexOf("\n")
    }
  }

  handleLine(line) {
    let payload
    try {
      payload = JSON.parse(line)
    } catch {
      return
    }

    if (payload.warning) return

    const id = payload.id
    if (id && this.cancelledIds.has(id)) {
      this.cancelledIds.delete(id)
      this.rejectPending(id, new Error("Query cancelled"))
      return
    }

    if (payload.error) {
      this.rejectPending(payload.id, payload.error)
      return
    }

    if (payload.noResults) {
      this.rejectPending(id, new Error("Query cancelled"))
      return
    }

    if (!id || !this.pending.has(id)) return
    if (payload.isDuringSearch) return
    if (!Array.isArray(payload.moveInfos)) return

    const { resolve, started } = this.pending.get(id)
    this.pending.delete(id)
    resolve({
      moveInfos: payload.moveInfos ?? [],
      rootInfo: payload.rootInfo,
      elapsedMs: performance.now() - started,
      visits: payload.rootInfo?.visits ?? 0,
    })
  }

  async query(request, compression = null) {
    await this.ensureStarted()
    const historyLen = request.history?.length ?? 0
    if (historyLen === 0 || historyLen < this.lastHistoryLen) {
      this.replayFromPly = 0
    }
    this.lastHistoryLen = historyLen

    const id = request.requestId ?? `ipvgo-${this.nextId++}`
    return this.sendQueryWithReplayRetries(request, compression, id)
  }

  /**
   * Drop replayed moves from the start of the batch through the illegal move.
   * Illegal move index 0 means the first move in the batch failed; trim it and retry later.
   */
  advanceReplayFromPly(illegalIndex) {
    if (illegalIndex === 0) {
      this.replayFromPly += 1
      return
    }
    this.replayFromPly += illegalIndex
  }

  async sendQueryWithReplayRetries(request, compression, id) {
    let attempt = 0
    while (true) {
      const derived = deriveKataGoMovesFromHistory(request.history, request.board, compression)
      const moveCount = derived.moves?.length ?? 0

      if (!derived.ok || this.replayFromPly >= moveCount) {
        const snapshot = buildKataGoSnapshotQuery(request, `${id}-snap-${attempt++}`, compression)
        return this.sendQuery(snapshot)
      }

      if (attempt >= MAX_REPLAY_TRIM_ATTEMPTS) {
        console.warn(
          `[katago] replay trim exceeded ${MAX_REPLAY_TRIM_ATTEMPTS} attempts (ply ${this.replayFromPly}); using board snapshot`
        )
        const snapshot = buildKataGoSnapshotQuery(request, `${id}-snap-${attempt++}`, compression)
        return this.sendQuery(snapshot)
      }

      const query = buildKataGoQuery(
        request,
        `${id}-r${this.replayFromPly}-${attempt++}`,
        compression,
        this.replayFromPly
      )
      try {
        return await this.sendQuery(query)
      } catch (err) {
        const message = String(err.message ?? err)
        if (/cancel/i.test(message)) throw err

        const illegalIndex = parseKatagoIllegalMoveIndex(message)
        if (illegalIndex == null) throw err

        const previous = this.replayFromPly
        this.advanceReplayFromPly(illegalIndex)
        console.warn(
          `[katago] illegal move at batch index ${illegalIndex}; next replay from ply ${this.replayFromPly} (was ${previous})`
        )

        if (this.replayFromPly >= moveCount) {
          const snapshot = buildKataGoSnapshotQuery(request, `${id}-snap-${attempt++}`, compression)
          return this.sendQuery(snapshot)
        }
      }
    }
  }

  terminateQuery(terminateId) {
    if (!terminateId || !this.proc?.stdin) return
    this.cancelledIds.add(terminateId)
    const ackId = `ipvgo-term-${this.nextId++}`
    const line = `${JSON.stringify({ id: ackId, action: "terminate", terminateId })}\n`
    try {
      this.proc.stdin.write(line)
    } catch {
      /* ignore */
    }
  }

  async sendQuery(query) {
    const payload = toKataGoPayload(query)
    return this.writeQueryLine(`${JSON.stringify(payload)}\n`, payload.id)
  }

  async writeQueryLine(line, id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`KataGo query timed out after ${QUERY_TIMEOUT_MS}ms`))
      }, QUERY_TIMEOUT_MS)

      this.pending.set(id, {
        started: performance.now(),
        resolve: (result) => {
          clearTimeout(timer)
          resolve(result)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })

      try {
        if (!this.proc?.stdin) throw new Error("KataGo process not running")
        this.proc.stdin.write(line)
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(err)
      }
    })
  }

  shutdown() {
    if (this.proc && !this.proc.killed) {
      this.proc.stdin.end()
      this.proc.kill()
    }
    this.proc = null
  }
}

const sessions = new Map()

function getSession(boardSize) {
  const modelPath = modelPathForSize(boardSize)
  const key = modelPath
  if (!sessions.has(key)) {
    sessions.set(key, new KataGoSession(modelPath))
  }
  return sessions.get(key)
}

export async function requestKatagoMove(request) {
  const started = performance.now()
  const compression = compressBoardForKatago(request.board, request.validMoves)
  const katagoSize = compression?.size ?? request.board?.length ?? 7
  const session = getSession(katagoSize)
  const analysis = await session.query(request, compression)
  const move = pickMoveFromAnalysis(analysis.moveInfos, request.validMoves, request.playAs, compression)

  return {
    move,
    iterations: analysis.visits || request.iterations || 0,
    elapsedMs: performance.now() - started,
    engine: "katago",
    ...(compression
      ? { compressedSize: katagoSize, strippedRows: compression.strippedRows, strippedCols: compression.strippedCols }
      : {}),
  }
}

export function cancelKatagoRequest(requestId) {
  if (!requestId) return
  for (const session of sessions.values()) {
    session.terminateQuery(requestId)
  }
}

export async function warmupKatago(boardSize = 7) {
  if (!isKatagoInstalled()) return false

  const size = boardSize
  const board = Array.from({ length: size }, () => Array(size).fill("?"))
  const validMoves = board.map((row) => row.map((cell) => cell === "?"))
  const started = performance.now()

  console.log("[katago] warming up (first launch may GPU-autotune for several minutes)...")
  await requestKatagoMove({
    board,
    validMoves,
    playAs: "X",
    iterations: 50,
    komi: 5.5,
  })
  console.log(`[katago] ready (${Math.round(performance.now() - started)}ms)`)
  return true
}

export function shutdownKatago() {
  for (const session of sessions.values()) {
    session.shutdown()
  }
  sessions.clear()
}

process.on("exit", shutdownKatago)
