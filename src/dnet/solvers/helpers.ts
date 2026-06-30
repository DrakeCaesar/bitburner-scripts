/** Shared solver helpers (mastermind, roman numerals, arithmetic, etc.). */

export function romanToDecimal(roman: string): number | null {
  const trimmed = roman.trim()
  if (trimmed.toLowerCase() === "nulla") return 0
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }
  const upper = trimmed.toUpperCase()
  if (!upper || !/^[IVXLCDM]+$/.test(upper)) return null
  let total = 0
  for (let i = 0; i < upper.length; i++) {
    const current = values[upper[i]!]
    const next = values[upper[i + 1]!]
    if (current === undefined) return null
    total += next !== undefined && current < next ? -current : current
  }
  return total
}

export function mastermindCharset(format: string): string {
  switch (format) {
    case "numeric":
      return "0123456789"
    case "alphabetic":
      return "abcdefghijklmnopqrstuvwxyz"
    case "alphanumeric":
      return "0123456789abcdefghijklmnopqrstuvwxyz"
    default:
      return "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  }
}

export function mastermindFeedback(secret: string, guess: string): { exact: number; misplaced: number } {
  let exact = 0
  const secretRem: string[] = []
  const guessRem: string[] = []
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) exact++
    else {
      secretRem.push(secret[i]!)
      guessRem.push(guess[i]!)
    }
  }
  let misplaced = 0
  const used = secretRem.map(() => false)
  for (const ch of guessRem) {
    const idx = secretRem.findIndex((s, i) => !used[i] && s === ch)
    if (idx >= 0) {
      used[idx] = true
      misplaced++
    }
  }
  return { exact, misplaced }
}

export function parseMastermindFeedback(data: string): { exact: number; misplaced: number } | null {
  const parts = data.split(",")
  if (parts.length !== 2) return null
  const exact = Number(parts[0]?.trim())
  const misplaced = Number(parts[1]?.trim())
  if (!Number.isInteger(exact) || !Number.isInteger(misplaced)) return null
  return { exact, misplaced }
}

export function parseBoolFeedback(data: unknown): boolean | null {
  if (data === true || data === "true") return true
  if (data === false || data === "false") return false
  return null
}

const OCTANT_DIGITS = "0123456789abcdef"

function octantDigit(ch: string): number | null {
  const idx = OCTANT_DIGITS.indexOf(ch.toLowerCase())
  return idx >= 0 ? idx : null
}

export function parseBaseNToDecimal(base: number, numberStr: string): number | null {
  const maxDigit = Math.ceil(base) - 1
  const dotIdx = numberStr.indexOf(".")
  const intPart = dotIdx >= 0 ? numberStr.slice(0, dotIdx) : numberStr
  const fracPart = dotIdx >= 0 ? numberStr.slice(dotIdx + 1) : ""
  let value = 0
  for (let i = 0; i < intPart.length; i++) {
    const dv = octantDigit(intPart[intPart.length - 1 - i]!)
    if (dv === null || dv > maxDigit) return null
    value += dv * base ** i
  }
  for (let i = 0; i < fracPart.length; i++) {
    const dv = octantDigit(fracPart[i]!)
    if (dv === null || dv > maxDigit) return null
    value += dv * base ** -(i + 1)
  }
  return value
}

export function cleanArithmeticExpression(expression: string): string {
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
    .split(",")[0]!
}

