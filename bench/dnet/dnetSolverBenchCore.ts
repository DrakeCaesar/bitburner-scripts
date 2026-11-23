/**
 * Darknet solver benchmark core: the game's server generators and password feedback
 * (bitburner-src `DarkNet/controllers/ServerGenerator.ts`, `DarkNet/effects/authentication.ts`,
 * `DarkNet/models/packetSniffing.ts`), driven by a seeded RNG, and a loop that runs the shipped
 * solver modules (src/dnet/solvers) against them and counts guesses.
 *
 * KingOfTheHill has its own bench (bench/koth); the labyrinth is not a password model.
 *
 * Bundle + run: pnpm run test:dnet-solvers
 */

import { lookupSolver } from "../../src/dnet/solvers/registry.js"
import { COMMON_PASSWORDS } from "../../src/dnet/solvers/data/commonPasswords.js"
import type { SolverContext } from "../../src/dnet/solvers/types.js"
import type { ServerDetails } from "../../src/dnet/types.js"

// #region RNG + game data

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const numbers = "0123456789"
const lettersLowercase = "abcdefghijklmnopqrstuvwxyz"
const lettersUppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
const letters = lettersLowercase + lettersUppercase
const filler = "/[]╬╸.-()*~:;><#\\"
const MAX_PASSWORD_LENGTH = 50

const defaultSettingsDictionary = ["admin", "password", "0000", "12345"]
const dogNameDictionary = ["fido", "spot", "rover", "max"]
const EUCountries = [
  "Austria", "Belgium", "Bulgaria", "Croatia", "Republic of Cyprus", "Czech Republic", "Denmark", "Estonia",
  "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg",
  "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Sweden",
] // prettier-ignore
/** The first 93 entries are the game's commonPasswordDictionary (checked against bitburner-src). */
const commonPasswordDictionary = COMMON_PASSWORDS.slice(0, 93)
const packetSniffPhrases = [
  "We're trying to reach you about your car's extended warranty.",
  "Your password has been reset. It is now set to",
  "Join The Dark Army, and get a free t-shirt!",
  "The truth is out there.",
]
const smallPrimes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97]
const largePrimes = [
  1069, 1409, 1471, 1567, 1597, 1601, 1697, 1747, 1801, 1889, 1979, 1999, 2063, 2207, 2371, 2503, 2539, 2693, 2741,
  2753, 2801, 2819, 2837, 2909, 2939, 3169, 3389, 3571, 3761, 3881, 4217, 4289, 4547, 4729, 4789, 4877, 4943, 4951,
  4957, 5393, 5417, 5419, 5441, 5519, 5527, 5647, 5779, 5881, 6007, 6089, 6133, 6389, 6451, 6469, 6547, 6661, 6719,
  6841, 7103, 7549, 7559, 7573, 7691, 7753, 7867, 8053, 8081, 8221, 8329, 8599, 8677, 8761, 8839, 8963, 9103, 9199,
  9343, 9467, 9551, 9601, 9739, 9749, 9859,
]

// #endregion

// #region Game: generators

export interface BenchServer {
  modelId: string
  hostname: string
  password: string
  staticPasswordHint: string
  passwordHintData?: string
  difficulty: number
}

type Rng = () => number

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(Math.min(value, max), min)
}

function getPassword(rng: Rng, length: number, allowLetters = false): string {
  const characters = numbers + (allowLetters ? letters : "")
  let password = ""
  const cappedLength = clampNumber(length, 1, MAX_PASSWORD_LENGTH)
  for (let i = 0; i < cappedLength; i++) {
    password += characters[Math.floor(rng() * characters.length)]
  }
  if (!allowLetters && Number(password) > Number.MAX_SAFE_INTEGER) {
    password = password.slice(0, 15)
  }
  if (!allowLetters) return Number(password).toString()
  return password
}

function getPasswordType(password: string): ServerDetails["passwordFormat"] {
  const chars = password.split("")
  if (chars.every((c) => numbers.includes(c))) return "numeric"
  if (chars.every((c) => letters.includes(c))) return "alphabetic"
  if (chars.every((c) => numbers.includes(c) || letters.includes(c))) return "alphanumeric"
  return "ASCII"
}

function romanNumeralEncoder(input: number): string {
  const table: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ] // prettier-ignore
  let result = ""
  for (const [value, numeral] of table) {
    while (input >= value) {
      result += numeral
      input -= value
    }
  }
  return result || "nulla"
}

