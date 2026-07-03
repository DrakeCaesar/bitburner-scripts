/**
 * KingOfTheHill (globalMaxima) solver simulation — matches bitburner-src game logic.
 *
 * Run: node tests/kingOfTheHillSim.mjs
 *      node tests/kingOfTheHillSim.mjs --seed 42 --count 10 --difficulty 60
 */

const NUMBERS = "0123456789"
const MAX_PASSWORD_LENGTH = 50
/** Difficulty 54+ → 10-digit passwords; 32+ → 9 Gaussian hills (max). */
const DEFAULT_DIFFICULTY = 60
const DEFAULT_COUNT = 10
const DEFAULT_SEED = 0x4b6f7468 // "Koth"

// --- Game: bitburner-src/src/Casino/RNG.ts (WHRNG) ---

class WHRNG {
  constructor(totalPlaytime) {
    const v = (totalPlaytime / 1000) % 30000
    this.s1 = v
    this.s2 = v
    this.s3 = v
  }

  step() {
    this.s1 = (171 * this.s1) % 30269
    this.s2 = (172 * this.s2) % 30307
    this.s3 = (170 * this.s3) % 30323
  }

  random() {
    this.step()
    return (this.s1 / 30269.0 + this.s2 / 30307.0 + this.s3 / 30323.0) % 1.0
  }
}

// --- Game: bitburner-src/src/DarkNet/effects/authentication.ts ---

function getAltitudeGivenHillSpecs(x, location, height, width) {
  return height * Math.exp(((x - location) ** 2 / width ** 2) * -1)
}

/** Same as getKingOfTheHillAltitude(server, attemptedPassword). */
function getKingOfTheHillAltitude(server, attemptedPassword) {
  const password = Number(server.password)
  const x = Number(attemptedPassword)
  const rng = new WHRNG(password)
  const hillCount = Math.min(Math.floor(server.difficulty / 8), 4) * 2 + 1
  const passwordHillIndex = Math.floor(rng.random() * (hillCount - 2)) + 1
  const width = 10 ** Math.max(server.password.length - 2, 0) + 1

  if (Math.abs((x - password) / password) < 0.03) {
    return getAltitudeGivenHillSpecs(x, password, 10000, width)
  }

  let altitude = 0
  for (let i = 0; i < hillCount; i++) {
    const locationOffset = (i - passwordHillIndex) * width * 3 * (rng.random() * 0.2 + 0.9)
    const heightOffset = Math.abs((i - passwordHillIndex) * 2600) * (rng.random() * 0.1 + 0.95)
    altitude += getAltitudeGivenHillSpecs(x, password + locationOffset, 10000 - heightOffset, width)
  }

  return altitude
}

function authKingOfTheHill(server, attemptedPassword) {
  if (server.password === attemptedPassword) {
    return { success: true }
  }
  const altitude = getKingOfTheHillAltitude(server, attemptedPassword)
  const message = `current altitude: ${altitude.toFixed(5)} m; highest peak: 10,000 m`
  return { success: false, feedback: `${altitude}`, message }
}

// --- Game: bitburner-src/src/DarkNet/controllers/ServerGenerator.ts ---

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** getPassword with injectable RNG (game uses Math.random). */
function getPasswordSeeded(length, rng, allowLetters = false) {
  const characters = NUMBERS + (allowLetters ? "" : "")
  let password = ""
  const cappedLength = clampNumber(length, 1, MAX_PASSWORD_LENGTH)
  for (let i = 0; i < cappedLength; i++) {
    password += characters[Math.floor(rng() * characters.length)]
  }
  if (!allowLetters && Number(password) > Number.MAX_SAFE_INTEGER) {
    password = password.slice(0, 15)
  }
  if (!allowLetters) {
    return Number(password).toString()
  }
  return password
}

/** getKingOfTheHillConfig at a given difficulty. */
function buildAssignment(difficulty, rng) {
  const passwordLength = Math.min(1 + difficulty / 6, 10)
  const password = getPasswordSeeded(passwordLength, rng, false)
  return {
    difficulty,
    password,
    passwordLength: password.length,
    modelId: "globalMaxima",
    staticPasswordHint: "Ascend the highest mountain!",
  }
}

// --- Seeded assignment RNG (deterministic suite) ---

