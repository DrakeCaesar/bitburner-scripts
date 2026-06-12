/** Same as bitburner-src Go/Constants columnIndexes (skips I). */
export const IPVGO_COLUMN_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"

export function columnLabel(x: number): string {
  return IPVGO_COLUMN_LETTERS[x] ?? String(x)
}

/** API y=0 is bottom row; game labels rows from 1 at bottom. */
export function rowLabel(y: number): string {
  return String(y + 1)
}

/** In-game point label e.g. A.5 */
export function formatIpvgoPoint(x: number, y: number): string {
  return `${columnLabel(x)}.${rowLabel(y)}`
}

export function parseIpvgoPoint(text: string): { x: number; y: number } | undefined {
  const trimmed = text.trim()
  if (!trimmed || trimmed === "pass") return undefined

  const comma = trimmed.match(/^(\d+),(\d+)$/)
  if (comma) {
    const x = Number(comma[1])
    const y = Number(comma[2])
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y }
  }

  const game = trimmed.match(/^([A-HJ-Z])[\s.,](\d+)$/i)
  if (game) {
    const x = IPVGO_COLUMN_LETTERS.indexOf(game[1].toUpperCase())
    const y = Number(game[2]) - 1
    if (x >= 0 && Number.isFinite(y) && y >= 0) return { x, y }
  }

  return undefined
}
