/**
 * Standalone BigMo%od solver simulation (no Bitburner).
 *
 * Run: node tests/bigMoSim.mjs
 * Run with a known password: node tests/bigMoSim.mjs 4895123
 */

const BIGMO_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31]

function bigMoPrimeModuliForLength(len) {
  const span = 10 ** len - 10 ** (len - 1) + 1
  const moduli = []
  let product = 1
  for (const p of BIGMO_PRIMES) {
    moduli.push(p)
    product *= p
    if (product >= span) break
  }
  return moduli
}

function bigMoProbeN(pwMax, d) {
  const target = d % 32
  let n = pwMax + 1
  while (n % 32 !== target) n++
  return n
}

/** Game formula (actual, not the simplified hint text). */
function tripleModulo(password, n) {
  const d = ((n - 1) % 32) + 1
  return (password % n) % d
}

function actualModulus(n) {
  return ((n - 1) % 32) + 1
}

/** Copied from src/darknet/solverState.ts — uses JS Number (same precision limits). */
function crtCombineNumber(r1, m1, r2, m2) {
  let [old_r, r] = [m1, m2]
  let [old_s, s] = [1, 0]
  while (r !== 0) {
    const quotient = Math.floor(old_r / r)
    ;[old_r, r] = [r, old_r - quotient * r]
    ;[old_s, s] = [s, old_s - quotient * s]
  }
  const g = old_r
  if ((r2 - r1) % g !== 0) return null
  const lcm = (m1 / g) * m2
  const x = (r1 + ((r2 - r1) / g) * old_s * m1) % lcm
  return { r: (x + lcm) % lcm, m: lcm }
}

function crtCombineBigInt(r1, m1, r2, m2) {
  let a = m1
  let b = m2
  let s0 = 1n
  let s1 = 0n
  while (b !== 0n) {
    const q = a / b
    ;[a, b] = [b, a - q * b]
    ;[s0, s1] = [s1, s0 - q * s1]
  }
  const g = a
  if ((r2 - r1) % g !== 0n) return null
  const lcm = (m1 / g) * m2
  const x = (r1 + ((r2 - r1) / g) * s0 * m1) % lcm
  return { r: ((x % lcm) + lcm) % lcm, m: lcm }
}

function bigMoPasswordFromProbes(resolved, pwMin, pwMax, length) {
  if (resolved.length === 0) return null
  let r = BigInt(resolved[0].r)
  let m = BigInt(resolved[0].d)
  for (let i = 1; i < resolved.length; i++) {
    const combined = crtCombineBigInt(r, m, BigInt(resolved[i].r), BigInt(resolved[i].d))
    if (!combined) return null
    r = combined.r
    m = combined.m
  }
  const pwMinB = BigInt(pwMin)
  const pwMaxB = BigInt(pwMax)
  let candidate = r
  if (candidate < pwMinB) {
    const k = (pwMinB - r + m - 1n) / m
    candidate = r + k * m
  }
  if (candidate > pwMaxB) return null
  const raw = candidate.toString()
  if (raw.length > length) return null
  if (raw.length < length) return raw.padStart(length, "0")
  return raw
}

function buildProbes(passwordLength) {
  const pwMin = 10 ** (passwordLength - 1)
  const pwMax = 10 ** passwordLength - 1
  const probes = []
  for (const d of bigMoPrimeModuliForLength(passwordLength)) {
    probes.push({ n: bigMoProbeN(pwMax, d), d, r: null })
  }
  return { probes, pwMin, pwMax, passwordLength }
}

function initBigMoState(passwordLength) {
  const { probes, pwMin, pwMax } = buildProbes(passwordLength)
  return {
    type: "bigMo",
    phase: "probe",
    probes,
    probeIdx: 0,
    finalDispatched: false,
    pwMin,
    pwMax,
    length: passwordLength,
  }
}

/** Mirror of bigMoSolver.nextGuess in solverState.ts */
function bigMoNextGuess(state) {
  if (state.finalDispatched) return null

  if (state.phase === "probe") {
    if (state.probeIdx < state.probes.length) {
      const p = state.probes[state.probeIdx]
      return { guess: String(p.n), detail: `bigMo d=${p.d}` }
    }
    state.phase = "solve"
  }

  if (state.phase === "solve") {
    const resolved = state.probes.filter((p) => p.r !== null)
    if (resolved.length === 0) {
      state.finalDispatched = true
      return null
    }

    const padded = bigMoPasswordFromProbes(resolved, state.pwMin, state.pwMax, state.length)
    state.finalDispatched = true
    if (!padded) return null
    return { guess: padded, detail: "bigMo CRT", candidate: Number(padded) }
  }

  state.finalDispatched = true
  return null
}

/** Mirror of bigMoSolver.applyResult */
function bigMoApplyResult(state, guess, result) {
  if (result.success) return state
  if (state.phase === "probe" && state.probeIdx < state.probes.length) {
    const fb = typeof result.feedback === "string" ? Number(result.feedback) : NaN
    if (Number.isFinite(fb) && fb >= 0) {
      state.probes[state.probeIdx].r = fb
    }
    state.probeIdx++
  }
  return state
}

