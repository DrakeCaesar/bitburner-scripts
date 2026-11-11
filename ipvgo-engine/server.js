/**
 * Local JSON API for IPvGO move search.
 * Runs the C++ exploiter by default; native MCTS is available as a fallback.
 */

import { execFile, spawn } from "child_process"
import crypto from "crypto"
import fs from "fs"
import http from "http"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"

import { BLUNDER_DELTA, explainGame, writeExplainFile } from "./lib/explain.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.IPVGO_PORT ?? 3010)
const maxBodyBytes = 4 * 1024 * 1024
const engineOverride = (process.env.IPVGO_ENGINE ?? "").trim()
// Set by scripts/dev-server.mjs: enables restart requests and tells the page to
// reload itself when this id changes.
const supervised = process.env.IPVGO_SUPERVISED === "1"
// Carry memo: reuse exact search results across moves and pondering. It returns
// what a fresh search would, so it is on by default; IPVGO_CARRY=0 turns it off.
const carryMemo = process.env.IPVGO_CARRY !== "0"
const serverId = crypto.randomUUID()

/** @type {import("child_process").ChildProcess | null} */
let activeNativeChild = null

function nativeExecutablePath() {
  return findNativeExecutable("ipvgo_engine")
}

function mcgsExecutablePath() {
  return findNativeExecutable("ipvgo_game")
}

// Native targets are built from the repo root into `out/build/<config>` (see
// CMakeSettings.json and cmake/BuildTypes.cmake). Only a Release tree is served: a
// Debug or RelWithDebInfo binary is several times slower per move, and the bench
// numbers would silently describe the wrong build. Every release folder is read in
// both layouts - `bin` for the single-config generators (Ninja, Unix Makefiles) and
// `bin/<Config>` for a multi-config one (Visual Studio) - so switching generator
// does not hide the binaries. The legacy per-component directories are checked
// last: an old binary can predate the `serve` protocol the server speaks, which
// shows up as a bench that never leaves "thinking".
function nativeExecutableCandidates(name) {
  const isWindows = process.platform === "win32"
  const suffixes = isWindows ? [".exe"] : ["", ".exe"]
  const buildRoot = path.join(__dirname, "..", "out", "build")
  const releaseBinDirs = ["x64-Release", "x64-Clang-Release"].flatMap((config) => {
    const bin = path.join(buildRoot, config, "bin")
    return [bin, path.join(bin, "Release")]
  })
  const dirs = [
    ...releaseBinDirs,
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
const BENCH_HISTORY_LIMIT = 500
// Every game of the current batch is archived with its full move list so the page
// can expand any of them. Bounded so a very long run cannot grow without limit.
const BENCH_ARCHIVE_LIMIT = 2000
// Half-moves kept so the page can animate Black and White separately: the two
// land milliseconds apart, far faster than the browser can poll.
const BENCH_FRAME_LIMIT = 120

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
    frames: [],
    frameSeq: 0,
    // Archived games of this batch: { faction, game, win, margin, moves: [...] }
    archive: [],
    // The game being played, so moves can be attached to it as they arrive.
    live: null,
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
    frames: [],
    frameSeq: 0,
    archive: [],
    live: null,
  }
}

function pushFrame(state, side, event, extra) {
  if (!state.current) return null
  state.frameSeq += 1
  const frame = {
    seq: state.frameSeq,
    side,
    action: event.pass ? null : extra,
    board: event.board,
    blackScore: event.blackScore,
    whiteScore: event.whiteScore,
    move: state.current.move,
    faction: state.current.faction,
    game: state.current.game,
    games: state.current.games,
  }
  state.frames.push(frame)
  if (state.frames.length > BENCH_FRAME_LIMIT) {
    state.frames.splice(0, state.frames.length - BENCH_FRAME_LIMIT)
  }
  return frame
}

// ---- Server push (SSE): no polling, no added latency ----------------------

/** @type {Set<import("http").ServerResponse>} */
const benchClients = new Set()

function benchSnapshot() {
  const { frames, archive, live, ...rest } = bench.state
  return { ...rest, pid: undefined, frameSeq: bench.state.frameSeq, serverId, supervised }
}

function sseSend(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  } catch {
    benchClients.delete(res)
  }
}

function benchBroadcast(event, data) {
  if (benchClients.size === 0) return
  const payload = JSON.stringify(data)
  for (const res of benchClients) {
    try {
      res.write(`event: ${event}\ndata: ${payload}\n\n`)
    } catch {
      benchClients.delete(res)
    }
  }
}

