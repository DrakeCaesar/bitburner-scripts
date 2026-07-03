/**
 * Standalone Factori-Os solver simulation (no Bitburner).
 *
 * Game model: divisibility probes return feedback "true"/"false".
 * Password is a product of prime powers (hint: "divisible by 1 ;)").
 *
 * Run: node tests/factoriOsSim.mjs
 * Run with a known password: node tests/factoriOsSim.mjs 9466383360
 * Run with length only (sample password): node tests/factoriOsSim.mjs --length 10
 */

const FACTORIOS_PRIMES = [
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97,
]
const FACTORIOS_LARGE_PRIMES = [
  1069, 1409, 1471, 1567, 1597, 1601, 1697, 1747, 1801, 1889, 1979, 1999, 2063, 2207, 2371, 2503, 2539, 2693, 2741,
  2753, 2801, 2819, 2837, 2909, 2939, 3169, 3389, 3571, 3761, 3881, 4217, 4289, 4547, 4729, 4789, 4877, 4943, 4951,
  4957, 5393, 5417, 5419, 5441, 5519, 5527, 5647, 5779, 5881, 6007, 6089, 6133, 6389, 6451, 6469, 6547, 6661, 6719,
  6841, 7103, 7549, 7559, 7573, 7691, 7753, 7867, 8053, 8081, 8221, 8329, 8599, 8677, 8761, 8839, 8963, 9103, 9199,
  9343, 9467, 9551, 9601, 9739, 9749, 9859,
]

function factoriOsPrimeList(state) {
  return state.largePhase ? FACTORIOS_LARGE_PRIMES : FACTORIOS_PRIMES
}

function factoriOsPrimeAt(state) {
  return factoriOsPrimeList(state)[state.primeIdx]
}

function factoriOsExhaustPrimeSearch(state) {
  state.primeIdx = factoriOsPrimeList(state).length
}

function factoriOsLargePrimeRange(product, length) {
  return {
    min: Math.ceil(10 ** (length - 1) / product),
    max: Math.floor((10 ** length - 1) / product),
  }
}

/** Matches src/DarkNet/effects/authentication.ts divisibilityTest branch. */
function factoriOsProbeResult(password, guess) {
  if (guess === password) {
    return { success: true, feedback: undefined, message: "auth ok" }
  }
  const pw = Number(password)
  const attemptedDivisor = Number(guess)
  if (Number.isNaN(attemptedDivisor) || pw % attemptedDivisor || guess === "") {
    return {
      success: false,
      feedback: "false",
      message: `Password is not divisible by '${guess}'`,
    }
  }
  return {
    success: false,
    feedback: "true",
    message: `Password IS divisible by '${guess}'`,
  }
}

/** Coerce heartbleed auth log data (matches worker.ts). */
function normalizeAuthFeedback(data) {
  if (typeof data === "string") return data
  if (typeof data === "boolean") return data ? "true" : "false"
  if (typeof data === "number" && Number.isFinite(data)) return String(data)
  return undefined
}

function parseBoolFeedback(data) {
  if (data === true || data === "true") return true
  if (data === false || data === "false") return false
  return null
}

function initFactoriOsState(passwordLength) {
  return {
    type: "factoriOs",
    primeIdx: 0,
    product: 1,
    phase: "prime",
    currentPower: 0,
    nextPower: 0,
    length: passwordLength,
    finalDispatched: false,
    needsRecheck: false,
    probedZero: false,
    largePhase: false,
  }
}

/** Mirror of factoriOs.nextGuess in solverState.ts */
function factoriOsNextGuess(state) {
  if (state.finalDispatched) return null
  if (!state.probedZero) {
    return { guess: "0", detail: "factoriOs discard" }
  }

  for (;;) {
    if (state.phase === "prime" || state.needsRecheck) {
      state.needsRecheck = false
      const primes = factoriOsPrimeList(state)
      const largeRange = state.largePhase ? factoriOsLargePrimeRange(state.product, state.length) : null
      while (state.primeIdx < primes.length) {
        const p = primes[state.primeIdx]
        if (largeRange && (p < largeRange.min || p > largeRange.max)) {
          state.primeIdx++
          continue
        }
        const pStr = String(p)
        if (pStr.length > state.length) {
          factoriOsExhaustPrimeSearch(state)
          break
        }
        return { guess: pStr, detail: `prime ${p}` }
      }
      if (!state.largePhase && String(state.product).length < state.length) {
        state.largePhase = true
        state.primeIdx = 0
        continue
      }
      const pw = String(state.product)
      if (pw.length !== state.length) return null
      state.finalDispatched = true
      return { guess: pw, detail: "factor product" }
    }

    if (String(state.nextPower).length <= state.length) {
      return { guess: String(state.nextPower), detail: `pow ${state.nextPower}` }
    }
    state.product *= state.currentPower
    if (String(state.product).length > state.length) return null
    state.phase = "prime"
    state.primeIdx++
    state.needsRecheck = true
  }
}

