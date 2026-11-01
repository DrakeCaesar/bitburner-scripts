/**
 * Local JSON API for IPvGO move search.
 * Prefers KataGo (GPU) when installed; falls back to native C++ MCTS.
 */

import { execFile, spawn } from "child_process"
import fs from "fs"
import http from "http"
import path from "path"
import { fileURLToPath } from "url"
import { isKatagoInstalled, requestKatagoMove, cancelKatagoRequest, shutdownKatago, warmupKatago } from "./katagoBridge.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.IPVGO_PORT ?? 3010)
const maxBodyBytes = 4 * 1024 * 1024
const forceNative = process.env.IPVGO_FORCE_NATIVE === "1"
const engineOverride = (process.env.IPVGO_ENGINE ?? "").trim()
const forceMcgs = engineOverride === "mcgs"
const forceExploit = engineOverride === "exploit"

/** @type {import("child_process").ChildProcess | null} */
let activeNativeChild = null

function nativeExecutablePath() {
  return findNativeExecutable("ipvgo_engine")
}

function mcgsExecutablePath() {
  return findNativeExecutable("ipvgo_game")
}

// Native targets are built from the repo root into `cmake-build` (see the root
// CMakeLists.txt and CMakePresets.json). Older per-component build dirs are
// still accepted so a stale checkout keeps working.
function nativeExecutableCandidates(name) {
  const isWindows = process.platform === "win32"
  const suffixes = isWindows ? [".exe"] : ["", ".exe"]
  const dirs = [
    path.join(__dirname, "..", "cmake-build", "bin", "Release"),
    path.join(__dirname, "..", "cmake-build", "bin"),
    path.join(__dirname, "..", "cmake-build", "Release"),
    path.join(__dirname, "..", "cmake-build"),
    path.join(__dirname, "build", "Release"),
    path.join(__dirname, "build"),
  ]
  const out = []
  for (const dir of dirs) {
    for (const suffix of suffixes) out.push(path.join(dir, name + suffix))
  }
  return out
}

function findNativeExecutable(name) {
  const candidates = nativeExecutableCandidates(name)
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
}

// ---- Bench (exploiter self-play against the scripted factions) -------------

const BENCH_FACTIONS = ["Netburners", "Slum Snakes", "The Black Hand", "Tetrads", "Daedalus", "Illuminati"]
const BENCH_HISTORY_LIMIT = 40

const bench = {
  child: null,
  state: {
    running: false,
    finished: false,
    options: null,
    current: null,
    rows: [],
    history: [],
    lastResult: null,
    failures: null,
    error: null,
    startedAt: null,
    endedAt: null,
  },
}

function resetBenchState(options) {
  bench.state = {
    running: true,
    finished: false,
    options,
    current: null,
    rows: [],
    history: [],
    lastResult: null,
    failures: null,
    error: null,
    startedAt: Date.now(),
    endedAt: null,
  }
}

function applyBenchEvent(event) {
  const state = bench.state
  switch (event.type) {
    case "rows":
      state.rows = event.rows ?? []
      break
    case "gameStart":
      state.current = {
        faction: event.faction,
        factionIndex: event.factionIndex,
        factionCount: event.factionCount,
        game: event.game,
        games: event.games,
        move: 0,
        thinking: false,
        board: null,
        lastBlack: null,
        lastWhite: null,
        blackScore: 0,
        whiteScore: 0,
      }
      break
    case "thinking":
      if (!state.current) break
      state.current.thinking = true
      state.current.move = event.move
      state.current.board = event.board
      state.current.blackScore = event.blackScore
      state.current.whiteScore = event.whiteScore
      break
    case "move":
      if (!state.current) break
      state.current.thinking = false
      state.current.move = event.move
      state.current.board = event.board
      state.current.blackScore = event.blackScore
      state.current.whiteScore = event.whiteScore
      state.current.lastBlack = event.pass ? "pass" : `${event.black.x},${event.black.y}`
      state.current.depth = event.depth
      state.current.nodes = event.nodes
      state.current.ms = event.ms
      state.current.value = event.value
      break
    case "reply":
      if (!state.current) break
      state.current.board = event.board
      state.current.blackScore = event.blackScore
      state.current.whiteScore = event.whiteScore
      state.current.lastWhite = event.pass ? "pass" : `${event.white.x},${event.white.y}`
      break
    case "gameEnd":
      state.lastResult = {
        faction: event.faction,
        game: event.game,
        games: event.games,
        win: event.win,
        margin: event.margin,
        moves: event.moves,
      }
      state.history.unshift(state.lastResult)
      if (state.history.length > BENCH_HISTORY_LIMIT) state.history.length = BENCH_HISTORY_LIMIT
      break
    case "done":
      state.finished = true
      state.failures = event.failures
      break
    default:
      break
  }
}