function applyBenchEvent(event) {
  const state = bench.state
  switch (event.type) {
    case "rows":
      state.rows = event.rows ?? []
      benchBroadcast("rows", { rows: state.rows })
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
      // One record per game of the batch, so the page can expand it afterwards.
      state.live = {
        faction: event.faction,
        game: event.game,
        // Where this game started in the rng stream: enough to replay it exactly
        // under different search settings (see BenchOptions::replay).
        draws: event.draws ?? 0,
        moves: [],
      }
      benchBroadcast("game", state.current)
      break
    case "thinking":
      if (!state.current) break
      state.current.thinking = true
      state.current.move = event.move
      state.current.board = event.board
      state.current.blackScore = event.blackScore
      state.current.whiteScore = event.whiteScore
      benchBroadcast("thinking", {
        move: state.current.move,
        board: state.current.board,
        blackScore: state.current.blackScore,
        whiteScore: state.current.whiteScore,
        faction: state.current.faction,
        game: state.current.game,
      })
      break
    case "move": {
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
      const frame = pushFrame(state, "B", event, event.pass ? null : { x: event.black.x, y: event.black.y })
      if (frame) benchBroadcast("frame", frame)
      if (state.live) {
        state.live.moves.push({
          move: event.move,
          black: event.pass ? null : { x: event.black.x, y: event.black.y },
          blackPass: !!event.pass,
          value: event.value,
          depth: event.depth,
          nodes: event.nodes,
          ms: event.ms,
          board: event.board,
          blackScore: event.blackScore,
          whiteScore: event.whiteScore,
          white: null,
          whitePass: false,
          // What the leaf evaluator said at the root and after the move, the
          // alternatives the search ranked and White's modelled replies.
          audit: event.audit ?? null,
          whiteAudit: null,
        })
      }
      break
    }
    case "reply": {
      if (!state.current) break
      state.current.board = event.board
      state.current.blackScore = event.blackScore
      state.current.whiteScore = event.whiteScore
      state.current.lastWhite = event.pass ? "pass" : `${event.white.x},${event.white.y}`
      const frame = pushFrame(state, "W", event, event.pass ? null : { x: event.white.x, y: event.white.y })
      if (frame) benchBroadcast("frame", frame)
      if (state.live && state.live.moves.length > 0) {
        const last = state.live.moves[state.live.moves.length - 1]
        last.white = event.pass ? null : { x: event.white.x, y: event.white.y }
        last.whitePass = !!event.pass
        last.boardAfterWhite = event.board
        last.blackScoreAfterWhite = event.blackScore
        last.whiteScoreAfterWhite = event.whiteScore
        // The eval after White's real reply, and how likely the model thought it was.
        last.whiteAudit = event.audit ?? null
      }
      break
    }
    case "gameEnd":
      state.lastResult = {
        faction: event.faction,
        game: event.game,
        games: event.games,
        win: event.win,
        margin: event.margin,
        moves: event.moves,
      }
      // Archive the finished game with its move list, and hand the page the index
      // so it can fetch the detail on demand instead of shipping every move to
      // every client up front.
      if (state.live) {
        state.archive.push({
          faction: state.live.faction,
          game: state.live.game,
          win: event.win,
          margin: event.margin,
          movesPlayed: event.moves,
          draws: state.live.draws,
          moves: state.live.moves,
        })
        if (state.archive.length > BENCH_ARCHIVE_LIMIT) {
          state.archive.splice(0, state.archive.length - BENCH_ARCHIVE_LIMIT)
        }
        state.lastResult.archiveIndex = state.archive.length - 1
        state.lastResult.moveCount = state.live.moves.length
        state.lastResult.draws = state.live.draws
        state.live = null
      }
      state.history.unshift(state.lastResult)
      if (state.history.length > BENCH_HISTORY_LIMIT) state.history.length = BENCH_HISTORY_LIMIT
      benchBroadcast("result", state.lastResult)
      break
    case "done":
      state.finished = true
      state.failures = event.failures
      benchBroadcast("done", { failures: event.failures })
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
  benchBroadcast("snapshot", benchSnapshot())
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
  // A fixed-depth run is the third way to budget a search: no wall clock and no
  // node cap, so `depth` alone decides how far it looks. It is what the bench needs
  // to compare a narrow deep search against the wide shallow one.
  const fixedDepth = body?.budgetMode === "depth"
  const depthCap = fixedDepth ? Math.max(1, Math.floor(Number(body?.depth ?? 2))) : undefined
  // In fixed-depth mode an optional node cap stops the search instead of letting a
  // deep narrow run balloon: it becomes iterative deepening whose ceiling is the
  // requested depth, so the result is "at most this deep, within this work".
  const depthNodeCap = fixedDepth ? Math.max(0, Math.floor(Number(body?.iterations ?? 0))) : 0
  const options = {
    size,
    // A node budget and a time budget are alternatives; default to 200 ms.
    budgetMs: fixedDepth ? 0 : iterations > 0 ? 0 : requestedMs > 0 ? requestedMs : 200,
    iterations: fixedDepth ? depthNodeCap : iterations,
    depth: depthCap,
    maxDepth: depthCap,
    // No cap: a long batch is bounded by its own wall time, and the archive keeps
    // the most recent games only.
    games: Math.max(1, Math.floor(Number(body?.games ?? 20)) || 20),
    seed: Number(body?.seed ?? 1),
    factions: Array.isArray(body?.factions) && body.factions.length > 0 ? body.factions : undefined,
  }
  // Every search-shaping knob the form can set. Without this the "Search tuning"
  // fields were collected by the page and then silently discarded here, so the GUI
  // could not reproduce any experiment that changed them.
  for (const key of ["depth", "maxDepth", "beam", "whiteChildren", "whiteMass", "endgameEmpties", "nodeBudget", "threads"]) {
    const raw = body?.[key]
    if (raw === null || raw === undefined || raw === "") continue
    const value = Number(raw)
    if (Number.isFinite(value)) options[key] = value
  }

  // Optional search tuning; anything absent keeps the engine default.
  const integer = (key, min, max) => {
    const raw = body?.[key]
    if (raw === undefined || raw === null || raw === "") return undefined
    const value = Math.floor(Number(raw))
    if (!Number.isFinite(value) || value < min || value > max) return undefined
    return value
  }
  for (const [key, min, max] of [
    ["beam", 0, 64],
    ["whiteChildren", 0, 32],
    ["endgameEmpties", 0, 20],
    ["nodeBudget", 1000, 5000000],
    ["maxDepth", 0, 64],   // 0 = automatic
    ["threads", 0, 64],
  ]) {
    const value = integer(key, min, max)
    if (value !== undefined) options[key] = value
  }
  if (body?.carry === true) options.carry = true
  // Root scheduler: the repeatable round-robin split by default, the dynamic one on
  // request. They are not equivalent - a fixed per-worker slice discards a ply when one
  // root move outgrows it, and at 12 threads that costs about 5 points of win rate.
  if (body?.dynamicRoot === true) options.dynamicRoot = true
  // Audit fields (the eval's own numbers, White's modelled reply probability and
  // the fixed-depth value) cost one extra policy build per move. On by default
  // because the loss explanation is built from them.
  if (body?.audit === false) options.audit = false

  // A locked set: play exactly these games instead of generating a batch. The
  // engine derives the faction list from them, so none is sent.
  const replay = Array.isArray(body?.replay) ? body.replay : null
  if (replay) {
    const games = replay
      .map((game) => ({
        faction: String(game?.faction ?? ""),
        game: Math.floor(Number(game?.game ?? 0)),
        draws: Math.max(0, Math.floor(Number(game?.draws ?? 0))),
      }))
      .filter((game) => game.faction && game.game > 0)
      .slice(0, 5000)
    if (games.length === 0) {
      return sendJson(res, 400, { error: "replay needs at least one {faction, game, draws} entry" })
    }
    options.replay = games
    delete options.factions
  }
  const whiteMass = Number(body?.whiteMass)
  if (Number.isFinite(whiteMass) && whiteMass > 0 && whiteMass <= 1) options.whiteMass = whiteMass
  if (![5, 7, 9, 13, 19].includes(options.size)) {
    return sendJson(res, 400, { error: "size must be 5, 7, 9, 13 or 19" })
  }

  const resolved = options.replay
    ? [...new Set(options.replay.map((game) => game.faction))]
    : options.factions ?? (options.size === 19 ? ["WorldDaemon"] : BENCH_FACTIONS)

  // Each faction plays with the widths the caller sent; factions it does not mention
  // fall back to their stored setting, then to the engine defaults. The page sends an
  // explicit triple per faction, which is what its Run table displays.
  if (body?.useStoredTuning !== false) {
    const sent = body?.tuningByFaction
    const tuningByFaction = {}
    if (sent && typeof sent === "object") {
      for (const faction of resolved) {
        const triple = sent[faction]
        const beam = tuneInt(triple?.beam, 1, 64, 0)
        const whiteChildren = tuneInt(triple?.whiteChildren, 1, 64, 0)
        const whiteMass = Number(triple?.whiteMass)
        if (beam > 0 && whiteChildren > 0 && Number.isFinite(whiteMass) && whiteMass >= 0.05 && whiteMass <= 1) {
          tuningByFaction[faction] = { beam, whiteChildren, whiteMass }
        }
      }
    }
    if (Object.keys(tuningByFaction).length === 0) {
      const store = readTuningStore()
      for (const faction of resolved) {
        const applied = store[faction]?.applied
        if (applied) tuningByFaction[faction] = applied
      }
    }
    if (Object.keys(tuningByFaction).length > 0) options.tuningByFaction = tuningByFaction
  }

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
    benchBroadcast("error", { error: bench.state.error })
  })
  child.on("error", (err) => {
    bench.state.error = err.message
    bench.state.running = false
    if (bench.child === child) bench.child = null
    benchBroadcast("snapshot", benchSnapshot())
  })
  child.on("close", () => {
    bench.state.running = false
    bench.state.endedAt = Date.now()
    if (bench.child === child) bench.child = null
    benchBroadcast("snapshot", benchSnapshot())
  })

  benchBroadcast("snapshot", benchSnapshot())
  sendJson(res, 200, { ok: true, options: bench.state.options })
}