function encodeNumberInBaseN(decimalNumber: number, base: number): string {
  const characters = [...numbers.split(""), ...lettersUppercase.split("")]
  let digits = Math.floor(Math.log(decimalNumber) / Math.log(base))
  let remaining = decimalNumber
  let result = ""
  while (remaining >= 0.0001 || digits >= 0) {
    if (digits === -1) result += "."
    const place = Math.floor(remaining / base ** digits)
    result += characters[place]
    remaining -= place * base ** digits
    digits -= 1
  }
  return result
}

function cleanArithmeticExpression(expression: string): string {
  return expression
    .replaceAll("ҳ", "*")
    .replaceAll("÷", "/")
    .replaceAll("➕", "+")
    .replaceAll("➖", "-")
    .replaceAll("ns.exit(),", "")
    .split(",")[0]!
}

function parseSimpleArithmeticExpression(expression: string): number {
  const tokens = cleanArithmeticExpression(expression).split("")
  let currentDepth = 0
  const depth = tokens.map((token) => {
    if (token === "(") currentDepth += 1
    else if (token === ")") {
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
  let remaining = tokens.join("")
  const mulDiv = /(-?\d*\.?\d+) *([*/]) *(-?\d*\.?\d+)/
  let match = remaining.match(mulDiv)
  while (match) {
    const [, left, operator, right] = match
    const result = operator === "*" ? parseFloat(left!) * parseFloat(right!) : parseFloat(left!) / parseFloat(right!)
    const resultString = Math.abs(result) < 0.000001 ? result.toFixed(20) : result.toString()
    remaining = remaining.replace(match[0], resultString)
    match = remaining.match(mulDiv)
  }
  const addSub = /(-?\d*\.?\d+) *([+-]) *(-?\d*\.?\d+)/
  match = remaining.match(addSub)
  while (match) {
    const [, left, operator, right] = match
    const result = operator === "+" ? parseFloat(left!) + parseFloat(right!) : parseFloat(left!) - parseFloat(right!)
    remaining = remaining.replace(match[0], result.toString())
    match = remaining.match(addSub)
  }
  const [, leftover] = remaining.match(/(-?\d*\.?\d+)/) ?? ["", ""]
  return parseFloat(leftover!)
}

function generateSimpleArithmeticExpression(rng: Rng, difficulty: number): string {
  const operators = ["+", "-", "*", "/"]
  const operatorCount = Math.floor(difficulty / 4)
  const expression: (string | number)[] = []
  for (let i = 0; i < operatorCount; i++) {
    expression.push(Math.ceil(rng() * 98))
    expression.push(operators[Math.floor(rng() * operators.length)]!)
    if (difficulty > 5 && rng() < difficulty / (difficulty + 50)) {
      expression.push("(")
      expression.push(generateSimpleArithmeticExpression(rng, difficulty / 2))
      expression.push(")")
      expression.push(operators[Math.floor(rng() * operators.length)]!)
    }
  }
  expression.push(Math.ceil(rng() * 98))
  const result = expression.join(" ")
  try {
    const calc = parseSimpleArithmeticExpression(cleanArithmeticExpression(result))
    if (Math.abs(calc) < 0.1) return generateSimpleArithmeticExpression(rng, difficulty)
  } catch {
    return generateSimpleArithmeticExpression(rng, difficulty)
  }
  if (difficulty > 18) {
    return result.replaceAll("*", "ҳ").replaceAll("/", "÷").replaceAll("+", "➕").replaceAll("-", "➖")
  }
  return result
}

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)]!

type Config = Omit<BenchServer, "hostname" | "difficulty">
type Generator = (rng: Rng, difficulty: number) => Config

export const GENERATORS: Record<string, Generator> = {
  ZeroLogon: () => ({ modelId: "ZeroLogon", password: "", staticPasswordHint: "There is no password" }),
  "DeskMemo_3.1": (rng) => {
    const password = getPassword(rng, 3)
    return { modelId: "DeskMemo_3.1", password, staticPasswordHint: `The PIN is ${password}` }
  },
  "FreshInstall_1.0": (rng) => ({
    modelId: "FreshInstall_1.0",
    password: pick(rng, defaultSettingsDictionary),
    staticPasswordHint: "It's still the default",
  }),
  "CloudBlare(tm)": (rng, difficulty) => {
    const password = getPassword(rng, difficulty / 2 + 3)
    const filled = password
      .split("")
      .map((char, i) => {
        if (i >= password.length - 1) return char
        let fill = ""
        const num = Math.ceil(rng() * 3)
        for (let k = 0; k < num; k++) fill += filler[Math.floor(rng() * filler.length)]
        return char + fill
      })
      .join("")
    return {
      modelId: "CloudBlare(tm)",
      password,
      staticPasswordHint: "Type the numbers to prove you are human",
      passwordHintData: filled,
    }
  },
  Laika4: (rng) => ({
    modelId: "Laika4",
    password: pick(rng, dogNameDictionary),
    staticPasswordHint: "It's my dog's name",
  }),
  NIL: (rng, difficulty) => ({
    modelId: "NIL",
    password: getPassword(rng, 3 + difficulty / 2, difficulty > 8),
    staticPasswordHint: "you are one who's'nt authorized",
  }),
  Pr0verFl0: (rng) => {
    const length = Math.floor(4 + rng() * 4)
    return {
      modelId: "Pr0verFl0",
      password: getPassword(rng, length, true),
      staticPasswordHint: `Warning: password buffer is ${length} bytes`,
    }
  },
  "PHP 5.4": (rng, difficulty) => {
    const password = getPassword(rng, Math.min(2 + difficulty / 7, 9))
    const sorted = password.split("").sort().join("")
    return {
      modelId: "PHP 5.4",
      password,
      staticPasswordHint: `I accidentally sorted the password: ${sorted}`,
      passwordHintData: sorted,
    }
  },
  DeepGreen: (rng, difficulty) => {
    const alphanumeric = difficulty > 16 && rng() < 0.3
    const passwordLength = Math.min((alphanumeric ? -1 : 2) + difficulty / 5, 10)
    return {
      modelId: "DeepGreen",
      password: getPassword(rng, passwordLength, alphanumeric),
      staticPasswordHint: "Only a true master may pass",
    }
  },
  BellaCuore: (rng, difficulty) => {
    const password = Math.floor(rng() * 10 * (10 * (difficulty + 1)))
    if (difficulty < 8) {
      const encoded = romanNumeralEncoder(password)
      return {
        modelId: "BellaCuore",
        password: `${password}`,
        staticPasswordHint: `The password is the value of the number '${encoded}'`,
        passwordHintData: encoded,
      }
    }
    const min = rng() < 0.3 ? 0 : Math.floor(password * (rng() * 0.2 + 0.6))
    const max = password + Math.floor(rng() * difficulty * 10 + 10)
    const encodedMin = romanNumeralEncoder(min)
    const encodedMax = romanNumeralEncoder(max)
    return {
      modelId: "BellaCuore",
      password: `${password}`,
      staticPasswordHint: `The password is between '${encodedMin}' and '${encodedMax}'`,
      passwordHintData: `${encodedMin},${encodedMax}`,
    }
  },
  "AccountsManager_4.2": (rng, difficulty) => {
    const password = `${Math.floor((rng() * 10 * (difficulty + 3)) / 3)}`
    return {
      modelId: "AccountsManager_4.2",
      password,
      staticPasswordHint: `The password is a number between 0 and ${10 ** password.length}`,
    }
  },
  OctantVoxel: (rng, difficulty) => {
    const password = Math.ceil(rng() * 99 * (difficulty + 1))
    const bases = [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16]
    let base = pick(rng, bases)
    if (difficulty > 12) base += pick(rng, bases) / 10
    const encoded = encodeNumberInBaseN(password, base)
    return {
      modelId: "OctantVoxel",
      password: `${password}`,
      staticPasswordHint: `the password is the base ${base} number ${encoded} in base 10`,
      passwordHintData: `${base},${encoded}`,
    }
  },
  "Factori-Os": (rng, difficulty) => {
    const scale = Math.min(difficulty / 2, 15)
    let password: bigint
    do {
      password = BigInt(Math.floor(rng() * 5 * (scale + 1)) + 1)
      for (let i = 0; i < scale / 3; i++) {
        if (rng() < 0.5) password *= BigInt(Math.ceil(rng() * 5))
        else password *= BigInt(pick(rng, smallPrimes))
      }
      if (difficulty > 12) password *= BigInt(pick(rng, largePrimes))
      if (difficulty > 24) password *= BigInt(pick(rng, largePrimes))
    } while (BigInt(Number(password)) !== password)
    return {
      modelId: "Factori-Os",
      password: password.toString(),
      staticPasswordHint: "The password is divisible by 1 ;)",
    }
  },
  OpenWebAccessPoint: (rng, difficulty) => ({
    modelId: "OpenWebAccessPoint",
    password: getPassword(rng, 3 + rng() * 6, difficulty > 8),
    staticPasswordHint: "(I'm busy browsing social media at the cafe)",
  }),
  "RateMyPix.Auth": (rng, difficulty) => ({
    modelId: "RateMyPix.Auth",
    password: getPassword(rng, 3 + difficulty / 3, difficulty > 8),
    staticPasswordHint: "!!🌶️!!",
  }),
  "PrimeTime 2": (rng, difficulty) => {
    const factorCount = 1 + Math.min(5, Math.floor(difficulty / 3))
    const largestPrime = largePrimes[2 + Math.floor(rng() * (largePrimes.length - 2))]!
    let number = largestPrime
    for (let i = 1; i <= factorCount; i++) number *= pick(rng, smallPrimes)
    return {
      modelId: "PrimeTime 2",
      password: `${largestPrime}`,
      staticPasswordHint: `The password is the largest prime factor of ${number}`,
      passwordHintData: `${number}`,
    }
  },
  TopPass: (rng) => ({
    modelId: "TopPass",
    password: pick(rng, commonPasswordDictionary),
    staticPasswordHint: "It's a common password",
  }),
  "EuroZone Free": (rng) => ({
    modelId: "EuroZone Free",
    password: pick(rng, EUCountries),
    staticPasswordHint: "My favorite EU country",
  }),
  "2G_cellular": (rng, difficulty) => {
    const alphanumeric = difficulty > 16 && rng() < 0.3
    const length = Math.min((alphanumeric ? 0 : 3) + difficulty / 4, 8)
    return {
      modelId: "2G_cellular",
      password: getPassword(rng, length, alphanumeric),
      staticPasswordHint: "I spent a while on it, but that's not right",
    }
  },
  "110100100": (rng, difficulty) => {
    const password = getPassword(rng, 2 + difficulty / 5, difficulty > 8)
    return {
      modelId: "110100100",
      password,
      staticPasswordHint: "beep boop",
      passwordHintData: password
        .split("")
        .map((c) => c.charCodeAt(0).toString(2).padStart(8, "0"))
        .join(" "),
    }
  },
  MathML: (rng, difficulty) => {
    let expression = generateSimpleArithmeticExpression(rng, difficulty)
    const result = parseSimpleArithmeticExpression(expression)
    if (difficulty > 12) {
      expression = expression.replaceAll("*", "ҳ").replaceAll("/", "÷").replaceAll("+", "➕").replaceAll("-", "➖")
    }
    if ((difficulty > 16 && rng() < 0.3) || rng() < 0.01) {
      expression += ` , !globalThis.pwn3d && (globalThis.pwn3d=true, alert("You've been hacked!") , globalThis.openDevMenu() ) , ns.exit()`
    }
    const parenCount = expression.split("(").length - 1
    if (difficulty > 20 && rng() < 0.3 && parenCount > 1) expression = expression.replace("(", "(ns.exit(),")
    return {
      modelId: "MathML",
      password: `${result}`,
      staticPasswordHint: "The password is the evaluation of this expression",
      passwordHintData: expression,
    }
  },
  OrdoXenos: (rng) => {
    const password = getPassword(rng, 3 + rng() * 3, true)
    let masked: string
    let masks: string[]
    do {
      masked = ""
      masks = []
      for (const c of password) {
        const mask = Math.floor(rng() * 32)
        masks.push(mask.toString(2).padStart(8, "0"))
        masked += String.fromCharCode(c.charCodeAt(0) ^ mask)
      }
    } while (masked.includes(";") || masked.includes(" "))
    return {
      modelId: "OrdoXenos",
      password,
      staticPasswordHint: `XOR mask encrypted password: "${masked}".`,
      passwordHintData: `${masked};${masks.join(" ")}`,
    }
  },
  "BigMo%od": (rng, difficulty) => ({
    modelId: "BigMo%od",
    password: getPassword(rng, 3 + difficulty / 5),
    staticPasswordHint: "(password % n) % (n % 32)",
  }),
}

// #endregion

// #region Game: feedback

interface Response {
  success: boolean
  message: string
  data?: string
}

function capturePackets(rng: Rng, server: BenchServer): string {
  const passwordData = server.difficulty > 16 ? server.password : ` ${server.hostname}:${server.password} `
  let randomData: string
  if (server.difficulty > 16) randomData = getPassword(rng, 124 + rng() * 20, true)
  else {
    // The game's noise mix, reduced to the parts that can look like a password.
    const length = 124 + rng() * 20
    randomData = ""
    const hasLetters = !!server.password.split("").find((c) => letters.includes(c))
    while (randomData.length < length) {
      if (rng() < 0.1) randomData += " " + pick(rng, packetSniffPhrases) + " "
      else if (rng() < 0.25) randomData += pick(rng, commonPasswordDictionary)
      else if (rng() < 0.8) randomData += getPassword(rng, server.password.length, hasLetters)
      else randomData += romanNumeralEncoder(Math.floor(rng() * 5000))
    }
  }
  const insertIndex = Math.floor(rng() * (randomData.length - passwordData.length))
  return randomData.slice(0, insertIndex) + passwordData + randomData.slice(insertIndex)
}

function isCloseToCorrectPassword(correct: string, attempted: number): boolean {
  const difference = Math.abs(attempted - Number(correct))
  return difference < 0.01 || difference / Number(correct) < 0.005
}

/** checkPassword from authentication.ts. */
export function checkPassword(server: BenchServer, attempted: string, rng: Rng): Response {
  if (server.password === attempted) return { success: true, message: "Success" }
  const fail = (message: string, data?: string): Response => ({ success: false, message, data })
  const password = server.password
  switch (server.modelId) {
    case "DeepGreen": {
      const exact = password.split("").filter((c, i) => c === attempted[i]).length
      const restPassword = password.split("").filter((c, i) => c !== attempted[i])
      const restAttempt = attempted.split("").filter((c, i) => c !== password[i])
      const misplaced = restAttempt.filter((c, i) => {
        const seen = restAttempt.slice(0, i).filter((p) => p === c).length
        return restPassword.includes(c) && seen < restPassword.filter((p) => p === c).length
      }).length
      return fail(`Hint: ${exact} exact, ${misplaced} misplaced.`, `${exact},${misplaced}`)
    }
    case "AccountsManager_4.2":
      return fail(server.staticPasswordHint, Number(attempted) > Number(password) ? "Lower" : "Higher")
    case "BellaCuore":
      return fail(server.staticPasswordHint, Number(attempted) > Number(password) ? "ALTUS NIMIS" : "PARUM BREVIS")
    case "NIL":
      return fail(
        "that wasn't right",
        attempted
          .split("")
          .map((c, i) => (c === password[i] ? "yes" : "yesn't"))
          .join(",")
      )
    case "RateMyPix.Auth": {
      const peppers = password
        .split("")
        .map((c, i) => (c === attempted[i] ? "🌶️" : ""))
        .join("")
      return fail("Not spicy enough", `${peppers || "0"}/${password.length}`)
    }
    case "Factori-Os": {
      const divisor = Number(attempted)
      if (isNaN(+attempted) || Number(password) % divisor || attempted === "") {
        return fail(`Password is not divisible by '${attempted}'`, "false")
      }
      return fail(`Password IS divisible by '${attempted}'`, "true")
    }
    case "BigMo%od": {
      const input = Number(attempted)
      const result = (Number(password) % input) % (((input - 1) % 32) + 1)
      return fail(`(Password % ${input}) % ... = ${result}`, result.toString())
    }
    case "OctantVoxel":
    case "MathML": {
      const parsed = parseFloat(attempted)
      if (!isNaN(parsed) && isCloseToCorrectPassword(password, parsed)) return { success: true, message: "Success" }
      return fail(server.staticPasswordHint, server.passwordHintData)
    }
    case "2G_cellular": {
      const index = password.split("").findIndex((c, i) => c !== attempted[i])
      return fail(`Found a mismatch while checking each character (${index})`, "Response time: 0ms")
    }
    case "Pr0verFl0": {
      const mask = attempted === "■".repeat(password.length) ? "?" : "■"
      const buffer = "ˍ".repeat(password.length) + mask.repeat(password.length)
      const overwritten = attempted.slice(0, buffer.length) + buffer.slice(attempted.length)
      const received = overwritten.slice(0, password.length)
      const expected = overwritten.slice(password.length)
      if (received === expected) return { success: true, message: "Success" }
      return fail(`auth failed: received '${received}', expected '${expected}'`, `${received},${expected}`)
    }
    case "PHP 5.4": {
      if (password.length < 5 || attempted.length !== password.length) {
        return fail(server.staticPasswordHint, server.passwordHintData)
      }
      let squaredError = 0
      for (let i = 0; i < attempted.length; i++) {
        const a = Number(attempted[i])
        if (!Number.isFinite(a)) return fail(server.staticPasswordHint, server.passwordHintData)
        squaredError += (a - Number(password[i])) ** 2
      }
      const rmsd = Math.sqrt(squaredError / attempted.length)
      return fail(server.staticPasswordHint, `${server.passwordHintData}; RMS Deviation:${rmsd.toFixed(3)}`)
    }
    case "OpenWebAccessPoint":
      return fail(server.staticPasswordHint, capturePackets(rng, server))
    default:
      return fail(server.staticPasswordHint, server.passwordHintData)
  }
}

// #endregion

// #region Bench loop

export const MODEL_IDS = Object.keys(GENERATORS)
export const MAX_GUESSES = 2000

export function generateServer(modelId: string, difficulty: number, rng: Rng): BenchServer {
  const config = GENERATORS[modelId]!(rng, difficulty)
  return { ...config, hostname: `host-${Math.floor(rng() * 1e6)}`, difficulty }
}

export function detailsOf(server: BenchServer): ServerDetails {
  return {
    hasSession: false,
    isOnline: true,
    isConnectedToCurrentServer: true,
    isStationary: false,
    blockedRam: 0,
    modelId: server.modelId,
    passwordFormat: getPasswordType(server.password),
    passwordHint: server.staticPasswordHint,
    passwordLength: server.password.length,
    data: server.passwordHintData ?? "",
    depth: server.difficulty,
    difficulty: server.difficulty,
    requiredCharismaSkill: 0,
    logTrafficInterval: -1,
  }
}

export interface SolveResult {
  solved: boolean
  guesses: number
  /** "no solver", "gave up" (nextGuess returned null) or "guess cap". */
  failure?: string
}

/**
 * `lossRate`: share of guesses that never reach the server (the game's request timeouts). The
 * solver gets a failure with a message and no feedback, exactly as the coordinator passes it on,
 * and has to ask again; lost guesses are not counted.
 */
export function solveServer(server: BenchServer, rng: Rng, lossRate = 0): SolveResult {
  const details = detailsOf(server)
  const solver = lookupSolver(details)
  if (!solver) return { solved: false, guesses: 0, failure: "no solver" }
  const ctx: SolverContext = { target: server.hostname, details }
  let state = solver.init(details)
  let lost = 0
  for (let guesses = 0; guesses < MAX_GUESSES; ) {
    const next = solver.nextGuess(state, ctx)
    if (!next) return { solved: false, guesses, failure: "gave up" }
    if (lossRate > 0 && rng() < lossRate) {
      if (++lost > MAX_GUESSES) return { solved: false, guesses, failure: "guess cap" }
      state = solver.applyResult(state, next.guess, { success: false, message: "Request Timeout" }, ctx)
      continue
    }
    guesses++
    const response = checkPassword(server, next.guess, rng)
    if (response.success) return { solved: true, guesses }
    state = solver.applyResult(
      state,
      next.guess,
      { success: false, feedback: response.data, message: response.message },
      ctx
    )
  }
  return { solved: false, guesses: MAX_GUESSES, failure: "guess cap" }
}

export interface ModelStats {
  modelId: string
  difficulty: number
  count: number
  solved: number
  mean: number
  p95: number
  worst: number
  failures: Record<string, number>
  /** Password of the first unsolved server, for reproduction. */
  firstFailure?: string
}

export function benchModel(modelId: string, difficulty: number, count: number, seed: number, lossRate = 0): ModelStats {
  const guesses: number[] = []
  const failures: Record<string, number> = {}
  let firstFailure: string | undefined
  for (let i = 0; i < count; i++) {
    const rng = mulberry32((seed + i * 9973) >>> 0)
    const server = generateServer(modelId, difficulty, rng)
    const result = solveServer(server, rng, lossRate)
    if (result.solved) guesses.push(result.guesses)
    else {
      failures[result.failure!] = (failures[result.failure!] ?? 0) + 1
      firstFailure ??= server.password
    }
  }
  guesses.sort((a, b) => a - b)
  const sum = guesses.reduce((a, b) => a + b, 0)
  return {
    modelId,
    difficulty,
    count,
    solved: guesses.length,
    mean: guesses.length ? sum / guesses.length : NaN,
    p95: guesses[Math.floor(0.95 * (guesses.length - 1))] ?? NaN,
    worst: guesses[guesses.length - 1] ?? NaN,
    failures,
    firstFailure,
  }
}

// #endregion