function stopBench() {
  const child = bench.child
  bench.child = null
  bench.state.running = false
  if (child && !child.killed) {
    child.kill()
  }
}

async function handleBenchStart(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return sendJson(res, 400, { error: err.message })
  }

  const exe = mcgsExecutablePath()
  if (!fs.existsSync(exe)) {
    return sendJson(res, 503, { error: "Engine not built. Run: pnpm run ipvgo:build" })
  }

  stopBench()

  const size = Number(body?.size ?? 5)
  const requestedMs = Math.max(0, Number(body?.budgetMs ?? 0))
  const iterations = Math.max(0, Math.floor(Number(body?.iterations ?? 0)))
  const options = {
    size,
    // A node budget and a time budget are alternatives; default to 200 ms.
    budgetMs: iterations > 0 ? 0 : requestedMs > 0 ? requestedMs : 200,
    iterations,
    games: Math.max(1, Math.min(500, Number(body?.games ?? 20))),
    seed: Number(body?.seed ?? 1),
    factions: Array.isArray(body?.factions) && body.factions.length > 0 ? body.factions : undefined,
  }
  if (![5, 7, 9, 13, 19].includes(options.size)) {
    return sendJson(res, 400, { error: "size must be 5, 7, 9, 13 or 19" })
  }

  const resolved = options.factions ?? (options.size === 19 ? ["WorldDaemon"] : BENCH_FACTIONS)
  resetBenchState({ ...options, factions: resolved })

  const child = spawn(exe, ["benchjson", JSON.stringify(options)], { cwd: __dirname })
  bench.child = child
  bench.state.pid = child.pid

  let buffer = ""
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString()
    let newline = buffer.indexOf("\n")
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        try {
          applyBenchEvent(JSON.parse(line))
        } catch {
          /* ignore malformed line */
        }
      }
      newline = buffer.indexOf("\n")
    }
  })
  child.stderr.on("data", (chunk) => {
    bench.state.error = chunk.toString().trim().slice(0, 2000)
  })
  child.on("error", (err) => {
    bench.state.error = err.message
    bench.state.running = false
    if (bench.child === child) bench.child = null
  })
  child.on("close", () => {
    bench.state.running = false
    bench.state.endedAt = Date.now()
    if (bench.child === child) bench.child = null
  })

  sendJson(res, 200, { ok: true, options: bench.state.options })
}

function handleBenchStop(req, res) {
  stopBench()
  bench.state.endedAt = Date.now()
  sendJson(res, 200, { ok: true })
}

function handleBenchState(req, res) {
  sendJson(res, 200, { ...bench.state, pid: undefined })
}

function handleBenchPage(req, res) {
  const file = path.join(__dirname, "web", "bench.html")
  if (!fs.existsSync(file)) {
    return sendJson(res, 404, { error: "web/bench.html missing" })
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(fs.readFileSync(file))
}

function activeEngine() {
  if (forceExploit) return "exploit"
  if (forceMcgs) return "mcgs"
  if (!forceNative && isKatagoInstalled()) return "katago"
  const exe = nativeExecutablePath()
  if (fs.existsSync(exe)) return "native"
  return "missing"
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  })
  res.end(payload)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on("data", (chunk) => {
      size += chunk.length
      if (size > maxBodyBytes) {
        reject(new Error("Request body too large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8")
        resolve(text ? JSON.parse(text) : {})
      } catch (err) {
        reject(new Error(`Invalid JSON: ${err.message}`))
      }
    })
    req.on("error", reject)
  })
}

