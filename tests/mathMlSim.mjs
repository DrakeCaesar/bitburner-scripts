/**
 * Standalone MathML (parsedExpression) solver simulation (no Bitburner).
 *
 * Run: node tests/mathMlSim.mjs
 * Run with custom expression: node tests/mathMlSim.mjs --data "2 + 2" --length 1
 */

/** In-game expression from user report (unicode ops + comma-suffix injection trap). */
const DEFAULT_DATA =
  "70 ÷ 35 ➖ ( 12 ➖ 29 ) ÷ 32 ➕ 53 , !globalThis.pwn3d && (globalThis.pwn3d=true, alert(\"You've been hacked! You evaluated a string and let me inject code, didn't you? HAHAHAHA!\") , globalThis.openDevMenu() ) , ns.exit()"

const DEFAULT_LENGTH = 8

/** Copied from src/dnet/solvers/impl/all.ts (MathML). */

function cleanArithmeticExpression(expression) {
  return expression
    .replaceAll("\u04B3", "*")
    .replaceAll("\u0445", "*")
    .replaceAll("\u00F7", "/")
    .replaceAll("\u2796", "-")
    .replaceAll("\u2795", "+")
    .replaceAll("\u2212", "-")
    .replaceAll("\u00D7", "*")
    .replaceAll("\u00B7", "*")
    .replaceAll("\u2217", "*")
    .replaceAll("ns.exit(),", "")
    .split(",")[0]
}

function parseSimpleArithmeticExpression(expression) {
  const tokens = cleanArithmeticExpression(expression).split("")

  let currentDepth = 0
  const depth = tokens.map((token) => {
    if (token === "(") {
      currentDepth += 1
    } else if (token === ")") {
      currentDepth -= 1
      return currentDepth + 1
    }
    return currentDepth
  })
  const depth1Start = depth.indexOf(1)
  const firstZeroAfterDepth1Start = depth.indexOf(0, depth1Start)
  const depth1End = firstZeroAfterDepth1Start === -1 ? depth.length - 1 : firstZeroAfterDepth1Start - 1
  if (depth1Start !== -1) {
    const subExpression = tokens.slice(depth1Start + 1, depth1End).join("")
    const result = parseSimpleArithmeticExpression(subExpression)
    tokens.splice(depth1Start, depth1End - depth1Start + 1, result.toString())
    return parseSimpleArithmeticExpression(tokens.join(""))
  }

  let remainingExpression = tokens.join("")
  const multiplicationDivisionRegex = /(-?\d*\.?\d+) *([*/]) *(-?\d*\.?\d+)/
  let match = remainingExpression.match(multiplicationDivisionRegex)
  while (match) {
    const left = match[1]
    const operator = match[2]
    const right = match[3]
    const result =
      operator === "*"
        ? parseFloat(left) * parseFloat(right)
        : parseFloat(left) / parseFloat(right)
    const resultString = Math.abs(result) < 0.000001 ? result.toFixed(20) : result.toString()
    remainingExpression = remainingExpression.replace(match[0], resultString)
    match = remainingExpression.match(multiplicationDivisionRegex)
  }

  const additionSubtractionRegex = /(-?\d*\.?\d+) *([+-]) *(-?\d*\.?\d+)/
  match = remainingExpression.match(additionSubtractionRegex)
  while (match) {
    const left = match[1]
    const operator = match[2]
    const right = match[3]
    const result =
      operator === "+"
        ? parseFloat(left) + parseFloat(right)
        : parseFloat(left) - parseFloat(right)
    remainingExpression = remainingExpression.replace(match[0], result.toString())
    match = remainingExpression.match(additionSubtractionRegex)
  }

  const leftover = remainingExpression.match(/(-?\d*\.?\d+)/)
  return parseFloat(leftover?.[1] ?? "NaN")
}

function initMathMlState(data, passwordLength) {
  if (!data) return { type: "mathML", dispatched: true, guess: null, reason: "no data" }
  const result = parseSimpleArithmeticExpression(data)
  if (Number.isNaN(result) || !Number.isFinite(result)) {
    return { type: "mathML", dispatched: true, guess: null, reason: "NaN or non-finite" }
  }
  const resultStr = String(result)
  if (resultStr.length !== passwordLength) {
    return { type: "mathML", dispatched: true, guess: null, reason: `length ${resultStr.length} != ${passwordLength}` }
  }
  return { type: "mathML", dispatched: false, guess: resultStr }
}

function mathMlNextGuess(state) {
  if (state.dispatched || !state.guess) return null
  state.dispatched = true
  return { guess: state.guess, detail: "mathML" }
}

/** Matches bitburner-src isCloseToCorrectPassword for parsedExpression auth. */
function isCloseToCorrectPassword(correctPassword, attemptedPassword) {
  const difference = Math.abs(attemptedPassword - Number(correctPassword))
  return difference < 0.01 || difference / Number(correctPassword) < 0.005
}

function mathMlAuthResult(password, guess) {
  const parsed = parseFloat(guess)
  if (!Number.isNaN(parsed) && isCloseToCorrectPassword(password, parsed)) {
    return { success: true }
  }
  return { success: false, message: "The password is the evaluation of this expression" }
}

function parseArgs(argv) {
  let data = DEFAULT_DATA
  let length = DEFAULT_LENGTH
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--data" && argv[i + 1]) {
      data = argv[++i]
    } else if (argv[i] === "--length" && argv[i + 1]) {
      length = Number(argv[++i])
    }
  }
  return { data, length }
}

// --- main ---

const { data, length } = parseArgs(process.argv)

console.log("=== MathML solver simulation ===")
console.log(`format=ASCII model=MathML length=${length}`)
console.log(`hint: The password is the evaluation of this expression`)
console.log(`data: ${data}\n`)

const cleaned = cleanArithmeticExpression(data)
console.log("--- After cleanArithmeticExpression (comma/injection stripped) ---")
console.log(JSON.stringify(cleaned))

const numeric = parseSimpleArithmeticExpression(data)
console.log("\n--- Reference evaluation ---")
console.log({ numeric, asString: String(numeric), stringLength: String(numeric).length })

console.log("\n--- initSolver (matches solverState.ts) ---")
const state = initMathMlState(data, length)
console.log(state)

console.log("\n--- Solver simulation ---")
if (state.guess == null) {
  console.log("solver would not dispatch (init failed)")
  process.exit(1)
}

const next = mathMlNextGuess(state)
console.log(`guess=${next?.guess} detail=${next?.detail}`)

const auth = mathMlAuthResult(String(numeric), next.guess)
if (auth.success) {
  console.log("\n--- OK: guess auths successfully ---")
} else {
  console.log("\n--- FAIL: guess rejected by game auth ---")
  console.log(auth)
  process.exit(1)
}
