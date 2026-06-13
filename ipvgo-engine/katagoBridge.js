import { spawn } from "child_process"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { buildKataGoQuery, compressBoardForKatago, pickMoveFromAnalysis } from "./katagoConvert.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KATAGO_DIR = path.join(__dirname, "katago")
const MODELS_DIR = path.join(KATAGO_DIR, "models")

const QUERY_TIMEOUT_MS = 180_000
/** First OpenCL/CUDA launch may GPU-autotune for several minutes before "ready". */
const STARTUP_TIMEOUT_MS = 600_000

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
        const msg = chunk.toString().trim()
        if (msg) console.error("[katago]", msg)
        if (/ready to begin handling requests/i.test(msg)) finish()
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

    if (payload.error) {
      const id = payload.id
      if (id && this.pending.has(id)) {
        const { reject } = this.pending.get(id)
        this.pending.delete(id)
        reject(new Error(payload.error))
      }
      return
    }

    const id = payload.id
    if (!id || !this.pending.has(id)) return
    if (payload.isDuringSearch) return

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
    const id = `ipvgo-${this.nextId++}`
    const query = buildKataGoQuery(request, id, compression)
    const line = `${JSON.stringify(query)}\n`

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
