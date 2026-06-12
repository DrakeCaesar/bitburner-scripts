import { NS, type ReactNode } from "@ns"
import type { GoOpponent } from "@ns"
import { col, ScriptLogBuilder } from "@/libraries/scriptLogUiLayout.js"
import { getReact, type ReactTableConfig } from "@/libraries/scriptLogUi.js"
import {
  boardGridSizePx,
  buildBoardCell,
  buildCoordCell,
  buildEmptyCell,
  type CellHighlight,
} from "./boardSvgs.js"
import { columnLabel, formatIpvgoPoint, parseIpvgoPoint, rowLabel } from "./coords.js"
import type { IpvgoBoard, IpvgoMove, IpvgoValidMoves } from "./types.js"

export type IpvgoBackend = "katago" | "native" | "pending"

export type IpvgoGameMoveRow = {
  number: number
  black: string
  white: string
  note?: string
}

export type IpvgoDashboardSnapshot = {
  opponent: GoOpponent
  boardSize: number
  iterations: number
  autoReset: boolean
  backend: IpvgoBackend
  gamesPlayed: number
  moveNumber: number
  currentPlayer: string
  komi: number
  blackScore: number
  whiteScore: number
  board: IpvgoBoard
  validMoves?: IpvgoValidMoves
  legalCount: number
  thinking: boolean
  thinkMs: number
  sims: number
  lastOurMove?: IpvgoMove
  lastOpponentMove?: string
  phase: string
  winStreak: number
  wins: number
  losses: number
  gameMoves: readonly IpvgoGameMoveRow[]
}

export function createIpvgoSnapshot(
  opponent: GoOpponent,
  boardSize: number,
  iterations: number,
  autoReset: boolean
): IpvgoDashboardSnapshot {
  return {
    opponent,
    boardSize,
    iterations,
    autoReset,
    backend: "pending",
    gamesPlayed: 0,
    moveNumber: 0,
    currentPlayer: "None",
    komi: 5.5,
    blackScore: 0,
    whiteScore: 0,
    board: [],
    legalCount: 0,
    thinking: false,
    thinkMs: 0,
    sims: 0,
    phase: "Starting",
    winStreak: 0,
    wins: 0,
    losses: 0,
    gameMoves: [],
  }
}

const MAX_MOVE_ROWS = 60

function formatMove(move: IpvgoMove): string {
  return move.type === "pass" ? "pass" : formatIpvgoPoint(move.x, move.y)
}

function upsertGameMoveRow(
  gameMoves: readonly IpvgoGameMoveRow[],
  number: number,
  patch: Partial<Omit<IpvgoGameMoveRow, "number">>
): IpvgoGameMoveRow[] {
  const rows = [...gameMoves]
  const idx = rows.findIndex((row) => row.number === number)
  if (idx >= 0) {
    rows[idx] = { ...rows[idx], ...patch }
    return rows
  }
  return [...rows, { number, black: "", white: "", ...patch }]
}

export function recordOurMove(
  snapshot: IpvgoDashboardSnapshot,
  moveNumber: number,
  move: IpvgoMove,
  note?: string
): IpvgoDashboardSnapshot {
  return {
    ...snapshot,
    gameMoves: upsertGameMoveRow(snapshot.gameMoves, moveNumber, { black: formatMove(move), note }),
  }
}

export function recordOpponentMove(
  snapshot: IpvgoDashboardSnapshot,
  moveNumber: number,
  move: string
): IpvgoDashboardSnapshot {
  return {
    ...snapshot,
    gameMoves: upsertGameMoveRow(snapshot.gameMoves, moveNumber, { white: move }),
  }
}

export function recordGameResult(
  snapshot: IpvgoDashboardSnapshot,
  won: boolean,
  blackScore: number,
  whiteScore: number
): IpvgoDashboardSnapshot {
  const rows = [...snapshot.gameMoves]
  rows.push({
    number: rows.length + 1,
    black: won ? "WIN" : "LOSS",
    white: `B ${blackScore.toFixed(1)} / W ${whiteScore.toFixed(1)}`,
    note: "result",
  })
  return { ...snapshot, gameMoves: rows }
}

function formatStreak(winStreak: number): string {
  if (winStreak === 0) return "-"
  if (winStreak > 0) return `${winStreak}W`
  return `${Math.abs(winStreak)}L`
}

function scoreLeadText(blackScore: number, whiteScore: number): string {
  const lead = blackScore - whiteScore
  if (lead === 0) return "even"
  return lead > 0 ? `B+${lead.toFixed(1)}` : `W+${(-lead).toFixed(1)}`
}

function buildStatusTable(snapshot: IpvgoDashboardSnapshot): ReactTableConfig {
  const thinking =
    snapshot.thinking ? `yes (${snapshot.iterations} sims)` : snapshot.thinkMs > 0 ? `${snapshot.sims} sims / ${snapshot.thinkMs.toFixed(0)}ms` : "no"

  return {
    title: "IPvGO",
    columns: [
      col("", "left", 10),
      col("", "left", 18),
    ],
    rows: [
      ["Phase", snapshot.phase],
      ["Opponent", snapshot.opponent],
      ["Board", `${snapshot.boardSize}x${snapshot.boardSize}`],
      ["Engine", snapshot.backend],
      ["Turn", snapshot.currentPlayer],
      ["Score", `B ${snapshot.blackScore.toFixed(1)} / W ${snapshot.whiteScore.toFixed(1)} (${scoreLeadText(snapshot.blackScore, snapshot.whiteScore)})`],
      ["Move", String(snapshot.moveNumber)],
      ["Legal", String(snapshot.legalCount)],
      ["Thinking", thinking],
    ],
    separatorAfter: [4],
  }
}

