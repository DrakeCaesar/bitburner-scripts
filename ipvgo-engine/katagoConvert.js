const COLUMN_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"

/** API board[x][y], y=0 bottom -> KataGo GTP e.g. C3 */
export function toGtpCoord(x, y) {
  return `${COLUMN_LETTERS[x]}${y + 1}`
}

/** Parse KataGo move (C3, pass, resign) -> IPvGO move or null */
export function fromKataGoMove(move) {
  if (!move || move === "pass" || move === "resign") {
    return { type: "pass" }
  }
  const gtp = String(move).trim()
  const intMatch = gtp.match(/^\((\d+),(\d+)\)$/)
  if (intMatch) {
    return { type: "move", x: Number(intMatch[1]), y: Number(intMatch[2]) }
  }
  const letterMatch = gtp.match(/^([A-HJ-Z])(\d+)$/i)
  if (letterMatch) {
    const x = COLUMN_LETTERS.indexOf(letterMatch[1].toUpperCase())
    const y = Number(letterMatch[2]) - 1
    if (x >= 0 && y >= 0) return { type: "move", x, y }
  }
  return null
}

function cellAt(board, x, y) {
  return board[x]?.[y] ?? "."
}

/** Current position as KataGo initialStones (blocked # cells omitted). */
export function boardToInitialStones(board) {
  const stones = []
  const size = board.length
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const cell = cellAt(board, x, y)
      if (cell === "X") stones.push(["B", toGtpCoord(x, y)])
      else if (cell === "O") stones.push(["W", toGtpCoord(x, y)])
    }
  }
  return stones
}

export function buildKataGoQuery(request, queryId) {
  const board = request.board
  const size = board.length
  const komi = request.komi ?? 5.5
  const playAs = request.playAs === "O" ? "W" : "B"
  const visits = Math.max(50, Math.min(20000, Number(request.iterations) || 4000))

  return {
    id: queryId,
    initialStones: boardToInitialStones(board),
    moves: [],
    initialPlayer: playAs,
    rules: "chinese",
    komi,
    boardXSize: size,
    boardYSize: size,
    maxVisits: visits,
  }
}

/** Pick best legal move from KataGo moveInfos using validMoves mask. */
export function pickMoveFromAnalysis(moveInfos, validMoves, playAs) {
  const color = playAs === "O" ? "W" : "B"
  const sorted = [...(moveInfos ?? [])].sort((a, b) => (b.visits ?? 0) - (a.visits ?? 0))

  for (const info of sorted) {
    const parsed = fromKataGoMove(info.move)
    if (!parsed) continue
    if (parsed.type === "pass") return { type: "pass" }
    if (validMoves?.[parsed.x]?.[parsed.y] === true) {
      return parsed
    }
  }

  for (const info of sorted) {
    const parsed = fromKataGoMove(info.move)
    if (parsed?.type === "move" && validMoves?.[parsed.x]?.[parsed.y] === true) {
      return parsed
    }
  }

  return findAnyLegal(validMoves)
}

function findAnyLegal(validMoves) {
  if (!validMoves) return { type: "pass" }
  for (let x = 0; x < validMoves.length; x++) {
    for (let y = 0; y < validMoves[x].length; y++) {
      if (validMoves[x][y]) return { type: "move", x, y }
    }
  }
  return { type: "pass" }
}