function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- Copied from src/dnet/solvers/impl/all.ts (KingOfTheHill) ---

const KING_MAIN_PEAK_ALTITUDE = 7500

function kingOfTheHillStartRescan(state, phase) {
  const span = state.max - state.min
  state.rescanPhase = phase
  state.finished = false
  state.finals = []
  state.finalIdx = 0
  state.sweepIdx = state.min
  state.sweepEnd = state.max
  state.passNum = 900 + phase
  if (phase === 1) {
    state.step = Math.max(1, Math.ceil(span / 80))
  } else if (phase === 2) {
    state.step = Math.max(1, Math.ceil(span / 250))
  } else {
    state.step = Math.max(1, Math.ceil(span / 800))
  }
}

function kingOfTheHillNeedsRescan(state) {
  return state.bestAlt != null && state.bestAlt < KING_MAIN_PEAK_ALTITUDE
}

function kingOfTheHillMaybeRescan(state) {
  if (!kingOfTheHillNeedsRescan(state)) return false
  if (state.rescanPhase >= 3) return false
  kingOfTheHillStartRescan(state, state.rescanPhase + 1)
  return true
}

function parseKingOfTheHillAltitude(feedback, message) {
  if (typeof feedback === "number" && Number.isFinite(feedback)) return feedback
  if (typeof feedback === "string") {
    const trimmed = feedback.trim()
    if (trimmed.length > 0) {
      const direct = Number(trimmed)
      if (Number.isFinite(direct)) return direct
    }
  }
  if (typeof message === "string") {
    const fromMessage = message.match(/current altitude:\s*([-\d.]+)/i)
    if (fromMessage) {
      const alt = Number(fromMessage[1])
      if (Number.isFinite(alt)) return alt
    }
  }
  return null
}

function kingOfTheHillBuildFinals(state) {
  const span = state.max - state.min
  const out = []
  if (span <= 12) {
    for (let d = 0; d <= span; d++) {
      if (d === 0) {
        if (state.bestVal >= state.min && state.bestVal <= state.max) out.push(state.bestVal)
        continue
      }
      for (const sign of [-1, 1]) {
        const c = state.bestVal + sign * d
        if (c >= state.min && c <= state.max) out.push(c)
      }
    }
    return out
  }

  const nearMainPeak = state.bestAlt != null && state.bestAlt >= KING_MAIN_PEAK_ALTITUDE
  const maxRadius = nearMainPeak ? 9 : Math.min(99, Math.max(25, Math.ceil(span / 40)))
  for (let d = 0; d <= maxRadius; d++) {
    if (d === 0) {
      if (state.bestVal >= state.min && state.bestVal <= state.max) out.push(state.bestVal)
      continue
    }
    for (const sign of [-1, 1]) {
      const c = state.bestVal + sign * d
      if (c >= state.min && c <= state.max) out.push(c)
    }
  }
  return out
}

function initKingOfTheHillState(details) {
  const min = 10 ** (details.passwordLength - 1)
  const max = 10 ** details.passwordLength - 1
  const step = Math.max(1, Math.ceil((max - min) / 25))
  return {
    type: "kingOfTheHill",
    min,
    max,
    bestVal: min,
    bestAlt: null,
    step,
    sweepIdx: min,
    sweepEnd: max,
    passNum: 0,
    finished: false,
    finals: [],
    finalIdx: 0,
    dispatched: false,
    rescanPhase: 0,
  }
}

function kingOfTheHillNextGuess(state) {
  if (state.dispatched) return null

  while (state.sweepIdx > state.sweepEnd) {
    if ((state.bestAlt == null || state.bestAlt <= 0) && state.passNum === 0) {
      state.sweepIdx = state.min
      state.sweepEnd = state.max
      state.step = 1
      state.passNum = 999
      continue
    }

    if (kingOfTheHillMaybeRescan(state)) continue

    const prevStep = state.step
    state.step = Math.max(1, Math.ceil(prevStep / 8))
    if (state.step >= prevStep) {
      if (kingOfTheHillMaybeRescan(state)) continue
      state.finished = true
      break
    }
    state.sweepIdx = Math.max(state.min, state.bestVal - prevStep)
    state.sweepEnd = Math.min(state.max, state.bestVal + prevStep)
    state.passNum++
  }

  if (!state.finished) {
    const g = state.sweepIdx
    return { guess: String(g), detail: `p${state.passNum}-${g}` }
  }

  if (state.finals.length === 0) {
    state.finals = kingOfTheHillBuildFinals(state)
  }
  if (state.finalIdx < state.finals.length) {
    const c = state.finals[state.finalIdx]
    return { guess: String(c), detail: `final ${c}` }
  }
  return null
}