/** Mirror of factoriOs.applyResult in solverState.ts */
function factoriOsApplyResult(state, guess, result) {
  if (result.success) return state

  if (guess === "0" || guess === "") {
    if (!state.probedZero) state.probedZero = true
    return state
  }

  if (state.phase === "prime") {
    const fb = parseBoolFeedback(result.feedback)
    if (fb === null) return state
    if (fb) {
      const p = Number(guess)
      state.currentPower = p
      state.nextPower = p * p
      state.phase = "power"
    } else {
      state.primeIdx++
    }
  } else {
    const fb = parseBoolFeedback(result.feedback)
    if (fb === null) return state
    if (fb) {
      state.currentPower = state.nextPower
      state.nextPower = state.currentPower * factoriOsPrimeAt(state)
    } else {
      state.product *= state.currentPower
      if (String(state.product).length > state.length) {
        factoriOsExhaustPrimeSearch(state)
        return state
      }
      state.phase = "prime"
      state.primeIdx++
    }
  }
  return state
}

/** Master may call nextGuess again when needsRecheck is set after a null return. */
function planNextGuess(state) {
  for (let i = 0; i < 10; i++) {
    const next = factoriOsNextGuess(state)
    if (next) return next
    if (!state.needsRecheck) break
  }
  return null
}

function snapshot(state) {
  return {
    phase: state.phase,
    primeIdx: state.primeIdx,
    product: state.product,
    currentPower: state.currentPower,
    nextPower: state.nextPower,
    finalDispatched: state.finalDispatched,
    needsRecheck: state.needsRecheck,
    probedZero: state.probedZero,
  }
}

function simulateSolver(password, passwordLength, { maxSteps = 200, reinitOnFailedFinal = false } = {}) {
  const log = []
  let state = initFactoriOsState(passwordLength)
  let cycles = 0

  for (let step = 0; step < maxSteps; step++) {
    const next = planNextGuess(state)
    if (!next) {
      if (reinitOnFailedFinal && state.finalDispatched) {
        cycles++
        log.push({ step, event: "reinit", reason: "solver exhausted or bad product length" })
        state = initFactoriOsState(passwordLength)
        continue
      }
      log.push({ step, event: "stop", state: snapshot(state) })
      break
    }

    const result = factoriOsProbeResult(password, next.guess)
    const isFinal = next.detail === "factor product"
    const success = result.success

    log.push({
      step,
      phase: state.phase,
      primeIdx: state.primeIdx,
      guess: next.guess,
      detail: next.detail,
      feedback: isFinal ? null : result.feedback,
      message: isFinal ? result.message : result.message,
      success: isFinal ? success : false,
      ...(isFinal ? { product: state.product } : {}),
    })

    factoriOsApplyResult(state, next.guess, {
      success,
      feedback: isFinal ? undefined : result.feedback,
    })

    if (success) {
      log.push({ step, event: "solved", password })
      break
    }
  }

  return { password, passwordLength, cycles, log, finalState: snapshot(state) }
}

/** BigInt prime-power factorization using the same prime lists as the solver. */
function referenceFactorization(password) {
  let n = BigInt(password)
  const factors = []
  for (const p of [...FACTORIOS_PRIMES, ...FACTORIOS_LARGE_PRIMES]) {
    const pb = BigInt(p)
    if (pb * pb > n && n > 1n) {
      if (n > 1n) factors.push({ prime: Number(n), power: 1 })
      break
    }
    let power = 0
    while (n % pb === 0n) {
      power++
      n /= pb
    }
    if (power > 0) factors.push({ prime: p, power })
    if (n === 1n) break
  }
  let product = 1n
  for (const { prime, power } of factors) {
    product *= BigInt(prime) ** BigInt(power)
  }
  return { factors, product: product.toString() }
}