function handleBenchStop(req, res) {
  stopBench()
  bench.state.endedAt = Date.now()
  sendJson(res, 200, { ok: true })
}

// ---- Auto-tuner: per-faction genetic search over the widths ---------------
// The engine runs the whole algorithm (selection, breeding, held-back
// validation); the server only spawns it and forwards the NDJSON it prints, so
// a closed page cannot lose a run and the CLI stays the single source of truth.

/** @type {Set<import("http").ServerResponse>} */
const tuneClients = new Set()

// Per-faction tuning, kept beside the engine so it survives a server restart and is
// shared by the GUI and the CLI. `applied` is what play uses; `best` is where the
// next tuning run resumes from. Untracked (temp/ is in .gitignore).
const TUNING_FILE = path.join(__dirname, "temp", "tuning.json")

function readTuningStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TUNING_FILE, "utf8"))
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
  } catch {
    /* missing or unreadable: start from nothing */
  }
  return {}
}

function writeTuningStore(store) {
  fs.mkdirSync(path.dirname(TUNING_FILE), { recursive: true })
  fs.writeFileSync(TUNING_FILE, JSON.stringify(store, null, 2) + "\n")
}

function tuningSnapshot() {
  return { store: readTuningStore(), file: path.relative(__dirname, TUNING_FILE) }
}

function handleTuneSettings(req, res) {
  sendJson(res, 200, tuningSnapshot())
}