function kingOfTheHillApplyResult(state, guess, result) {
  if (result.success) return state
  if (!state.finished) {
    state.sweepIdx += state.step
  } else if (state.finalIdx < state.finals.length) {
    state.finalIdx++
  }
  const g = Number(guess)
  const alt = parseKingOfTheHillAltitude(result.feedback, result.message)
  if (alt == null) return state
  if (state.bestAlt == null || alt > state.bestAlt) {
    state.bestAlt = alt
    state.bestVal = g
  }
  return state
}

function runSolver(assignment) {
  const server = {
    password: assignment.password,
    difficulty: assignment.difficulty,
  }
  let state = initKingOfTheHillState({ passwordLength: assignment.passwordLength })
  let guesses = 0
  let solved = false

  while (true) {
    const next = kingOfTheHillNextGuess(state)
    if (!next) break
    guesses++
    const result = authKingOfTheHill(server, next.guess)
    state = kingOfTheHillApplyResult(state, next.guess, result)
    if (result.success) {
      solved = true
      break
    }
  }

  return { guesses, solved, bestVal: state.bestVal, bestAlt: state.bestAlt }
}

// --- CLI ---

function parseArgs(argv) {
  let seed = DEFAULT_SEED
  let count = DEFAULT_COUNT
  let difficulty = DEFAULT_DIFFICULTY
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--seed" && argv[i + 1]) seed = Number(argv[++i])
    else if (argv[i] === "--count" && argv[i + 1]) count = Number(argv[++i])
    else if (argv[i] === "--difficulty" && argv[i + 1]) difficulty = Number(argv[++i])
  }
  return { seed, count, difficulty }
}

const { seed, count, difficulty } = parseArgs(process.argv)
const passwordLength = Math.min(1 + difficulty / 6, 10)
const hillCount = Math.min(Math.floor(difficulty / 8), 4) * 2 + 1

console.log("=== KingOfTheHill solver simulation ===")
console.log(`model=KingOfTheHill format=numeric difficulty=${difficulty}`)
console.log(`passwordLength=${passwordLength} hills=${hillCount} assignments=${count} seed=${seed}`)
console.log("auth + altitude: bitburner-src authentication.ts / ServerGenerator.ts\n")

const rows = []
for (let i = 0; i < count; i++) {
  const rng = mulberry32((seed + i * 9973) >>> 0)
  const assignment = buildAssignment(difficulty, rng)
  const result = runSolver(assignment)
  rows.push({ index: i + 1, assignment, ...result })
}

const header = "#  password      len  guesses  solved  bestVal     bestAlt"
console.log(header)
console.log("-".repeat(header.length))
for (const row of rows) {
  const pw = row.assignment.password.padEnd(12, " ")
  const len = String(row.assignment.passwordLength).padStart(3, " ")
  const guesses = String(row.guesses).padStart(7, " ")
  const solved = row.solved ? "yes" : "NO "
  const bestVal = String(row.bestVal).padStart(11, " ")
  const bestAlt = row.bestAlt != null ? row.bestAlt.toFixed(2).padStart(8, " ") : "     n/a"
  console.log(`${String(row.index).padStart(2, " ")}  ${pw}  ${len}  ${guesses}  ${solved}  ${bestVal}  ${bestAlt}`)
}

const solvedCount = rows.filter((r) => r.solved).length
const guessCounts = rows.map((r) => r.guesses)
const total = guessCounts.reduce((a, b) => a + b, 0)
const min = Math.min(...guessCounts)
const max = Math.max(...guessCounts)
const avg = total / guessCounts.length

console.log("")
console.log(`Solved: ${solvedCount}/${count}`)
console.log(`Guesses: min=${min} max=${max} avg=${avg.toFixed(1)} total=${total}`)

if (solvedCount < count) {
  console.error("\nFAIL: solver did not auth on every assignment")
  process.exit(1)
}