/** Build a sample password: product of random prime powers with exact digit length. */
function samplePasswordForLength(len) {
  let product = 1n
  for (const p of FACTORIOS_PRIMES) {
    if (String(p).length > len) break
    if (Math.random() < 0.65) {
      const maxPow = Math.max(1, Math.floor(Math.log(10 ** len / Number(product)) / Math.log(p)))
      const power = 1 + Math.floor(Math.random() * Math.min(maxPow, 12))
      product *= BigInt(p) ** BigInt(power)
    }
    const digits = product.toString().length
    if (digits >= len) break
  }
  let s = product.toString()
  while (s.length < len) {
    product *= 2n
    s = product.toString()
  }
  if (s.length > len) return samplePasswordForLength(len)
  return s
}

function parseArgs(argv) {
  if (argv.includes("--length")) {
    const idx = argv.indexOf("--length")
    const len = Number(argv[idx + 1])
    if (!Number.isFinite(len) || len < 1) throw new Error("usage: --length N")
    return { password: samplePasswordForLength(len), length: len, generated: true }
  }
  const arg = argv[2]
  if (!arg) {
    const length = 10
    return { password: samplePasswordForLength(length), length, generated: true }
  }
  return { password: arg, length: arg.length, generated: false }
}

// --- main ---

const { password, length, generated } = parseArgs(process.argv)

console.log("=== Factori-Os solver simulation ===")
console.log(`password=${password} length=${length}${generated ? " (generated sample)" : ""}`)
console.log('hint: "The password is divisible by 1 ;)" format=numeric model=Factori-Os\n')

console.log("--- Divisor 0 probe (bogus true in game) ---")
const zeroProbe = factoriOsProbeResult(password, "0")
console.log(`guess=0 feedback=${zeroProbe.feedback} message=${zeroProbe.message}`)

console.log("\n--- Reference factorization (BigInt) ---")
const ref = referenceFactorization(password)
console.log(ref)
const primeSet = new Set([...FACTORIOS_PRIMES, ...FACTORIOS_LARGE_PRIMES])
const missingFactors = ref.factors.filter((f) => !primeSet.has(f.prime))
if (missingFactors.length > 0) {
  console.log(
    "\n--- warning: password has prime factor(s) outside solver list ---",
  )
  console.log(
    missingFactors.map((f) => `${f.prime}^${f.power}`).join(", "),
  )
  console.log(
    "Game may include prime factor(s) outside solver lists (small + large).",
  )
}

console.log("\n--- Solver simulation (matches solverState.ts) ---")
const run = simulateSolver(password, length)
for (const entry of run.log) {
  if (entry.event) {
    console.log(entry)
  } else {
    console.log(
      `#${entry.step} phase=${entry.phase} idx=${entry.primeIdx} ` +
        `guess=${entry.guess} detail=${entry.detail}` +
        (entry.feedback != null ? ` fb=${entry.feedback}` : "") +
        (entry.success ? " SUCCESS" : ""),
    )
  }
}

const finalGuess = run.log.find((e) => e.detail === "factor product")
if (finalGuess?.success) {
  console.log("\n--- OK: factor product submits correct password ---")
} else if (finalGuess) {
  console.log("\n--- unexpected: final product mismatch ---")
  console.log(`expected ${password}, solver product=${finalGuess.guess}`)
} else {
  console.log("\n--- solver stopped before final product ---")
  console.log(run.finalState)
}

console.log("\n--- Simulated master re-register loop (only if solve fails) ---")
const loopRun = simulateSolver(password, length, { maxSteps: 400, reinitOnFailedFinal: true })
console.log(`cycles=${loopRun.cycles} total log entries=${loopRun.log.length}`)
const solved = loopRun.log.some((e) => e.event === "solved")
if (solved) {
  console.log("=> Solver completes on first pass; no probe loop.")
} else {
  const guessSequence = loopRun.log.filter((e) => e.guess).map((e) => e.guess)
  console.log("guess sequence (first 30):", guessSequence.slice(0, 30).join(", "))
  if (loopRun.cycles >= 2) {
    console.log("=> Re-init after failure reproduces the same probe cycle.")
  }
}

console.log("\n--- Timeout race (applyResult with lost guess, boolean feedback) ---")
{
  let state = initFactoriOsState(length)
  factoriOsApplyResult(state, "", { success: false, feedback: "true" })
  console.log(`empty guess after timeout: probedZero=${state.probedZero} (expect true)`)
  state = initFactoriOsState(length)
  factoriOsApplyResult(state, "2", { success: false, feedback: false })
  console.log(`prime 2 with boolean false feedback: idx=${state.primeIdx} (expect 1)`)
}
