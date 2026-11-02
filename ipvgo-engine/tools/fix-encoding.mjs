// Repairs UTF-8 text that was decoded as Windows-1252 and re-encoded (mojibake).
// Usage: node tools/fix-encoding.mjs <file> [file...]
import fs from "node:fs"

const cp1252 = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
])
const reverse = new Map([...cp1252].map(([unicode, byte]) => [unicode, byte]))

function toCp1252Bytes(text) {
  const bytes = []
  for (const char of text) {
    const code = char.codePointAt(0)
    if (code < 0x80) bytes.push(code)
    else if (reverse.has(code)) bytes.push(reverse.get(code))
    else if (code >= 0xa0 && code <= 0xff) bytes.push(code)
    else return null
  }
  return Buffer.from(bytes)
}

function nonAsciiCount(text) {
  let count = 0
  for (const char of text) if (char.charCodeAt(0) > 0x7f) count += 1
  return count
}

// ASCII replacements so this class of bug cannot come back.
const ASCII_MAP = new Map([
  ["…", "..."],
  ["—", "-"],
  ["–", "-"],
  ["·", "-"],
  ["→", "->"],
  ["≤", "<="],
  ["≥", ">="],
  ["×", "x"],
  ["’", "'"],
  ["‘", "'"],
  ["“", '"'],
  ["”", '"'],
  ["…", "..."],
])

for (const file of process.argv.slice(2)) {
  const original = fs.readFileSync(file, "utf8")
  let text = original
  let passes = 0
  // Undo any number of accidental re-encodings.
  while (passes < 4) {
    const bytes = toCp1252Bytes(text)
    if (!bytes) break
    const candidate = bytes.toString("utf8")
    if (candidate.includes("\uFFFD") || nonAsciiCount(candidate) >= nonAsciiCount(text)) break
    text = candidate
    passes += 1
  }
  let normalized = ""
  for (const char of text) normalized += ASCII_MAP.get(char) ?? char
  const remaining = nonAsciiCount(normalized)
  if (normalized === original) {
    console.log(`${file}: unchanged`)
    continue
  }
  fs.writeFileSync(file, normalized, "utf8")
  console.log(`${file}: repaired in ${passes} pass(es), non-ascii left=${remaining}`)
}
