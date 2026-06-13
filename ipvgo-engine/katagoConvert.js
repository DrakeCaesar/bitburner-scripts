const COLUMN_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"

/** Ply depth for root-only move mask (current player). */
const ROOT_MOVE_DEPTH = 1
/** Ply depth for permanent blocked-node prohibition (both players). */
const BLOCKED_NODE_DEPTH = 999

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

function boardSize(board) {
  return board.length
}

function isFullBlockedRow(board, y) {
  const size = boardSize(board)
  for (let x = 0; x < size; x++) {
    if (cellAt(board, x, y) !== "#") return false
  }
  return true
}

function isFullBlockedColumn(board, x) {
  const size = boardSize(board)
  for (let y = 0; y < size; y++) {
    if (cellAt(board, x, y) !== "#") return false
  }
  return true
}

/**
 * Strip consecutive all-# rows/columns from each board edge only.
 * Interior full # lines are kept: removing them would merge groups separated by a wall.
 * Matches common IPvGO layouts (removeRows) where whole blocked lines sit on an edge.
 *
 * @returns {null | { board, validMoves, size, toOriginal(x,y), strippedRows, strippedCols }}
 */
export function compressBoardForKatago(board, validMoves) {
  const size = boardSize(board)
  if (size < 3) return null

  let xMin = 0
  let xMax = size - 1
  let yMin = 0
  let yMax = size - 1

  while (yMin <= yMax && isFullBlockedRow(board, yMin)) yMin++
  while (yMin <= yMax && isFullBlockedRow(board, yMax)) yMax--
  while (xMin <= xMax && isFullBlockedColumn(board, xMin)) xMin++
  while (xMin <= xMax && isFullBlockedColumn(board, xMax)) xMax--

  const strippedRows = yMin + (size - 1 - yMax)
  const strippedCols = xMin + (size - 1 - xMax)
  if (strippedRows === 0 && strippedCols === 0) return null

  const width = xMax - xMin + 1
  const height = yMax - yMin + 1
  if (width < 2 || height < 2) return null

  const compressed = []
  const compressedValid = []
  for (let x = xMin; x <= xMax; x++) {
    let col = ""
    const validCol = []
    for (let y = yMin; y <= yMax; y++) {
      col += cellAt(board, x, y)
      validCol.push(validMoves?.[x]?.[y] === true)
    }
    compressed.push(col)
    compressedValid.push(validCol)
  }

  return {
    board: compressed,
    validMoves: compressedValid,
    size: width,
    strippedRows,
    strippedCols,
    toOriginal(x, y) {
      return { x: x + xMin, y: y + yMin }
    },
  }
}

function kataGoPlayer(playAs) {
  return playAs === "O" ? "W" : "B"
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

/** Collect GTP coords of IPvGO blocked (#) intersections. */
export function blockedNodeCoords(board) {
  const coords = []
  const size = board.length
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (cellAt(board, x, y) === "#") coords.push(toGtpCoord(x, y))
    }
  }
  return coords
}

/**
 * KataGo cannot use allowMoves and avoidMoves together.
 * - Boards with #: avoidMoves bans # for both players in the search tree, plus
 *   illegal IPvGO intersections for the current player at the root.
 * - Otherwise: allowMoves whitelists legal IPvGO intersections (+ pass) at root.
 */
export function buildMoveRestrictions(board, validMoves, playAs) {
  const player = kataGoPlayer(playAs)
  const size = board.length
  const blocked = blockedNodeCoords(board)

  if (blocked.length > 0) {
    const avoidMoves = [
      { player: "B", moves: blocked, untilDepth: BLOCKED_NODE_DEPTH },
      { player: "W", moves: blocked, untilDepth: BLOCKED_NODE_DEPTH },
    ]

    if (validMoves) {
      const illegalForCurrent = []
      for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
          if (validMoves[x]?.[y] === true) continue
          illegalForCurrent.push(toGtpCoord(x, y))
        }
      }
      if (illegalForCurrent.length > 0) {
        avoidMoves.push({ player, moves: illegalForCurrent, untilDepth: ROOT_MOVE_DEPTH })
      }
    }

    return { avoidMoves }
  }

  if (validMoves) {
    const allowed = []
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        if (validMoves[x]?.[y] === true) allowed.push(toGtpCoord(x, y))
      }
    }
    allowed.push("pass")
    return {
      allowMoves: [{ player, moves: allowed, untilDepth: ROOT_MOVE_DEPTH }],
    }
  }

  return {}
}

export function buildKataGoQuery(request, queryId, compression = null) {
  const board = compression?.board ?? request.board
  const validMoves = compression?.validMoves ?? request.validMoves
  const size = board.length
  const komi = request.komi ?? 5.5
  const playAs = kataGoPlayer(request.playAs)
  const visits = Math.max(50, Math.min(20000, Number(request.iterations) || 4000))
  const restrictions = buildMoveRestrictions(board, validMoves, request.playAs)

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
    ...restrictions,
  }
}

function pickLegalOnOriginal(validMoves, x, y) {
  return validMoves?.[x]?.[y] === true
}

function mapMoveToOriginal(move, compression, validMoves) {
  if (move.type === "pass") return move
  const orig = compression?.toOriginal(move.x, move.y) ?? move
  if (pickLegalOnOriginal(validMoves, orig.x, orig.y)) {
    return { type: "move", x: orig.x, y: orig.y }
  }
  return null
}

/** Pick best legal move from KataGo moveInfos using validMoves mask (original board coords). */
export function pickMoveFromAnalysis(moveInfos, validMoves, playAs, compression = null) {
  const sorted = [...(moveInfos ?? [])].sort((a, b) => (b.visits ?? 0) - (a.visits ?? 0))

  for (const info of sorted) {
    const parsed = fromKataGoMove(info.move)
    if (!parsed) continue
    if (parsed.type === "pass") return { type: "pass" }
    const mapped = mapMoveToOriginal(parsed, compression, validMoves)
    if (mapped) return mapped
  }

  for (const info of sorted) {
    const parsed = fromKataGoMove(info.move)
    if (parsed?.type !== "move") continue
    const mapped = mapMoveToOriginal(parsed, compression, validMoves)
    if (mapped) return mapped
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
