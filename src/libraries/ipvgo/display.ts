import { NS, type ReactNode } from "@ns"
import type { GoOpponent } from "@ns"
import { ScriptLogBuilder } from "@/libraries/scriptLogUiLayout.js"
import { getReact } from "@/libraries/scriptLogUi.js"
import {
  boardGridSizePx,
  buildBoardCell,
  buildCoordCell,
  buildEmptyCell,
  type CellHighlight,
} from "./boardSvgs.js"
import { columnLabel, formatIpvgoPoint, parseIpvgoPoint, rowLabel } from "./coords.js"
import type { IpvgoBoard, IpvgoMove, IpvgoValidMoves } from "./types.js"

export type IpvgoBackend = "native" | "worker" | "pending"

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
  logLines: readonly string[]
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
    logLines: [],
  }
}

const MAX_LOG_LINES = 80
const LOG_DISPLAY_LINES = 12

export function appendIpvgoLog(snapshot: IpvgoDashboardSnapshot, message: string): IpvgoDashboardSnapshot {
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false })
  const line = `[${time}] ${message}`
  const logLines = [...snapshot.logLines, line]
  if (logLines.length > MAX_LOG_LINES) {
    logLines.splice(0, logLines.length - MAX_LOG_LINES)
  }
  return { ...snapshot, logLines }
}

function formatMove(move: IpvgoMove): string {
  return move.type === "pass" ? "pass" : formatIpvgoPoint(move.x, move.y)
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
  const scoreLead = snapshot.blackScore - snapshot.whiteScore
  const leadText =
    scoreLead === 0 ? "even" : scoreLead > 0 ? `B+${scoreLead.toFixed(1)}` : `W+${(-scoreLead).toFixed(1)}`

  log.keyValueTable({
    title: "IPvGO",
    rows: [
      { label: "Phase", value: snapshot.phase },
      { label: "Opponent", value: snapshot.opponent },
      { label: "Board", value: `${snapshot.boardSize}x${snapshot.boardSize}` },
      { label: "Engine", value: snapshot.backend },
      { label: "Turn", value: snapshot.currentPlayer },
      { label: "Score", value: `B ${snapshot.blackScore.toFixed(1)} / W ${snapshot.whiteScore.toFixed(1)} (${leadText})` },
      { label: "Move", value: String(snapshot.moveNumber) },
      { label: "Legal", value: String(snapshot.legalCount) },
      { label: "Record", value: `W ${snapshot.wins} L ${snapshot.losses} streak ${snapshot.winStreak}` },
    ],
    separatorAfter: [4],
  })

  if (snapshot.thinking) {
    log.text(`Thinking... (${snapshot.iterations} sims)`)
  } else if (snapshot.thinkMs > 0 || snapshot.sims > 0) {
    log.text(`Last search: ${snapshot.sims} sims in ${snapshot.thinkMs.toFixed(0)} ms`)
  }

  log.section("Board")
  const boardSizePx = boardGridSizePx(snapshot.board.length || snapshot.boardSize)
  log.react(buildBoardReact(snapshot.board, snapshot.lastOurMove, snapshot.lastOpponentMove), boardSizePx)
  log.text("Arms: purple white (O)  green black (X)  dot = empty node")
  log.text("Ring: solid our last  dashed opp last")

  if (snapshot.lastOurMove) {
    log.text(`Our last: ${formatMove(snapshot.lastOurMove)}`)
  }
  if (snapshot.lastOpponentMove) {
    log.text(`Opp last: ${snapshot.lastOpponentMove}`)
  }

  log.section("Log")
  if (snapshot.logLines.length === 0) {
    log.text("(no events yet)")
  } else {
    const recent = snapshot.logLines.slice(-LOG_DISPLAY_LINES)
    log.text(recent.join("\n"))
  }
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