function handleHealth(_req, res) {
  const engine = activeEngine()
  sendJson(res, 200, {
    status: "ok",
    engine,
    katago: isKatagoInstalled(),
    nativePath: nativeExecutablePath(),
    nativeBuilt: fs.existsSync(nativeExecutablePath()),
    mcgsPath: mcgsExecutablePath(),
    mcgsBuilt: fs.existsSync(mcgsExecutablePath()),
    timestamp: new Date().toISOString(),
  })
}

async function requestGameMove(body, { command, engine, tempPrefix, timeoutMs }) {
  const exe = mcgsExecutablePath()
  if (!fs.existsSync(exe)) {
    throw new Error(`${engine} engine not built. Run: pnpm run ipvgo:build`)
  }

  const tempDir = path.join(__dirname, "temp")
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  const inputPath = path.join(tempDir, `${tempPrefix}-in-${Date.now()}.json`)
  const outputPath = path.join(tempDir, `${tempPrefix}-out-${Date.now()}.json`)
  fs.writeFileSync(inputPath, JSON.stringify(body))

  return new Promise((resolve, reject) => {
    const child = execFile(
      exe,
      [command, inputPath, outputPath],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (activeNativeChild === child) activeNativeChild = null
        try {
          if (error) {
            if (error.killed || error.signal) {
              reject(new Error(`${engine} engine cancelled`))
              return
            }
            reject(new Error(`${error.message}${stderr ? `: ${stderr}` : ""}`))
            return
          }
          if (!fs.existsSync(outputPath)) {
            reject(new Error(`${engine} produced no output file`))
            return
          }
          const result = JSON.parse(fs.readFileSync(outputPath, "utf8"))
          resolve({ ...result, engine })
        } catch (err) {
          reject(err)
        } finally {
          for (const file of [inputPath, outputPath]) {
            try {
              if (fs.existsSync(file)) fs.unlinkSync(file)
            } catch {
              /* ignore */
            }
          }
        }
      }
    )
    activeNativeChild = child
  })
}

function requestMcgsMove(body) {
  return requestGameMove(body, { command: "mcgsmove", engine: "mcgs", tempPrefix: "mcgs", timeoutMs: 300_000 })
}

function requestExploitMove(body) {
  return requestGameMove(body, {
    command: "exploitmove",
    engine: "exploit",
    tempPrefix: "exploit",
    timeoutMs: 300_000,
  })
}

async function requestNativeMove(body) {
  const exe = nativeExecutablePath()
  if (!fs.existsSync(exe)) {
    throw new Error("Native engine not built. Run: pnpm run ipvgo:build")
  }

  const tempDir = path.join(__dirname, "temp")
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  const inputPath = path.join(tempDir, `input-${Date.now()}.json`)
  const outputPath = path.join(tempDir, `output-${Date.now()}.json`)

  fs.writeFileSync(inputPath, JSON.stringify(body))

  return new Promise((resolve, reject) => {
    const child = execFile(
      exe,
      [inputPath, outputPath],
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (activeNativeChild === child) activeNativeChild = null
        try {
          if (error) {
            if (error.killed || error.signal) {
              reject(new Error("Native engine cancelled"))
              return
            }
            reject(new Error(`${error.message}${stderr ? `: ${stderr}` : ""}`))
            return
          }
          if (!fs.existsSync(outputPath)) {
            reject(new Error("Engine produced no output file"))
            return
          }
          const result = JSON.parse(fs.readFileSync(outputPath, "utf8"))
          resolve({ ...result, engine: "native" })
        } catch (err) {
          reject(err)
        } finally {
          for (const file of [inputPath, outputPath]) {
            try {
              if (fs.existsSync(file)) fs.unlinkSync(file)
            } catch {
              /* ignore */
            }
          }
        }
      }
    )
    activeNativeChild = child
  })
}