// Body: { faction, action: "apply" | "clear", genome?: {beam, whiteChildren, whiteMass} }
function handleTuneApply(req, res, body) {
  const faction = String(body?.faction ?? "")
  if (!faction) return sendJson(res, 400, { error: "faction is required" })
  const store = readTuningStore()
  const entry = store[faction] ?? {}
  const action = String(body?.action ?? "apply")
  if (action === "clear") {
    delete entry.applied
  } else {
    const genome = body?.genome ?? {}
    const beam = tuneInt(genome.beam, 0, 64, 0)
    const whiteChildren = tuneInt(genome.whiteChildren, 0, 32, 0)
    const whiteMass = Number(genome.whiteMass)
    if (beam <= 0 || whiteChildren <= 0 || !Number.isFinite(whiteMass) || whiteMass <= 0 || whiteMass > 1) {
      return sendJson(res, 400, { error: "genome needs beam > 0, whiteChildren > 0, whiteMass in (0, 1]" })
    }
    entry.applied = { beam, whiteChildren, whiteMass }
  }
  if (Object.keys(entry).length === 0) delete store[faction]
  else store[faction] = entry
  writeTuningStore(store)
  tuneBroadcast("settings", tuningSnapshot())
  sendJson(res, 200, tuningSnapshot())
}

const tune = {
  child: null,
  // Factions still to run, and where we are in that list. Empty when not queueing.
  queue: { factions: [], index: 0, options: null, durations: [], averageFactionMs: 0, factionStartedAt: 0 },
  state: {
    running: false,
    faction: null,
    size: 5,
    options: null,
    generations: [],
    done: null,
    error: null,
    startedAt: 0,
    endedAt: 0,
  },
}

function tuneSnapshot() {
  const queue = tune.queue
  return {
    ...tune.state,
    ...tuneEta(),
    queue: queue.factions.length
      ? { index: queue.index + 1, total: queue.factions.length, faction: queue.factions[queue.index], order: queue.factions }
      : null,
    pid: undefined,
    serverId,
    supervised,
  }
}

// Time left, from the rate actually observed so far rather than from a guess: the
// elapsed time divided by the generations that finished, times the ones still to run.
// The queue estimate adds one faction's worth of time per faction still queued, using
// the average of the factions already finished when there is one.
function tuneEta() {
  const state = tune.state
  const now = Date.now()
  const elapsedMs = state.startedAt ? (state.endedAt || now) - state.startedAt : 0
  const doneGens = state.generations.length
  const totalGens = state.options?.generations ?? 0
  const perGenMs = doneGens > 0 ? elapsedMs / doneGens : 0
  const etaMs = state.running && perGenMs > 0 && totalGens > doneGens ? perGenMs * (totalGens - doneGens) : 0
  const queue = tune.queue
  let queueEtaMs = 0
  if (queue.factions.length > 0) {
    const remaining = Math.max(0, queue.factions.length - queue.index - 1)
    const factionMs = queue.averageFactionMs > 0 ? queue.averageFactionMs : perGenMs * totalGens
    queueEtaMs = etaMs + remaining * factionMs
  }
  return { elapsedMs, etaMs, queueEtaMs, perGenMs }
}

function tuneBroadcast(event, data) {
  if (tuneClients.size === 0) return
  const payload = JSON.stringify(data)
  for (const res of tuneClients) {
    try {
      res.write(`event: ${event}\ndata: ${payload}\n\n`)
    } catch {
      tuneClients.delete(res)
    }
  }
}

function stopTune() {
  const child = tune.child
  tune.child = null
  tune.state.running = false
  // Stopping cancels the whole queue, not just the faction in flight.
  tune.queue = { factions: [], index: 0, options: null, durations: [], averageFactionMs: 0, factionStartedAt: 0 }
  if (!child) return
  try {
    child.kill()
  } catch {
    /* already gone */
  }
}