function simulateSolver(password, passwordLength, { maxSteps = 40, reinitOnFailedFinal = false } = {}) {
  const log = []
  let state = initBigMoState(passwordLength)
  let cycles = 0

  for (let step = 0; step < maxSteps; step++) {
    const next = bigMoNextGuess(state)
    if (!next) {
      if (reinitOnFailedFinal && state.phase === "solve" && state.finalDispatched) {
        cycles++
        log.push({ step, event: "reinit", reason: "failed final (master re-register)" })
        state = initBigMoState(passwordLength)
        continue
      }
      log.push({ step, event: "stop", state: snapshot(state) })
      break
    }

    const n = Number(next.guess)
    const feedback = tripleModulo(password, n)
    const isFinal = next.detail === "bigMo CRT"
    const success = isFinal && next.guess === String(password)

    log.push({
      step,
      phase: state.phase,
      probeIdx: state.probeIdx,
      guess: next.guess,
      detail: next.detail,
      feedback: isFinal ? null : String(feedback),
      success,
      ...(isFinal ? { crtModulus: next.crtModulus, candidate: next.candidate } : {}),
    })

    bigMoApplyResult(state, next.guess, {
      success,
      feedback: isFinal ? undefined : String(feedback),
    })

    if (success) {
      log.push({ step, event: "solved", password })
      break
    }
  }

  return { password, passwordLength, cycles, log, finalState: snapshot(state) }
}

function snapshot(state) {
  return {
    phase: state.phase,
    probeIdx: state.probeIdx,
    finalDispatched: state.finalDispatched,
    resolvedProbes: state.probes.filter((p) => p.r !== null).length,
  }
}

function verifyCandidate(password, probes) {
  return probes.map((p) => ({
    d: p.d,
    n: p.n,
    expected: tripleModulo(password, p.n),
    actualMod: actualModulus(p.n),
    dMatchesPrime: actualModulus(p.n) === p.d,
  }))
}

function referenceSolveBigInt(password, passwordLength) {
  const { probes, pwMin, pwMax } = buildProbes(passwordLength)
  const resolved = probes.map((p) => ({ d: p.d, r: tripleModulo(password, p.n) }))
  const padded = bigMoPasswordFromProbes(resolved, pwMin, pwMax, passwordLength)
  return { candidate: padded != null ? Number(padded) : null }
}

// --- main ---

const password = Number(process.argv[2] ?? "4895123")
const length = String(password).length

console.log("=== BigMo%od solver simulation ===")
console.log(`password=${password} length=${length}\n`)

console.log("--- Probe table (first 5 from your logs) ---")
const { probes } = buildProbes(length)
for (const p of probes.slice(0, 5)) {
  const fb = tripleModulo(password, p.n)
  console.log(
    `n=${p.n} prime d=${p.d} actualD=${actualModulus(p.n)} feedback=${fb} ` +
      `(message uses n%32=${p.n % 32})`,
  )
}

console.log("\n--- Reference solve (BigInt CRT) ---")
const ref = referenceSolveBigInt(password, length)
console.log(ref)

console.log("\n--- Solver simulation (BigInt CRT, matches solverState.ts) ---")
const run = simulateSolver(password, length)
for (const entry of run.log) {
  if (entry.event) {
    console.log(entry)
  } else {
    console.log(
      `#${entry.step} phase=${entry.phase} idx=${entry.probeIdx} ` +
        `guess=${entry.guess} detail=${entry.detail}` +
        (entry.feedback != null ? ` fb=${entry.feedback}` : "") +
        (entry.candidate != null ? ` CRT=${entry.candidate} mod~${entry.crtModulus}` : "") +
        (entry.success ? " SUCCESS" : ""),
    )
  }
}

const finalGuess = run.log.find((e) => e.detail === "bigMo CRT")
if (finalGuess && finalGuess.candidate !== password) {
  console.log("\n--- unexpected: CRT candidate mismatch ---")
  console.log(`expected password ${password}, solver CRT got ${finalGuess.candidate}`)
} else if (finalGuess?.success) {
  console.log("\n--- OK: CRT submits correct password ---")
}

console.log("\n--- Legacy Number CRT (broken, for comparison) ---")
const allResolved = probes.map((p) => ({ d: p.d, r: tripleModulo(password, p.n) }))
let r = allResolved[0].r
let m = allResolved[0].d
for (let i = 1; i < allResolved.length; i++) {
  const c = crtCombineNumber(r, m, allResolved[i].r, allResolved[i].d)
  if (!c) { console.log("Number CRT inconsistent"); break }
  r = c.r
  m = c.m
}
const k = Math.ceil((10 ** (length - 1) - r) / m)
console.log(`Number CRT candidate: ${r + k * m} (often wrong or out of range)`)

console.log("\n--- Simulated master re-register loop (only if CRT fails) ---")
const loopRun = simulateSolver(password, length, { maxSteps: 80, reinitOnFailedFinal: true })
console.log(`cycles=${loopRun.cycles} total log entries=${loopRun.log.length}`)
const solved = loopRun.log.some((e) => e.event === "solved")
if (solved) {
  console.log("=> Fixed solver solves on first pass; no probe loop.")
} else {
  const guessSequence = loopRun.log.filter((e) => e.guess).map((e) => e.guess)
  console.log("guess sequence (first 25):", guessSequence.slice(0, 25).join(", "))
  if (loopRun.cycles >= 2) {
    console.log("=> Re-init after failed CRT reproduces the same probe cycle (old Number CRT bug).")
  }
}