function cancelNativeMove() {
  if (activeNativeChild && !activeNativeChild.killed) {
    activeNativeChild.kill()
    activeNativeChild = null
  }
}

async function handleCancel(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return sendJson(res, 400, { error: err.message })
  }

  const requestId = body?.requestId
  if (!requestId || typeof requestId !== "string") {
    return sendJson(res, 400, { error: "requestId required" })
  }

  const engine = activeEngine()
  if (engine === "katago") {
    cancelKatagoRequest(requestId)
  } else if (engine === "native" || engine === "mcgs" || engine === "exploit") {
    cancelNativeMove()
  }

  sendJson(res, 200, { ok: true, requestId })
}

async function handleMove(req, res) {
  const engine = activeEngine()
  if (engine === "missing") {
    return sendJson(res, 503, {
      error: "No engine available. Run: pnpm run ipvgo:setup && pnpm run ipvgo:build",
    })
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return sendJson(res, 400, { error: err.message })
  }

  try {
    const result =
      engine === "katago"
        ? await requestKatagoMove(body)
        : engine === "mcgs"
          ? await requestMcgsMove(body)
          : engine === "exploit"
            ? await requestExploitMove(body)
            : await requestNativeMove(body)
    sendJson(res, 200, result)
  } catch (err) {
    console.error(`${engine} move error:`, err.message)
    if (engine === "katago" || engine === "exploit") {
      try {
        const fallback = await requestNativeMove(body)
        return sendJson(res, 200, { ...fallback, engine: "native", [`${engine}Error`]: err.message })
      } catch (nativeErr) {
        return sendJson(res, 500, { error: err.message, fallbackError: nativeErr.message })
      }
    }
    return sendJson(res, 500, { error: err.message })
  }
}

/**
 * Receives parity test cases dumped from the live game (ipvgoParityDump.js) and
 * writes them to temp/parity_cases.json for the native `ipvgo_game parity` tool.
 */
async function handleParityDump(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return sendJson(res, 400, { error: err.message })
  }

  const cases = Array.isArray(body) ? body : body?.cases
  if (!Array.isArray(cases)) {
    return sendJson(res, 400, { error: "Expected an array of parity cases (or { cases: [...] })" })
  }

  const tempDir = path.join(__dirname, "temp")
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
  const outPath = path.join(tempDir, "parity_cases.json")
  fs.writeFileSync(outPath, JSON.stringify(cases))
  console.log(`[parity] wrote ${cases.length} cases to ${outPath}`)
  sendJson(res, 200, { ok: true, count: cases.length, path: outPath })
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    })
    res.end()
    return
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)

  if (req.method === "GET" && url.pathname === "/health") {
    handleHealth(req, res)
    return
  }

  if (req.method === "GET" && url.pathname === "/bench") {
    handleBenchPage(req, res)
    return
  }

  if (req.method === "GET" && url.pathname === "/api/bench/state") {
    handleBenchState(req, res)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/bench/start") {
    await handleBenchStart(req, res)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/bench/stop") {
    handleBenchStop(req, res)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/ipvgo/cancel") {
    await handleCancel(req, res)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/ipvgo/move") {
    await handleMove(req, res)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/ipvgo/parity") {
    await handleParityDump(req, res)
    return
  }

  sendJson(res, 404, { error: "Not found" })
})

server.listen(port, () => {
  const engine = activeEngine()
  console.log(`IPvGO engine server http://localhost:${port}`)
  console.log(`Active engine: ${engine}`)
  console.log(`Health: http://localhost:${port}/health`)
  console.log(`Move API: POST http://localhost:${port}/api/ipvgo/move`)
  console.log(`Bench GUI: http://localhost:${port}/bench`)

  if (engine === "katago") {
    warmupKatago().catch((err) => {
      console.error("[katago] warmup failed:", err.message)
    })
  }
})

process.on("SIGINT", () => {
  stopBench()
  shutdownKatago()
  process.exit(0)
})

process.on("SIGTERM", () => {
  stopBench()
  shutdownKatago()
  process.exit(0)
})