function tuneInt(value, min, max, fallback) {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

// Normalises an incoming search box to { key: [lo, hi] }, or null when the caller did
// not ask for one. Ranges the engine would clamp anyway are clamped here too, so the
// panel shows what will actually be searched.
function tuneRanges(input) {
  if (!input || typeof input !== "object") return null
  const pair = (value, lo, hi, fallback) => {
    if (!Array.isArray(value) || value.length !== 2) return fallback
    const a = Number(value[0])
    const b = Number(value[1])
    if (!Number.isFinite(a) || !Number.isFinite(b)) return fallback
    const clamped = [Math.min(hi, Math.max(lo, a)), Math.min(hi, Math.max(lo, b))]
    return [Math.min(...clamped), Math.max(...clamped)]
  }
  return {
    beam: pair(input.beam, 1, 64, [2, 24]),
    whiteChildren: pair(input.whiteChildren, 1, 64, [1, 16]),
    whiteMass: pair(input.whiteMass, 0.01, 1, [0.05, 1]),
  }
}

// Builds the option object shared by a single run and by a queue of runs.
function tuneOptions(body, faction, size) {
  return {
    faction,
    size,
    generations: tuneInt(body?.generations, 1, 60, 6),
    population: tuneInt(body?.population, 2, 40, 10),
    games: tuneInt(body?.games, 4, 400, 24),
    nodeLimit: tuneInt(body?.nodeLimit, 100, 200000, 1000),
    threads: tuneInt(body?.threads, 1, 64, Math.max(1, os.cpus().length)),
    seed: tuneInt(body?.seed, 1, Number.MAX_SAFE_INTEGER, 1),
    resume: body?.resume !== false,
    // A queued run stores each faction's winner as its play setting as it finishes,
    // which is the point of leaving it running unattended.
    autoApply: body?.autoApply === true,
    // Carry memo shares exact search results across the moves of a game. On by
    // default: it is ~30% faster per move and the freed budget buys extra depth, but
    // it does change the numbers, so both arms of any A/B must use the same setting.
    carry: body?.carry !== false,
    rangesFor: (name) => tuneRanges(body?.rangesByFaction?.[name] ?? body?.ranges),
  }
}

// Runs one faction. The queue (tune.queue) decides whether another follows.
function beginTuneRun(faction, options) {
  const exe = mcgsExecutablePath()
  if (!fs.existsSync(exe)) {
    tune.state.running = false
    tune.state.error = "Engine not built. Run: pnpm run ipvgo:build"
    // No child will ever fire `close`, so a queue left here would stall forever.
    tune.queue = { factions: [], index: 0, options: null, durations: [], averageFactionMs: 0, factionStartedAt: 0 }
    tuneBroadcast("snapshot", tuneSnapshot())
    return
  }

  tune.state.running = true
  tune.state.faction = faction
  tune.state.size = options.size
  tune.state.options = options
  tune.state.generations = []
  tune.state.done = null
  tune.state.error = null
  tune.state.startedAt = Date.now()
  tune.state.endedAt = 0

  const args = [
    "tune",
    faction,
    String(options.generations),
    String(options.population),
    String(options.games),
    String(options.nodeLimit),
    String(options.size),
    String(options.threads),
    String(options.seed),
    "json",
  ]
  // Resume from this faction's stored best unless the caller asked for a fresh start.
  const resume = options.resume ? readTuningStore()[faction]?.best : null
  const resumeTriple =
    resume && Number(resume.beam) > 0 && Number(resume.whiteChildren) > 0 && Number(resume.whiteMass) > 0
      ? [Number(resume.beam), Number(resume.whiteChildren), Number(resume.whiteMass)]
      : [0, 0, 0]
  if (resumeTriple[0] > 0) {
    options.resumeFrom = { beam: resumeTriple[0], whiteChildren: resumeTriple[1], whiteMass: resumeTriple[2] }
  } else {
    delete options.resumeFrom
  }
  // The search box is optional and travels as one JSON argument, so an old caller that
  // sends nothing gets the engine's own defaults. The carry flag follows it, which is
  // why an empty box is sent as `{}` rather than omitted.
  const ranges = options.rangesFor(faction)
  options.ranges = ranges
  args.push(...resumeTriple.map(String))
  args.push(JSON.stringify(ranges ?? {}))
  args.push(options.carry ? "carry" : "nocarry")

  const child = spawn(exe, args, { cwd: __dirname })
  tune.child = child

  let buffer = ""
  tune.queue.factionStartedAt = Date.now()
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString()
    let newline = buffer.indexOf("\n")
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        try {
          const event = JSON.parse(line)
          if (event.type === "generation") {
            tune.state.generations.push(event)
            // Every generation records its leader as this faction's "best found", so
            // the number is live during a run and a stopped run still has a resume
            // point. Waiting for `done` lost everything if the run was cut short.
            const leader = event.rows?.[0]
            if (leader?.genome) {
              const store = readTuningStore()
              const entry = store[event.faction] ?? {}
              entry.best = {
                ...leader.genome,
                winRate: leader.winRate,
                se: leader.se,
                gen: event.gen,
                source: "training",
              }
              store[event.faction] = entry
              writeTuningStore(store)
              tuneBroadcast("settings", tuningSnapshot())
            }
            tuneBroadcast("generation", { ...event, ...tuneEta() })
          } else if (event.type === "done") {
            tune.state.done = event
            // The final leader re-measured on held-back seeds: same genome, honest
            // number, and the point the next run resumes from.
            const best = event.validation?.[0]
            if (best?.genome) {
              const store = readTuningStore()
              const entry = store[event.faction] ?? {}
              entry.best = {
                ...best.genome,
                winRate: best.winRate,
                se: best.se,
                source: "validation",
                size: event.size,
                nodeLimit: event.nodeLimit,
              }
              // A queued "tune all" run applies its result, so an unattended session
              // ends with every faction upgraded rather than just measured.
              if (options.autoApply) {
                entry.applied = {
                  beam: best.genome.beam,
                  whiteChildren: best.genome.whiteChildren,
                  whiteMass: best.genome.whiteMass,
                }
              }
              store[event.faction] = entry
              writeTuningStore(store)
              tuneBroadcast("settings", tuningSnapshot())
            }
            tuneBroadcast("done", event)
          }
        } catch (err) {
          // Never swallow this silently: an exception in here once stopped every live
          // update while the run itself looked healthy, and nothing anywhere said why.
          tune.state.error = `tune event: ${err.message}`
          tuneBroadcast("error", { error: tune.state.error })
        }
      }
      newline = buffer.indexOf("\n")
    }
  })
  child.stderr.on("data", (chunk) => {
    tune.state.error = chunk.toString().trim().slice(0, 2000)
    tuneBroadcast("error", { error: tune.state.error })
  })
  child.on("error", (err) => {
    tune.state.error = err.message
    tune.state.running = false
    if (tune.child === child) tune.child = null
    tuneBroadcast("snapshot", tuneSnapshot())
  })
  child.on("close", () => {
    tune.state.endedAt = Date.now()
    if (tune.child === child) tune.child = null
    tune.state.running = false
    // Remember how long this faction took, so the queue estimate uses measured
    // faction times rather than extrapolating one faction to all of them.
    const queue = tune.queue
    if (queue.factionStartedAt) {
      queue.durations = queue.durations ?? []
      queue.durations.push(Date.now() - queue.factionStartedAt)
      queue.averageFactionMs = queue.durations.reduce((sum, ms) => sum + ms, 0) / queue.durations.length
      queue.factionStartedAt = 0
    }
    // Next faction in the queue, if this run was part of one.
    if (!advanceTuneQueue()) tuneBroadcast("snapshot", tuneSnapshot())
  })

  tuneBroadcast("snapshot", tuneSnapshot())
}