function buildRecordTable(snapshot: IpvgoDashboardSnapshot): ReactTableConfig {
  const streak = formatStreak(snapshot.winStreak)
  const highlightCells = new Set<string>()
  if (snapshot.winStreak > 0) highlightCells.add("0,2")
  if (snapshot.winStreak < 0) highlightCells.add("0,2")

  return {
    title: "Record",
    columns: [
      col("Wins", "right", 6),
      col("Losses", "right", 6),
      col("Streak", "right", 8),
      col("Played", "right", 6),
    ],
    rows: [[String(snapshot.wins), String(snapshot.losses), streak, String(snapshot.wins + snapshot.losses)]],
    highlightCells,
  }
}

function buildCurrentGameTable(snapshot: IpvgoDashboardSnapshot): ReactTableConfig {
  const rows = [...snapshot.gameMoves]
    .sort((a, b) => a.number - b.number)
    .slice(-MAX_MOVE_ROWS)
    .map((row) => [String(row.number), row.black || "-", row.white || "-", row.note ?? ""])

  const lastMoveRow = [...snapshot.gameMoves]
    .filter((row) => row.note !== "result")
    .sort((a, b) => a.number - b.number)
    .at(-1)
  const selectedRowIndex = lastMoveRow
    ? rows.findIndex((row) => row[0] === String(lastMoveRow.number))
    : undefined

  return {
    title: "Current game",
    columns: [
      col("#", "right", 3),
      col("Black", "left", 8),
      col("White", "left", 8),
      col("Note", "left", 18),
    ],
    rows: rows.length > 0 ? rows : [["-", "-", "-", "(waiting for first move)"]],
    selectedRowIndex: selectedRowIndex !== undefined && selectedRowIndex >= 0 ? selectedRowIndex : undefined,
  }
}

function parseOpponentPoint(lastOpponentMove?: string): { x: number; y: number } | undefined {
  if (!lastOpponentMove) return undefined
  return parseIpvgoPoint(lastOpponentMove)
}

function cellHighlight(
  x: number,
  y: number,
  lastOurMove: IpvgoMove | undefined,
  opponentPoint: { x: number; y: number } | undefined
): CellHighlight | undefined {
  const ourPlay = lastOurMove?.type === "move" && lastOurMove.x === x && lastOurMove.y === y
  const oppPlay = opponentPoint?.x === x && opponentPoint?.y === y

  if (ourPlay) return "our"
  if (oppPlay) return "opp"
  return undefined
}

function buildBoardReact(
  board: IpvgoBoard,
  lastOurMove?: IpvgoMove,
  lastOpponentMove?: string
): ReactNode {
  const React = getReact()

  if (board.length === 0) {
    return buildTextBlockMinimal("(no board yet)")
  }

  const size = board.length
  const opponentPoint = parseOpponentPoint(lastOpponentMove)

  const headerRow = React.createElement(
    "div",
    { key: "header", style: { display: "flex", flexDirection: "row" } },
    buildEmptyCell("corner"),
    ...Array.from({ length: size }, (_, x) => buildCoordCell(columnLabel(x), `hx-${x}`))
  )

  // API y=0 is bottom; top row is y=size-1. Labels match in-game coords (A.5 at top-left on 5x5).
  const rows = Array.from({ length: size }, (_, displayRow) => {
    const y = size - 1 - displayRow
    const stones = Array.from({ length: size }, (_, x) => {
      const highlight = cellHighlight(x, y, lastOurMove, opponentPoint)
      return buildBoardCell(board, x, y, highlight, `${x}-${y}`)
    })
    return React.createElement(
      "div",
      { key: `row-${y}`, style: { display: "flex", flexDirection: "row" } },
      buildCoordCell(rowLabel(y), `hy-${y}`),
      ...stones
    )
  })

  return React.createElement(
    "div",
    {
      style: {
        display: "inline-block",
        fontFamily: "monospace",
        margin: "0 0 4px 0",
        lineHeight: 0,
      },
    },
    headerRow,
    ...rows
  )
}

function buildTextBlockMinimal(text: string): ReactNode {
  const React = getReact()
  return React.createElement(
    "pre",
    {
      style: {
        fontFamily: "monospace",
        fontSize: "12px",
        lineHeight: "16px",
        margin: "0 0 4px 0",
        padding: "0",
        whiteSpace: "pre-wrap",
      },
    },
    text
  )
}

function populateDashboard(log: ScriptLogBuilder, snapshot: IpvgoDashboardSnapshot): void {
  log.table(buildStatusTable(snapshot))
  log.table(buildRecordTable(snapshot))

  const boardSizePx = boardGridSizePx(snapshot.board.length || snapshot.boardSize)
  log.react(buildBoardReact(snapshot.board, snapshot.lastOurMove, snapshot.lastOpponentMove), boardSizePx)

  log.table(buildCurrentGameTable(snapshot))
}

export function refreshFactionStats(snapshot: IpvgoDashboardSnapshot, ns: NS): IpvgoDashboardSnapshot {
  const stats = ns.go.analysis.getStats()[snapshot.opponent]
  if (!stats) return snapshot
  return {
    ...snapshot,
    winStreak: stats.winStreak ?? 0,
    wins: stats.wins ?? 0,
    losses: stats.losses ?? 0,
  }
}

export async function renderIpvgoDashboard(
  ns: NS,
  log: ScriptLogBuilder,
  snapshot: IpvgoDashboardSnapshot
): Promise<void> {
  log.reset()
  populateDashboard(log, snapshot)
  await log.render(ns)
}