export function parseSimpleArithmeticExpression(expression: string): number {
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
  const firstZeroAfter = depth.indexOf(0, depth1Start)
  const depth1End = firstZeroAfter === -1 ? depth.length - 1 : firstZeroAfter - 1
  if (depth1Start !== -1) {
    const sub = tokens.slice(depth1Start + 1, depth1End).join("")
    const result = parseSimpleArithmeticExpression(sub)
    tokens.splice(depth1Start, depth1End - depth1Start + 1, result.toString())
    return parseSimpleArithmeticExpression(tokens.join(""))
  }
  let remaining = tokens.join("")
  const mulDiv = /(-?\d*\.?\d+) *([*/]) *(-?\d*\.?\d+)/
  let match = remaining.match(mulDiv)
  while (match) {
    const left = match[1]!
    const op = match[2]!
    const right = match[3]!
    const result = op === "*" ? parseFloat(left) * parseFloat(right) : parseFloat(left) / parseFloat(right)
    const resultStr = Math.abs(result) < 0.000001 ? result.toFixed(20) : result.toString()
    remaining = remaining.replace(match[0], resultStr)
    match = remaining.match(mulDiv)
  }
  const addSub = /(-?\d*\.?\d+) *([+-]) *(-?\d*\.?\d+)/
  match = remaining.match(addSub)
  while (match) {
    const left = match[1]!
    const op = match[2]!
    const right = match[3]!
    const result = op === "+" ? parseFloat(left) + parseFloat(right) : parseFloat(left) - parseFloat(right)
    remaining = remaining.replace(match[0], result.toString())
    match = remaining.match(addSub)
  }
  const leftover = remaining.match(/(-?\d*\.?\d+)/)
  return parseFloat(leftover?.[1] ?? "NaN")
}

export const MAX_MASTERMIND_CANDIDATES = 10_000
export const MINIMAX_THRESHOLD = 500

export function generateMastermindCandidates(length: number, charset: string): string[] | null {
  if (length <= 0) return null
  if (charset.length ** length > MAX_MASTERMIND_CANDIDATES) return null
  const out: string[] = []
  const build = (prefix: string): void => {
    if (prefix.length === length) {
      out.push(prefix)
      return
    }
    for (let i = 0; i < charset.length; i++) build(prefix + charset[i])
  }
  build("")
  return out
}

export function multisetPermutations(chars: string[]): string[] {
  const results: string[] = []
  const sorted = [...chars].sort()
  const used = new Array(sorted.length).fill(false)
  function backtrack(current: string[]): void {
    if (current.length === sorted.length) {
      results.push(current.join(""))
      return
    }
    for (let i = 0; i < sorted.length; i++) {
      if (used[i]) continue
      if (i > 0 && sorted[i] === sorted[i - 1] && !used[i - 1]) continue
      used[i] = true
      current.push(sorted[i]!)
      backtrack(current)
      current.pop()
      used[i] = false
    }
  }
  backtrack([])
  return results
}

export function pickMastermindGuess(candidates: string[]): string {
  if (candidates.length > MINIMAX_THRESHOLD) {
    return candidates[Math.floor(Math.random() * candidates.length)]!
  }
  let bestGuess = candidates[0]!
  let bestWorst = candidates.length + 1
  for (const guess of candidates) {
    const buckets = new Map<string, number>()
    for (const secret of candidates) {
      const fb = mastermindFeedback(secret, guess)
      const key = `${fb.exact},${fb.misplaced}`
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
    const worst = Math.max(...buckets.values())
    if (worst < bestWorst) {
      bestWorst = worst
      bestGuess = guess
    }
  }
  return bestGuess
}

export function php54Candidates(hint: string, length: number): string[] {
  const digits = hint.replace(/\D/g, "")
  if (digits.length !== length) return []
  const seen = new Set<string>()
  const result: string[] = []
  function permute(arr: string[], start: number): void {
    if (start === arr.length) {
      const s = arr.join("")
      if (!seen.has(s)) {
        seen.add(s)
        result.push(s)
      }
      return
    }
    const used = new Set<string>()
    for (let i = start; i < arr.length; i++) {
      if (used.has(arr[i]!)) continue
      used.add(arr[i]!)
      ;[arr[start], arr[i]] = [arr[i]!, arr[start]!]
      permute(arr, start + 1)
      ;[arr[start], arr[i]] = [arr[i]!, arr[start]!]
    }
  }
  permute(digits.split(""), 0)
  return result
}

export function crtCombineBigInt(r1: bigint, m1: bigint, r2: bigint, m2: bigint): { r: bigint; m: bigint } | null {
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

export function bigMoPasswordFromProbes(
  resolved: { d: number; r: number }[],
  pwMin: number,
  pwMax: number,
  length: number,
): string | null {
  if (resolved.length === 0) return null
  let r = BigInt(resolved[0]!.r)
  let m = BigInt(resolved[0]!.d)
  for (let i = 1; i < resolved.length; i++) {
    const combined = crtCombineBigInt(r, m, BigInt(resolved[i]!.r), BigInt(resolved[i]!.d))
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