// Returns true when another faction was started.
function advanceTuneQueue() {
  const queue = tune.queue
  if (queue.factions.length === 0) return false
  if (queue.index + 1 >= queue.factions.length) {
    queue.factions = []
    queue.index = 0
    return false
  }
  queue.index += 1
  beginTuneRun(queue.factions[queue.index], queue.options)
  return true
}

async function handleTuneStart(req, res) {
  if (tune.state.running) {
    return sendJson(res, 409, { error: "A tuning run is already in progress" })
  }
  const body = await readJsonBody(req)
  if (!fs.existsSync(mcgsExecutablePath())) {
    return sendJson(res, 503, { error: "Engine not built. Run: pnpm run ipvgo:build" })
  }
  const faction = BENCH_FACTIONS.includes(String(body?.faction)) ? String(body.faction) : "Illuminati"
  const size = [5, 7, 9].includes(Number(body?.size)) ? Number(body.size) : 5
  const options = tuneOptions(body, faction, size)
  tune.queue = { factions: [], index: 0, options: null, durations: [], averageFactionMs: 0, factionStartedAt: 0 }
  beginTuneRun(faction, options)
  sendJson(res, 202, { ok: true, options })
}

// Tune every listed faction in turn, optionally storing each winner for play.
async function handleTuneStartAll(req, res) {
  if (tune.state.running) {
    return sendJson(res, 409, { error: "A tuning run is already in progress" })
  }
  const body = await readJsonBody(req)
  if (!fs.existsSync(mcgsExecutablePath())) {
    return sendJson(res, 503, { error: "Engine not built. Run: pnpm run ipvgo:build" })
  }
  const requested = Array.isArray(body?.factions) ? body.factions.map(String) : []
  const factions = BENCH_FACTIONS.filter((name) => requested.includes(name))
  if (factions.length === 0) {
    return sendJson(res, 400, { error: "factions must list at least one known faction" })
  }
  const size = [5, 7, 9].includes(Number(body?.size)) ? Number(body.size) : 5
  const options = tuneOptions(body, factions[0], size)
  tune.queue = { factions, index: 0, options, durations: [], averageFactionMs: 0, factionStartedAt: 0 }
  beginTuneRun(factions[0], options)
  sendJson(res, 202, { ok: true, options, factions })
}

function handleTuneStop(req, res) {
  stopTune()
  tune.state.endedAt = Date.now()
  tuneBroadcast("snapshot", tuneSnapshot())
  sendJson(res, 200, { ok: true })
}

function handleTuneEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  })
  if (typeof res.flushHeaders === "function") res.flushHeaders()
  sseSend(res, "snapshot", tuneSnapshot())
  tuneClients.add(res)
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n")
    } catch {
      /* removed on close */
    }
  }, 15000)
  req.on("close", () => {
    clearInterval(heartbeat)
    tuneClients.delete(res)
  })
}

// Only meaningful under scripts/dev-server.mjs: exiting makes the supervisor
// spawn a fresh process, which is how the GUI restarts the server.
const RESTART_EXIT_CODE = 75
function handleServerRestart(req, res) {
  if (!supervised) {
    return sendJson(res, 409, {
      error: "Server is not supervised. Start it with `pnpm run server:dev` to enable restarts.",
    })
  }
  stopBench()
  stopTune()
  sendJson(res, 202, { ok: true, serverId })
  // A distinct exit code tells the supervisor this exit was requested, so it
  // restarts immediately instead of treating it as a crash and backing off.
  setTimeout(() => process.exit(RESTART_EXIT_CODE), 50)
}

function handleBenchEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  })
  if (typeof res.flushHeaders === "function") res.flushHeaders()
  sseSend(res, "snapshot", benchSnapshot())
  benchClients.add(res)
  // Keeps proxies and idle connections from dropping the stream.
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n")
    } catch {
      /* removed on close */
    }
  }, 15000)
  req.on("close", () => {
    clearInterval(heartbeat)
    benchClients.delete(res)
  })
}

function handleBenchState(req, res, url) {
  const sinceRaw = Number(url?.searchParams?.get("since") ?? 0)
  const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? Math.floor(sinceRaw) : 0
  const { frames = [], frameSeq = 0, archive = [], live, ...rest } = bench.state
  sendJson(res, 200, {
    ...rest,
    pid: undefined,
    frameSeq,
    frames: since > 0 ? frames.filter((frame) => frame.seq > since) : frames,
    // Summaries only: the page fetches a game's move list when it is expanded.
    archive: archive.map((game, index) => ({
      index,
      faction: game.faction,
      game: game.game,
      win: game.win,
      margin: game.margin,
      movesPlayed: game.movesPlayed,
      moveCount: game.moves.length,
      // Needed to lock this game into a replay set.
      draws: game.draws ?? 0,
    })),
    liveMoves: live ? live.moves.length : 0,
  })
}

