/** Shared with src/libraries/ipvgo/phantomStones.ts — keep in sync. */

function cellAt(board, x, y) {
  return board[x]?.[y] ?? "."
}

function neighborStoneCounts(board, x, y) {
  const size = board.length
  let xCount = 0
  let oCount = 0
  const adjacent = [
    [x, y - 1],
    [x + 1, y],
    [x, y + 1],
    [x - 1, y],
  ]
  for (const [nx, ny] of adjacent) {
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
    const cell = cellAt(board, nx, ny)
    if (cell === "X") xCount++
    else if (cell === "O") oCount++
  }
  return { xCount, oCount }
}

/**
 * KataGo phantom color for an offline (#) cell.
 * @returns {"B" | "W"}
 */
export function phantomStoneColor(board, x, y, playAs = "X") {
  const { xCount, oCount } = neighborStoneCounts(board, x, y)
  const weAreBlack = playAs !== "O"

  if (xCount > 0 && oCount === 0) {
    return weAreBlack ? "W" : "B"
  }
  if (oCount > 0 && xCount === 0) {
    return weAreBlack ? "B" : "W"
  }
  return (x + y) % 2 === 0 ? "B" : "W"
}
