const COMMON_PASSWORDS_PREFIX_NOSPACE = "Some common passwords include"
const REMEMBER_PASSWORD_RE = /^Remember this password:\s*(\S+)/im
const EXPLICIT_PASSWORD_RE = /^Server:\s+(.+?)\s+Password:\s*"(\S+?)"/gm
const HOST_HINT_RE = /^The password for (.+?) contains (\d+)\s+and\s+(\d+)/gm

export interface PasswordFileIntel {
  kind: "explicit" | "remember" | "hint"
  host: string | null
  password: string | null
  chars: string | null
}

export function parsePasswordFileContent(
  content: string,
  sourceHost: string,
  neighbors: string[],
  timestamp: number,
): { cleanContent: string; intel: PasswordFileIntel[]; intelJson: string } {
  const intel: PasswordFileIntel[] = []
  const lines = content.split("\n")
  const cleanLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith(COMMON_PASSWORDS_PREFIX_NOSPACE)) {
      continue
    }

    const rememberMatch = REMEMBER_PASSWORD_RE.exec(trimmed)
    if (rememberMatch) {
      const pw = rememberMatch[1]!
      intel.push({ kind: "remember", host: null, password: pw, chars: null })
      cleanLines.push(line)
      continue
    }

    EXPLICIT_PASSWORD_RE.lastIndex = 0
    const explicitMatch = EXPLICIT_PASSWORD_RE.exec(trimmed)
    if (explicitMatch) {
      intel.push({
        kind: "explicit",
        host: explicitMatch[1]!.trim(),
        password: explicitMatch[2]!,
        chars: null,
      })
      cleanLines.push(line)
      continue
    }

    HOST_HINT_RE.lastIndex = 0
    const hintMatch = HOST_HINT_RE.exec(trimmed)
    if (hintMatch) {
      const chars = [...new Set([hintMatch[2]!, hintMatch[3]!])].sort().join("")
      intel.push({ kind: "hint", host: hintMatch[1]!.trim(), password: null, chars })
      cleanLines.push(line)
      continue
    }

    cleanLines.push(line)
  }

  const cleanContent = cleanLines.join("\n")
  const intelJson = JSON.stringify({
    type: "passwordIntel",
    sourceHost,
    neighbors,
    timestamp,
    entries: intel,
  })

  return { cleanContent, intel, intelJson }
}