// One archived game with its full move list: the decision sequence behind a result.
function handleBenchGame(req, res, url) {
  const raw = Number(url?.searchParams?.get("index"))
  const game = archivedGame(url?.searchParams?.get("index"))
  if (!game) {
    sendJson(res, 404, { error: `no archived game at index ${url?.searchParams?.get("index")}` })
    return
  }
  if (url?.searchParams?.get("format") === "text") {
    sendJson(res, 200, {
      index: Math.floor(raw),
      text: explainGame(game, { threshold: explainThreshold(url) }),
      path: null,
    })
    return
  }
  sendJson(res, 200, game)
}

function archivedGame(rawIndex) {
  const raw = Number(rawIndex)
  const { archive = [] } = bench.state
  if (!Number.isFinite(raw) || raw < 0 || raw >= archive.length) return null
  return archive[Math.floor(raw)]
}

function explainThreshold(url) {
  const raw = Number(url?.searchParams?.get("threshold"))
  return Number.isFinite(raw) && raw > 0 ? raw : BLUNDER_DELTA
}

// Render one archived game's explanation, write it under temp/lost-games and hand
// both back. `write: false` only renders, which is what the page's Explain button
// asks for; the Write file button leaves it on and shows the path.
async function handleBenchExplain(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return sendJson(res, 400, { error: err.message })
  }
  const game = archivedGame(body?.index)
  if (!game) {
    return sendJson(res, 404, { error: `no archived game at index ${body?.index}` })
  }
  const raw = Number(body?.threshold)
  const threshold = Number.isFinite(raw) && raw > 0 ? raw : BLUNDER_DELTA
  const text = explainGame(game, { threshold })
  let file = null
  if (body?.write !== false) {
    try {
      file = writeExplainFile(game, text, path.join(__dirname, "temp", "lost-games"))
    } catch (err) {
      return sendJson(res, 500, { error: `could not write the explanation: ${err.message}`, text })
    }
  }
  sendJson(res, 200, { index: Math.floor(Number(body.index)), path: file, text })
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
  const hasGame = fs.existsSync(mcgsExecutablePath())
  const hasNative = fs.existsSync(nativeExecutablePath())
  if (engineOverride === "native") return hasNative ? "native" : "missing"
  if (engineOverride === "mcgs") return hasGame ? "mcgs" : "missing"
  if (engineOverride === "exploit") return hasGame ? "exploit" : "missing"
  // Default: the policy exploiter, which is what this engine exists for.
  if (hasGame) return "exploit"
  if (hasNative) return "native"
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
    serverId,
    supervised,
    nativePath: nativeExecutablePath(),
    nativeBuilt: fs.existsSync(nativeExecutablePath()),
    gamePath: mcgsExecutablePath(),
    gameBuilt: fs.existsSync(mcgsExecutablePath()),
    // The bench never uses the in-game move engine; it always runs the exploiter.
    benchEngine: "exploit",
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

// ---------------------------------------------------------------------------
// Long-lived exploiter engine.
//
// The one-process-per-move path below throws the search state away every move,
// so a position solved for one move is solved again for the next. `ipvgo_game
// serve` keeps one process (and its memo) alive for the whole session and speaks
// newline-delimited JSON: one request per line, one response per line.
// ---------------------------------------------------------------------------
const engineChild = {
  proc: null,
  nextId: 1,
  pending: new Map(),
  generation: 0,
}

function engineAlive() {
  return engineChild.proc !== null && engineChild.proc.exitCode === null
}

function rejectAllPending(reason) {
  for (const { reject, timer } of engineChild.pending.values()) {
    clearTimeout(timer)
    reject(new Error(reason))
  }
  engineChild.pending.clear()
}

function spawnEngine() {
  const exe = mcgsExecutablePath()
  if (!fs.existsSync(exe)) throw new Error("exploit engine not built. Run: pnpm run ipvgo:build")

  const proc = spawn(exe, ["serve"], { cwd: __dirname, stdio: ["pipe", "pipe", "pipe"] })
  proc.stdout.setEncoding("utf8")
  proc.stderr.setEncoding("utf8")

  // A replaced engine may still be shutting down; its output and its exit must
  // not touch the current one's state.
  const generation = ++engineChild.generation
  const current = () => engineChild.generation === generation
  let buffer = ""

  proc.stdout.on("data", (chunk) => {
    if (!current()) return
    buffer += chunk
    let newline = buffer.indexOf("\n")
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf("\n")
      if (!line) continue
      let response
      try {
        response = JSON.parse(line)
      } catch {
        continue
      }
      const id = response.id ?? engineChild.nextId - 1
      const entry = engineChild.pending.get(id)
      if (!entry) continue
      clearTimeout(entry.timer)
      engineChild.pending.delete(id)
      if (response.error) entry.reject(new Error(`exploit engine: ${response.error}`))
      else entry.resolve(response)
    }
  })

  proc.stderr.on("data", (chunk) => {
    const text = String(chunk).trim()
    if (text) console.error(`[exploit engine] ${text}`)
  })

  const onGone = (why) => {
    if (!current()) return
    engineChild.proc = null
    rejectAllPending(`exploit engine ${why}`)
  }
  proc.on("exit", (code, signal) => onGone(signal ? `killed by ${signal}` : `exited with ${code}`))
  proc.on("error", (err) => onGone(`failed: ${err.message}`))

  engineChild.proc = proc
  return proc
}

