// Reports non-ASCII characters (and likely mojibake) in the given files.
// Usage: node tools/check-encoding.mjs <file> [file...]
import fs from "node:fs"

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error("usage: node tools/check-encoding.mjs <file> [file...]")
  process.exit(2)
}

let problems = 0
for (const file of files) {
  const text = fs.readFileSync(file, "utf8")
  const counts = new Map()
  for (const char of text) {
    if (char.charCodeAt(0) > 0x7f) counts.set(char, (counts.get(char) ?? 0) + 1)
  }
  const mojibake = (text.match(/(?:â€|Â·|Ã¢|Ã©|Ã¨|â€“|â€”|â€¦)/g) ?? []).length
  if (counts.size === 0 && mojibake === 0) {
    console.log(`${file}: ascii only`)
    continue
  }
  problems += 1
  const list = [...counts].map(([char, n]) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}(${char}) x${n}`)
  console.log(`${file}: ${counts.size} distinct non-ascii, mojibake hits=${mojibake}`)
  console.log(`  ${list.join("  ")}`)
}
process.exit(problems === 0 ? 0 : 1)
