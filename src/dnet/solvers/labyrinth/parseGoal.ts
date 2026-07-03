/** Half-width of labradar ASCII view (game getSurroundingsVisualized range=3). */
export const LABRADAR_RANGE = 3

/** Parse goal "X" from labradar message relative to worker position at call time. */
export function parseLabradarGoal(
  message: string,
  originX: number,
  originY: number,
): [number, number] | null {
  const lines = message.split("\n").filter((line) => line.length > 0)
  if (lines.length === 0) return null
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]!
    for (let col = 0; col < line.length; col++) {
      if (line[col] !== "X") continue
      return [originX - LABRADAR_RANGE + col, originY - LABRADAR_RANGE + row]
    }
  }
  return null
}