function requestServeMove(body, timeoutMs) {
  if (carryMemo && body.carry === undefined) body = { ...body, carry: true }
  if (!engineAlive()) spawnEngine()
  const id = engineChild.nextId++
  const proc = engineChild.proc
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      engineChild.pending.delete(id)
      reject(new Error("exploit engine timed out"))
    }, timeoutMs)
    engineChild.pending.set(id, { resolve, reject, timer })
    try {
      proc.stdin.write(`${JSON.stringify({ ...body, id })}\n`)
    } catch (err) {
      clearTimeout(timer)
      engineChild.pending.delete(id)
      reject(err)
    }
  })
}

// The engine drops its own cache when a request reports a shorter move history,
// which is what a new game does, so a session never outlives a game. Recycling on
// a game change is belt and braces: a different opponent or board size means a
// different search configuration, and a wedged engine is worth replacing anyway.
let engineGameKey = null

function stopEngine() {
  const proc = engineChild.proc
  engineChild.proc = null
  engineGameKey = null
  if (!proc) return
  try {
    proc.stdin.end()
  } catch {
    /* ignore */
  }
  const killer = setTimeout(() => {
    try {
      proc.kill()
    } catch {
      /* ignore */
    }
  }, 2000)
  if (killer.unref) killer.unref()
}

async function requestExploitMove(body) {
  const gameKey = JSON.stringify({ opponent: body.opponent ?? null, size: body.board?.length ?? null })
  if (engineGameKey !== gameKey) {
    stopEngine()
    engineGameKey = gameKey
  }
  try {
    const result = await requestServeMove(body, 300_000)
    return { ...result, engine: "exploit" }
  } catch (err) {
    // A crashed engine must not wedge the game: fall back to one-shot execution.
    stopEngine()
    console.error(`[exploit engine] falling back to one-shot: ${err.message}`)
    return requestGameMove(body, {
      command: "exploitmove",
      engine: "exploit",
      tempPrefix: "exploit",
      timeoutMs: 300_000,
    })
  }
}

async function requestExploitPonder(body) {
  const gameKey = JSON.stringify({ opponent: body.opponent ?? null, size: body.board?.length ?? null })
  if (engineGameKey !== gameKey) {
    stopEngine()
    engineGameKey = gameKey
  }
  // Speculation only: no one-shot fallback, a failed ponder just means no head start.
  return requestServeMove(body, 10_000)
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
  // The long-lived engine is mid-search for whichever request is pending.
  stopEngine()
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
  if (engine === "native" || engine === "mcgs" || engine === "exploit") {
    cancelNativeMove()
  }

  sendJson(res, 200, { ok: true, requestId })
}

async function handleMove(req, res) {
  const engine = activeEngine()
  if (engine === "missing") {
    return sendJson(res, 503, {
      error: "No engine available. Run: pnpm run ipvgo:build",
    })
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return sendJson(res, 400, { error: err.message })
  }

  try {
    if (body?.ponder) {
      if (engine !== "exploit") return sendJson(res, 200, { ponder: "unsupported" })
      try {
        return sendJson(res, 200, await requestExploitPonder(body))
      } catch (err) {
        return sendJson(res, 200, { ponder: "failed", error: err.message })
      }
    }
    const result =
      engine === "mcgs"
        ? await requestMcgsMove(body)
        : engine === "exploit"
          ? await requestExploitMove(body)
          : await requestNativeMove(body)
    sendJson(res, 200, result)
  } catch (err) {
    console.error(`${engine} move error:`, err.message)
    if (engine === "exploit") {
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
    handleBenchState(req, res, url)
    return
  }

  if (req.method === "GET" && url.pathname === "/api/bench/events") {
    handleBenchEvents(req, res)
    return
  }

  if (req.method === "GET" && url.pathname === "/api/bench/game") {
    handleBenchGame(req, res, url)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/bench/explain") {
    await handleBenchExplain(req, res)
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

  if (req.method === "GET" && url.pathname === "/api/tune/events") {
    handleTuneEvents(req, res)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/tune/start") {
    await handleTuneStart(req, res)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/tune/start-all") {
    await handleTuneStartAll(req, res)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/tune/stop") {
    handleTuneStop(req, res)
    return
  }

  if (req.method === "GET" && url.pathname === "/api/tune/settings") {
    handleTuneSettings(req, res)
    return
  }

  if (req.method === "POST" && url.pathname === "/api/tune/apply") {
    await handleTuneApply(req, res, await readJsonBody(req))
    return
  }

  if (req.method === "POST" && url.pathname === "/api/server/restart") {
    handleServerRestart(req, res)
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

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[server] port ${port} is already in use - is another server still running?`)
    console.error('[server] stop it, or set IPVGO_PORT to a free port')
  } else {
    console.error(`[server] ${err.message}`)
  }
  process.exit(1)
})

server.listen(port, () => {
  const engine = activeEngine()
  console.log(`IPvGO engine server http://localhost:${port}`)
  console.log(`In-game move engine: ${engine}  (POST /api/ipvgo/move only)`)
  console.log(`Bench GUI: http://localhost:${port}/bench  (always the C++ exploiter, ipvgo_game)`)
  console.log(`Health: http://localhost:${port}/health`)
  console.log(`Move API: POST http://localhost:${port}/api/ipvgo/move`)
  if (supervised) console.log("Restart: enabled (supervised - POST /api/server/restart)")
})

process.on("SIGINT", () => {
  stopBench()
  stopEngine()
  process.exit(0)
})

process.on("SIGTERM", () => {
  stopBench()
  stopEngine()
  process.exit(0)
})
