const COLUMN_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"

/** Ply depth for root-only move mask (current player). */
const ROOT_MOVE_DEPTH = 1
/** Ply depth for permanent blocked-node prohibition (both players). */
const BLOCKED_NODE_DEPTH = 999

/** Experimental: show # as opponent stones in KataGo initialStones (we play Black). */
const PHANTOM_OPPONENT_ON_BLOCKED = true

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
    xMin,
    yMin,
    toOriginal(x, y) {
      return { x: x + xMin, y: y + yMin }
    },
    fromOriginal(ox, oy) {
      if (ox < xMin || ox > xMax || oy < yMin || oy > yMax) return null
      return { x: ox - xMin, y: oy - yMin }
    },
  }
}

function kataGoPlayer(playAs) {
  return playAs === "O" ? "W" : "B"
}

/**
 * Current position as KataGo initialStones.
 * When PHANTOM_OPPONENT_ON_BLOCKED, each # is sent as an opponent stone so the net
 * sees occupancy; avoidMoves still bans playing on those intersections.
 */
export function boardToInitialStones(board, playAs = "X") {
  const stones = []
  const phantomOnBlocked = PHANTOM_OPPONENT_ON_BLOCKED ? kataGoPlayer(playAs === "O" ? "X" : "O") : null
  const size = board.length
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const cell = cellAt(board, x, y)
      if (cell === "X") stones.push(["B", toGtpCoord(x, y)])
      else if (cell === "O") stones.push(["W", toGtpCoord(x, y)])
      else if (cell === "#" && phantomOnBlocked) stones.push([phantomOnBlocked, toGtpCoord(x, y)])
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

function boardsEqual(before, after) {
  if (!before?.length || !after?.length || before.length !== after.length) return false
  for (let x = 0; x < before.length; x++) {
    if (before[x] !== after[x]) return false
  }
  return true
}

/**
 * Derive one ply from consecutive IPvGO board snapshots (getMoveHistory order is newest-first).
 * Player comes from the stone color placed, not alternation — passes are inferred later.
 */
function extractStoneMove(before, after) {
  if (boardsEqual(before, after)) {
    return { type: "pass" }
  }

  let placed = null
  const size = before.length
  for (let x = 0; x < size; x++) {
    const colBefore = before[x] ?? ""
    const colAfter = after[x] ?? ""
    for (let y = 0; y < colBefore.length; y++) {
      const b = colBefore[y] ?? "."
      const a = colAfter[y] ?? "."
      if (b === "." && (a === "X" || a === "O")) {
        if (placed) return { type: "ambiguous" }
        placed = { x, y, color: a }
      }
    }
  }

  if (!placed) return { type: "invalid" }

  return {
    type: "move",
    player: placed.color === "X" ? "B" : "W",
    x: placed.x,
    y: placed.y,
  }
}

/** IPvGO does not snapshot passes; same player twice in a row implies an omitted pass. */
function insertInferredPasses(moves) {
  const fixed = []
  for (const move of moves) {
    if (fixed.length > 0 && fixed[fixed.length - 1][0] === move[0]) {
      const passer = move[0] === "B" ? "W" : "B"
      fixed.push([passer, "pass"])
    }
    fixed.push(move)
  }
  return fixed
}

function mapGtpThroughCompression(x, y, compression) {
  if (!compression?.fromOriginal) return toGtpCoord(x, y)
  const mapped = compression.fromOriginal(x, y)
  if (!mapped) return null
  return toGtpCoord(mapped.x, mapped.y)
}

/**
 * Build KataGo move list from board snapshots. IPvGO only stores boards before each stone
 * placement (not passes), so moves are reconstructed by diffing consecutive states.
 *
 * @returns {{ ok: boolean, moves?: string[][], startBoard?: string[], reason?: string }}
 */
export function deriveKataGoMovesFromHistory(history, currentBoard, compression = null) {
  if (!history?.length || !currentBoard?.length) {
    return { ok: false, reason: "no-history" }
  }

  const chronological = [...history].reverse()
  const states = [...chronological, currentBoard]
  const moves = []

  for (let i = 0; i < states.length - 1; i++) {
    const step = extractStoneMove(states[i], states[i + 1])
    if (step.type === "pass") {
      return { ok: false, reason: "unexpected-pass-snapshot", index: i }
    }
    if (step.type !== "move") {
      return { ok: false, reason: step.type, index: i }
    }

    const gtp = mapGtpThroughCompression(step.x, step.y, compression)
    if (!gtp) {
      return { ok: false, reason: "move-outside-compression", index: i }
    }

    moves.push([step.player, gtp])
  }

  return {
    ok: true,
    moves: insertInferredPasses(moves),
    states,
    startBoard: chronological[0],
  }
}

function sliceBoardToCompression(board, compression) {
  if (!compression) return board
  const width = compression.board.length
  const height = compression.board[0]?.length ?? width
  const { xMin, yMin } = compression
  const sliced = []
  for (let x = xMin; x < xMin + width; x++) {
    let col = ""
    for (let y = yMin; y < yMin + height; y++) {
      col += cellAt(board, x, y)
    }
    sliced.push(col)
  }
  return sliced
}

/** Strip bridge-only fields before sending JSON to KataGo. */
export function toKataGoPayload(query) {
  const {
    historyMode: _historyMode,
    historyFallback: _historyFallback,
    moveCount: _moveCount,
    replayFromPly: _replayFromPly,
    ...payload
  } = query
  return payload
}

export function parseKatagoIllegalMoveIndex(message) {
  const match = String(message).match(/Illegal move (\d+)/)
  if (!match) return null
  const index = Number(match[1])
  return Number.isFinite(index) ? index : null
}

function buildSnapshotQuery(request, queryId, compression, board, validMoves, playAs, komi, visits) {
  const restrictions = buildMoveRestrictions(board, validMoves, request.playAs)
  return {
    id: queryId,
    initialStones: boardToInitialStones(board, request.playAs),
    moves: [],
    initialPlayer: playAs,
    rules: "chinese",
    komi,
    boardXSize: board.length,
    boardYSize: board.length,
    maxVisits: visits,
    ...restrictions,
  }
}

export function buildKataGoQuery(request, queryId, compression = null, replayFromPly = 0) {
  const board = compression?.board ?? request.board
  const validMoves = compression?.validMoves ?? request.validMoves
  const komi = request.komi ?? 5.5
  const playAs = kataGoPlayer(request.playAs)
  const visits = Math.max(50, Math.min(20000, Number(request.iterations) || 4000))

  const historyResult = deriveKataGoMovesFromHistory(request.history, request.board, compression)
  if (!historyResult.ok || replayFromPly >= historyResult.moves.length) {
    return {
      ...buildSnapshotQuery(request, queryId, compression, board, validMoves, playAs, komi, visits),
      historyMode: "snapshot",
      historyFallback: historyResult.ok ? "replay-exhausted" : historyResult.reason,
    }
  }

  const anchorBoard = historyResult.states[replayFromPly]
  const queryBoard = compression ? sliceBoardToCompression(anchorBoard, compression) : anchorBoard
  const moveSlice = historyResult.moves.slice(replayFromPly)
  const restrictions = buildMoveRestrictions(board, validMoves, request.playAs)

  return {
    id: queryId,
    initialStones: boardToInitialStones(queryBoard, request.playAs),
    moves: moveSlice,
    initialPlayer: moveSlice[0]?.[0] ?? playAs,
    rules: "chinese",
    komi,
    boardXSize: queryBoard.length,
    boardYSize: queryBoard.length,
    maxVisits: visits,
    historyMode: "replay",
    moveCount: moveSlice.length,
    replayFromPly,
    ...restrictions,
  }
}

/** Same as buildKataGoQuery but forces current-board snapshot (no move replay). */
export function buildKataGoSnapshotQuery(request, queryId, compression = null) {
  const board = compression?.board ?? request.board
  const validMoves = compression?.validMoves ?? request.validMoves
  const komi = request.komi ?? 5.5
  const playAs = kataGoPlayer(request.playAs)
  const visits = Math.max(50, Math.min(20000, Number(request.iterations) || 4000))
  return {
    ...buildSnapshotQuery(request, queryId, compression, board, validMoves, playAs, komi, visits),
    historyMode: "snapshot",
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
