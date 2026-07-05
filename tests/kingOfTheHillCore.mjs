/**
 * KingOfTheHill game + solver logic (bitburner-src accurate).
 * Shared by kingOfTheHillSim.mjs and kingOfTheHillViz.html.
 */

export const NUMBERS = "0123456789"
export const MAX_PASSWORD_LENGTH = 50
/** Difficulty 54+ -> 10-digit passwords; 32+ -> 9 Gaussian hills (max). */
export const DEFAULT_DIFFICULTY = 60
export const DEFAULT_COUNT = 10
export const DEFAULT_SEED = 0x4b6f7468 // "Koth"
export const KING_MAIN_PEAK_ALTITUDE = 7500

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

function getAltitudeGivenHillSpecs(x, location, height, width) {
  return height * Math.exp(((x - location) ** 2 / width ** 2) * -1)
}

/** Same as getKingOfTheHillAltitude(server, attemptedPassword). */
export function getKingOfTheHillAltitude(server, attemptedPassword) {
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

export function authKingOfTheHill(server, attemptedPassword) {
  if (server.password === attemptedPassword) {
    return { success: true }
  }
  const altitude = getKingOfTheHillAltitude(server, attemptedPassword)
  const message = `current altitude: ${altitude.toFixed(5)} m; highest peak: 10,000 m`
  return { success: false, feedback: `${altitude}`, message }
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function getPasswordSeeded(length, rng, allowLetters = false) {
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

export function buildAssignment(difficulty, rng) {
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

export function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function assignmentNumericRange(assignment) {
  const min = 10 ** (assignment.passwordLength - 1)
  const max = 10 ** assignment.passwordLength - 1
  return { min, max }
}

export function toServer(assignment) {
  return { password: assignment.password, difficulty: assignment.difficulty }
}

/**
 * Sample altitude along guess values for one assignment (full valid numeric range).
 */
export function sampleAltitudeProfile(assignment, options = {}) {
  const pointCount = options.pointCount ?? 800
  const password = Number(assignment.password)
  const { min, max } = assignmentNumericRange(assignment)
  const server = toServer(assignment)
  const start = min
  const end = max

  const step = Math.max(1, Math.ceil((end - start) / pointCount))
  const points = []
  for (let x = start; x <= end; x += step) {
    points.push({
      x,
      altitude: getKingOfTheHillAltitude(server, String(x)),
      nearZone: Math.abs((x - password) / password) < 0.03,
    })
  }
  const last = points[points.length - 1]
  if (!last || last.x !== end) {
    points.push({
      x: end,
      altitude: getKingOfTheHillAltitude(server, String(end)),
      nearZone: Math.abs((end - password) / password) < 0.03,
    })
  }

  return { points, password, min, max, start, end }
}

export function generateAssignments(seed, count, difficulty) {
  const rows = []
  for (let i = 0; i < count; i++) {
    const rng = mulberry32((seed + i * 9973) >>> 0)
    rows.push({ index: i + 1, assignment: buildAssignment(difficulty, rng) })
  }
  return rows
}

// --- Solver (src/dnet/solvers/impl/all.ts) ---

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

export function runSolver(assignment) {
  const server = toServer(assignment)
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
