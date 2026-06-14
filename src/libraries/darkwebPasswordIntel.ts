/**
 * Password clues from darkweb archive files (home/darkweb/*.data.txt).
 * Pulled locally under data/darkweb/ for reference; baked in here for in-game use.
 */

/** Sources: password.data.txt, credentials.data.txt, access.data.txt */
export const DARKWEB_COMMON_PASSWORDS: readonly string[] = [
  "jessica",
  "pepper",
  "1111",
  "zxcvbn",
  "555555",
  "11111111",
  "131313",
  "freedom",
  "777777",
  "pass",
  "maggie",
  "159753",
  "aaaaaa",
  "ginger",
  "princess",
  "cheese",
  "amanda",
  "summer",
  "love",
  "ashley",
  "6969",
  "nicole",
  "chelsea",
  "biteme",
  "matthew",
  "access",
  "yankees",
  "987654321",
  "dallas",
  "austin",
]

/** Source: key.data.txt ("Remember this password: …") */
export const DARKWEB_KNOWN_PASSWORDS: readonly string[] = ["27974"]

/**
 * Host -> digits known to appear in the password.
 * Sources: login.data.txt, admin.data.txt, secrets.data.txt, root.data.txt
 */
export const DARKWEB_HOST_DIGIT_HINTS: Readonly<Record<string, readonly string[]>> = {
  "6969": ["5", "8"],
  "hacker-services": ["5", "6"],
  "speakers_for_the_dead:5801": ["1", "3"],
  apexsanctuary: ["0", "7"],
}

export type DarkwebPasswordFormat = "numeric" | "alphabetic" | "alphanumeric" | "ASCII" | "unicode"

const NUMERIC_RE = /^\d+$/
const ALPHA_RE = /^[a-z]+$/
const ALNUM_RE = /^[a-z0-9]+$/

export function normalizeDarkwebHost(host: string): string {
  return host.toLowerCase()
}

export function darkwebHostDigitPool(host: string): string | null {
  const hints = DARKWEB_HOST_DIGIT_HINTS[normalizeDarkwebHost(host)]
  if (!hints || hints.length === 0) {
    return null
  }
  return hints.join("")
}

/** Union of digit characters from archive hint and server password hint text. */
export function mergeDarkwebDigitPools(...pools: string[]): string {
  const digits = new Set<string>()
  for (const pool of pools) {
    for (const ch of pool.replace(/\D/g, "")) {
      digits.add(ch)
    }
  }
  return [...digits].sort().join("")
}

export function darkwebKnownPasswordCandidates(length: number): string[] {
  return DARKWEB_KNOWN_PASSWORDS.filter((password) => password.length === length)
}

export function darkwebCommonPasswordCandidates(length: number, format: DarkwebPasswordFormat): string[] {
  const out: string[] = []
  for (const word of DARKWEB_COMMON_PASSWORDS) {
    if (word.length !== length) {
      continue
    }
    if (format === "numeric" && !NUMERIC_RE.test(word)) {
      continue
    }
    if (format === "alphabetic" && !ALPHA_RE.test(word)) {
      continue
    }
    if (format === "alphanumeric" && !ALNUM_RE.test(word)) {
      continue
    }
    out.push(word)
  }
  return out
}

/** Archive-based guesses for a host (known literals + common-word list), deduped in order. */
export function darkwebPasswordCandidates(length: number, format: DarkwebPasswordFormat): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const password of [
    ...darkwebKnownPasswordCandidates(length),
    ...darkwebCommonPasswordCandidates(length, format),
  ]) {
    if (seen.has(password)) {
      continue
    }
    seen.add(password)
    out.push(password)
  }
  return out
}
