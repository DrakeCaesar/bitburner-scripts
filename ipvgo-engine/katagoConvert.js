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

export function buildKataGoQuery(request, queryId) {
  const board = request.board
  const size = board.length
  const komi = request.komi ?? 5.5
  const playAs = kataGoPlayer(request.playAs)
  const visits = Math.max(50, Math.min(20000, Number(request.iterations) || 4000))
  const restrictions = buildMoveRestrictions(board, request.validMoves, request.playAs)

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

/** Pick best legal move from KataGo moveInfos using validMoves mask. */
export function pickMoveFromAnalysis(moveInfos, validMoves, playAs) {
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
