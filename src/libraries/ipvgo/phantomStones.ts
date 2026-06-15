import type { IpvgoBoard, IpvgoColor } from "./types.js"

/** Keep in sync with ipvgo-engine/phantomStones.js */

export type PhantomStoneColor = "B" | "W"

function cellAt(board: IpvgoBoard, x: number, y: number): string {
  return board[x]?.[y] ?? "."
}

function neighborStoneCounts(board: IpvgoBoard, x: number, y: number): { xCount: number; oCount: number } {
  const size = board.length
  let xCount = 0
  let oCount = 0
  const adjacent: Array<[number, number]> = [
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

/** KataGo phantom color sent for an offline (#) cell. */
export function phantomStoneColor(
  board: IpvgoBoard,
  x: number,
  y: number,
  playAs: IpvgoColor = "X"
): PhantomStoneColor {
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
