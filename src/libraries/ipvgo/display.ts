import { NS, type ReactNode } from "@ns"
import type { GoOpponent } from "@ns"
import { col, mergeTailLayout, ScriptLogBuilder, type AdaptiveTailLogHandle } from "@/libraries/scriptLogUiLayout.js"
import {
  cellStyle,
  computeReactTableWidthPx,
  estimateReactTableHeightPx,
  getReact,
  headerCellStyle,
  type ReactTableConfig,
} from "@/libraries/scriptLogUi.js"
import {
  boardGridSizePx,
  buildBoardCell,
  buildCoordCell,
  buildEmptyCell,
  type CellHighlight,
} from "./boardSvgs.js"
import { columnLabel, formatIpvgoPoint, parseIpvgoPoint, rowLabel } from "./coords.js"
import type { IpvgoBoard, IpvgoBoardSize, IpvgoMove, IpvgoValidMoves } from "./types.js"
import { IPVGO_BOARD_SIZES, IPVGO_BONUS_LABEL, IPVGO_ITERATION_PRESETS, IPVGO_ITERATIONS_PER_TABLE_ROW, IPVGO_OPPONENTS } from "./types.js"
import {
  getFactionSims,
  isFactionEnabled,
  estimateNodePowerByFaction,
  pickLowestNodePowerFaction,
  type IpvgoFactionConfig,
} from "./factionConfig.js"
import {
  getSimEditFaction,
  getDeferredSetup,
  queueFactionEnabledToggle,
  queueFactionSimsChange,
  queueSetupBoardClick,
  queueSimEditFaction,
  setupCellKey,
  type IpvgoSetupSelection,
} from "./uiControl.js"

export type IpvgoBackend = "katago" | "native" | "pending"

export type IpvgoGameMoveRow = {
  number: number
  /** Opponent (White). */
  white: string
  whiteMs?: number
  /** Us (Black). */
  black: string
  blackMs?: number
  blackSims?: number
  /** Result row marker. */
  result?: boolean
}

export type IpvgoFactionStats = {
  wins: number
  losses: number
  winStreak: number
  bonusPercent: number
  bonusDescription: string
}

export type IpvgoDashboardSnapshot = {
  opponent: GoOpponent
  boardSize: number
  iterations: number
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
  /** Cached from ns.go.analysis.getStats(); UI must not call Netscript during render. */
  opponentStats: Partial<Record<GoOpponent, IpvgoFactionStats>>
  gameMoves: readonly IpvgoGameMoveRow[]
  cheatAvailable: boolean
  cheatCount: number
  cheatSuccessChance: number
  /** Queued opponent/size after the current game finishes. */
  deferredSetup?: IpvgoSetupSelection | null
  /** Per-faction KataGo visit count (from ipvgo-settings.json). */
  factionSims: Partial<Record<GoOpponent, number>>
  /** Per-faction auto-rotation enable (from ipvgo-settings.json). */
  factionEnabled: Partial<Record<GoOpponent, boolean>>
  /** Estimated node power used to pick the auto opponent. */
  nodePowerByFaction: Partial<Record<GoOpponent, number>>
  /** Faction with lowest node power (auto target for next game). */
  autoOpponent: GoOpponent
  /** Faction row selected for sim preset clicks. */
  simEditFaction: GoOpponent
}

export function createIpvgoSnapshot(
  opponent: GoOpponent,
  boardSize: number,
  iterations: number
): IpvgoDashboardSnapshot {
  return {
    opponent,
    boardSize,
    iterations,
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
    opponentStats: {},
    gameMoves: [],
    cheatAvailable: false,
    cheatCount: 0,
    cheatSuccessChance: 0,
    factionSims: {},
    factionEnabled: {},
    nodePowerByFaction: {},
    autoOpponent: opponent,
    simEditFaction: opponent,
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
  return [...rows, { number, white: "", black: "", ...patch }]
}

function formatOurTime(row: IpvgoGameMoveRow): string {
  if (row.blackMs == null) return "-"
  if (row.blackSims != null) return `${row.blackSims} / ${row.blackMs.toFixed(0)}`
  return `${row.blackMs.toFixed(0)}`
}

function formatOppTime(row: IpvgoGameMoveRow): string {
  if (row.whiteMs == null) return "-"
  return `${row.whiteMs.toFixed(0)}`
}

export function recordOurMove(
  snapshot: IpvgoDashboardSnapshot,
  moveNumber: number,
  move: IpvgoMove,
  timing?: { thinkMs?: number; sims?: number }
): IpvgoDashboardSnapshot {
  return {
    ...snapshot,
    gameMoves: upsertGameMoveRow(snapshot.gameMoves, moveNumber, {
      black: formatMove(move),
      blackMs: timing?.thinkMs,
      blackSims: timing?.sims,
    }),
  }
}

export function recordOurCheat(
  snapshot: IpvgoDashboardSnapshot,
  moveNumber: number,
  label: string,
  elapsedMs?: number
): IpvgoDashboardSnapshot {
  return {
    ...snapshot,
    gameMoves: upsertGameMoveRow(snapshot.gameMoves, moveNumber, {
      black: label,
      blackMs: elapsedMs,
    }),
  }
}

export function recordOpponentMove(
  snapshot: IpvgoDashboardSnapshot,
  moveNumber: number,
  move: string,
  thinkMs?: number
): IpvgoDashboardSnapshot {
  return {
    ...snapshot,
    gameMoves: upsertGameMoveRow(snapshot.gameMoves, moveNumber, { white: move, whiteMs: thinkMs }),
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
    white: `B ${blackScore.toFixed(1)} / W ${whiteScore.toFixed(1)}`,
    black: won ? "WIN" : "LOSS",
    result: true,
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

function factionRecordLabel(
  opponent: GoOpponent,
  snapshot: IpvgoDashboardSnapshot,
  options?: { auto?: boolean }
): string {
  const stats = snapshot.opponentStats[opponent]
  const autoMark = options?.auto ? " A" : ""
  if (!stats) return `${opponent}${autoMark}`
  return `${opponent} (${stats.wins}-${stats.losses})${autoMark}`
}

function formatNodePower(snapshot: IpvgoDashboardSnapshot, faction: GoOpponent): string {
  const np = snapshot.nodePowerByFaction[faction]
  if (np == null) return "-"
  return np >= 1000 ? `${(np / 1000).toFixed(1)}k` : String(Math.round(np))
}

function factionRewardLabel(opponent: GoOpponent, snapshot: IpvgoDashboardSnapshot): string {
  const stats = snapshot.opponentStats[opponent]
  const reward = stats?.bonusDescription || IPVGO_BONUS_LABEL[opponent] || "-"
  const pct = stats?.bonusPercent ?? 0
  return `+${pct.toFixed(1)}% ${reward}`
}

function buildSetupTableConfig(snapshot: IpvgoDashboardSnapshot): ReactTableConfig {
  const playingKey = setupCellKey(snapshot.opponent, snapshot.boardSize as IpvgoBoardSize)
  const displayKey = snapshot.deferredSetup
    ? setupCellKey(snapshot.deferredSetup.opponent, snapshot.deferredSetup.boardSize)
    : playingKey

  return {
    title: "Setup (A=auto, On=click)",
    columns: [
      col("On", "center", 3),
      col("Faction", "left", 22),
      col("Reward", "left", 28),
      col("Sims", "right", 5),
      col("NP", "right", 5),
      ...IPVGO_BOARD_SIZES.map((size) => col(String(size), "center", 3)),
    ],
    rows: IPVGO_OPPONENTS.map((faction) => [
      snapshot.factionEnabled[faction] === false ? "off" : "on",
      factionRecordLabel(faction, snapshot, {
        auto: faction === snapshot.autoOpponent && snapshot.factionEnabled[faction] !== false,
      }),
      factionRewardLabel(faction, snapshot),
      String(snapshot.factionSims[faction] ?? "-"),
      formatNodePower(snapshot, faction),
      ...IPVGO_BOARD_SIZES.map((size) => {
        const cellKey = setupCellKey(faction, size)
        const queued = cellKey === displayKey
        const marker = queued ? (snapshot.deferredSetup ? ">" : "*") : ""
        return marker
      }),
    ]),
  }
}

function factionSimsFor(snapshot: IpvgoDashboardSnapshot, faction: GoOpponent): number {
  return snapshot.factionSims[faction] ?? snapshot.iterations
}

function iterationPresetRows(): number[][] {
  const rows: number[][] = []
  for (let i = 0; i < IPVGO_ITERATION_PRESETS.length; i += IPVGO_ITERATIONS_PER_TABLE_ROW) {
    rows.push([...IPVGO_ITERATION_PRESETS.slice(i, i + IPVGO_ITERATIONS_PER_TABLE_ROW)])
  }
  return rows
}

function buildSimsTableSizingConfig(): ReactTableConfig {
  const presetRows = iterationPresetRows()
  const width = Math.max(...presetRows.map((row) => row.length))
  const columns = Array.from({ length: width }, () => col("20000", "center", 5))
  return {
    title: "Sims",
    columns,
    rows: presetRows.flatMap((row) => [row.map((preset) => String(preset)), row.map(() => "*")]),
  }
}

function IpvgoSetupPicker(props: { snapshot: IpvgoDashboardSnapshot }): ReactNode {
  const React = getReact()
  const { snapshot } = props
  const layout = mergeTailLayout()
  const config = buildSetupTableConfig(snapshot)
  const { columns } = config
  const playingKey = setupCellKey(snapshot.opponent, snapshot.boardSize as IpvgoBoardSize)
  const deferredKey = snapshot.deferredSetup
    ? setupCellKey(snapshot.deferredSetup.opponent, snapshot.deferredSetup.boardSize)
    : null
  const displayKey = deferredKey ?? playingKey
  const simEditFaction = snapshot.simEditFaction
  const simEditSims = factionSimsFor(snapshot, simEditFaction)

  const headerCells = columns.map((column, idx) =>
    React.createElement(
      "th",
      { key: `h-${idx}`, style: headerCellStyle(layout) },
      column.header
    )
  )

  const bodyRows = IPVGO_OPPONENTS.map((faction, rowIdx) => {
    const enabled = snapshot.factionEnabled[faction] !== false
    const simEditing = faction === simEditFaction
    const autoTarget = enabled && faction === snapshot.autoOpponent
    const cells = [
      React.createElement(
        "td",
        {
          key: "on",
          style: {
            ...cellStyle(layout, { highlight: !enabled, selectedRow: !enabled }, "center"),
            cursor: "pointer",
            opacity: enabled ? "1" : "0.45",
          },
          onClick: () => queueFactionEnabledToggle(faction),
        },
        enabled ? "on" : "off"
      ),
      React.createElement(
        "td",
        {
          key: "name",
          style: {
            ...cellStyle(
              layout,
              { selectedRow: snapshot.opponent === faction || simEditing },
              "left"
            ),
            cursor: "pointer",
            opacity: enabled ? "1" : "0.45",
          },
          onClick: () => queueSimEditFaction(faction),
        },
        factionRecordLabel(faction, snapshot, { auto: autoTarget })
      ),
      React.createElement(
        "td",
        {
          key: "reward",
          style: {
            ...cellStyle(layout, { selectedRow: snapshot.opponent === faction }, "left"),
            opacity: enabled ? "1" : "0.45",
          },
        },
        factionRewardLabel(faction, snapshot)
      ),
      React.createElement(
        "td",
        {
          key: "sims",
          style: {
            ...cellStyle(layout, { highlight: simEditing, selectedRow: simEditing }, "right"),
            cursor: "pointer",
            opacity: enabled ? "1" : "0.45",
          },
          onClick: () => queueSimEditFaction(faction),
        },
        String(factionSimsFor(snapshot, faction))
      ),
      React.createElement(
        "td",
        {
          key: "np",
          style: {
            ...cellStyle(
              layout,
              { highlight: autoTarget, selectedRow: autoTarget },
              "right"
            ),
            opacity: enabled ? "1" : "0.45",
          },
        },
        formatNodePower(snapshot, faction)
      ),
      ...IPVGO_BOARD_SIZES.map((size) => {
        const cellKey = setupCellKey(faction, size)
        const selected = cellKey === displayKey
        const marker = selected ? (snapshot.deferredSetup ? ">" : "*") : ""
        return React.createElement(
          "td",
          {
            key: `size-${size}`,
            style: {
              ...cellStyle(layout, { highlight: selected, selectedRow: selected }, "center"),
              cursor: "pointer",
            },
            onClick: () =>
              queueSetupBoardClick(
                faction,
                size,
                factionSimsFor(snapshot, faction),
                playingKey,
                deferredKey,
                cellKey
              ),
          },
          marker
        )
      }),
    ]
    return React.createElement("tr", { key: `faction-${rowIdx}` }, ...cells)
  })

  const table = React.createElement(
    "table",
    {
      style: {
        borderCollapse: "collapse",
        tableLayout: "fixed",
        width: "max-content",
        margin: "0",
        fontFamily: "monospace",
        fontSize: `${layout.fontSizePx}px`,
      },
    },
    React.createElement("thead", null, React.createElement("tr", null, ...headerCells)),
    React.createElement("tbody", null, ...bodyRows)
  )

  const simsPresetRows = iterationPresetRows()
  const simsCols = Math.max(...simsPresetRows.map((row) => row.length))
  const simsBandRows = simsPresetRows.flatMap((row, bandIdx) => {
    const simsHeaderCells = Array.from({ length: simsCols }, (_, colIdx) => {
      const preset = row[colIdx]
      return React.createElement(
        "th",
        {
          key: `sims-h-${bandIdx}-${colIdx}`,
          style: headerCellStyle(layout),
        },
        preset != null ? String(preset) : ""
      )
    })
    const bodyCells = Array.from({ length: simsCols }, (_, colIdx) => {
      const preset = row[colIdx]
      if (preset == null) {
        return React.createElement(
          "td",
          { key: `sims-e-${bandIdx}-${colIdx}`, style: cellStyle(layout, {}, "center") },
          ""
        )
      }
      const selected = simEditSims === preset
      return React.createElement(
        "td",
        {
          key: `sims-b-${bandIdx}-${colIdx}`,
          style: {
            ...cellStyle(layout, { highlight: selected, selectedRow: selected }, "center"),
            cursor: "pointer",
          },
          onClick: () => queueFactionSimsChange(simEditFaction, preset),
        },
        selected ? "*" : ""
      )
    })
    return [
      React.createElement("tr", { key: `sims-header-${bandIdx}` }, ...simsHeaderCells),
      React.createElement("tr", { key: `sims-body-${bandIdx}` }, ...bodyCells),
    ]
  })

  const simsTable = React.createElement(
    "table",
    {
      style: {
        borderCollapse: "collapse",
        tableLayout: "fixed",
        width: "max-content",
        margin: "4px 0 0 0",
        fontFamily: "monospace",
        fontSize: `${layout.fontSizePx}px`,
      },
    },
    React.createElement("tbody", null, ...simsBandRows)
  )

  return React.createElement(
    "div",
    { style: { display: "block", margin: "0 0 4px 0", padding: "0" } },
    React.createElement(
      "div",
      {
        style: {
          fontFamily: "monospace",
          fontSize: `${layout.fontSizePx}px`,
          lineHeight: `${layout.fontSizePx + 4}px`,
          marginBottom: "4px",
          fontWeight: "bold",
        },
      },
      "=== Setup ==="
    ),
    table,
    React.createElement(
      "div",
      {
        style: {
          fontFamily: "monospace",
          fontSize: `${layout.fontSizePx}px`,
          lineHeight: `${layout.fontSizePx + 4}px`,
          margin: "4px 0 4px 0",
          fontWeight: "bold",
        },
      },
      `=== Sims (${simEditFaction}) ===`
    ),
    simsTable
  )
}

function buildSetupPickerReact(snapshot: IpvgoDashboardSnapshot): ReactNode {
  const React = getReact()
  return React.createElement(IpvgoSetupPicker, { snapshot })
}

function setupPickerSize(snapshot: IpvgoDashboardSnapshot): { widthPx: number; heightPx: number } {
  const layout = mergeTailLayout()
  const setupConfig = buildSetupTableConfig(snapshot)
  const simsConfig = buildSimsTableSizingConfig()
  const setupWidthPx = computeReactTableWidthPx(setupConfig, layout)
  const simsWidthPx = computeReactTableWidthPx(simsConfig, layout)
  const setupHeightPx = estimateReactTableHeightPx({ layout, ...setupConfig }, layout, setupWidthPx)
  const simsHeightPx = estimateReactTableHeightPx({ layout, ...simsConfig }, layout, simsWidthPx)
  return {
    widthPx: Math.max(setupWidthPx, simsWidthPx),
    heightPx: setupHeightPx + simsHeightPx + 4,
  }
}

function buildStatusTable(snapshot: IpvgoDashboardSnapshot): ReactTableConfig {
  return {
    title: "IPvGO",
    columns: [
      col("", "left", 10),
      col("", "left", 18),
    ],
    rows: [
      ["Match", `${snapshot.opponent} ${snapshot.boardSize}x${snapshot.boardSize} / ${snapshot.iterations} sims`],
      ["Auto", `${snapshot.autoOpponent} (lowest NP)`],
      ["Turn", snapshot.currentPlayer],
      ["Score", `B ${snapshot.blackScore.toFixed(1)} / W ${snapshot.whiteScore.toFixed(1)} (${scoreLeadText(snapshot.blackScore, snapshot.whiteScore)})`],
      ["Move", String(snapshot.moveNumber)],
      ["Legal", String(snapshot.legalCount)],
    ],
    separatorAfter: [1],
  }
}

function buildCheatTable(snapshot: IpvgoDashboardSnapshot): ReactTableConfig {
  const available = snapshot.cheatAvailable ? "yes" : "no"
  const count = snapshot.cheatAvailable ? String(snapshot.cheatCount) : "-"
  const chance = snapshot.cheatAvailable ? `${(snapshot.cheatSuccessChance * 100).toFixed(0)}%` : "-"

  return {
    title: "Cheat",
    columns: [
      col("", "left", 10),
      col("", "left", 12),
    ],
    rows: [
      ["Available", available],
      ["This game", count],
      ["Next %", chance],
    ],
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
    .map((row) => [
      String(row.number),
      row.white || "-",
      formatOppTime(row),
      row.black || "-",
      formatOurTime(row),
    ])

  const lastMoveRow = [...snapshot.gameMoves]
    .filter((row) => !row.result)
    .sort((a, b) => a.number - b.number)
    .at(-1)
  const selectedRowIndex = lastMoveRow
    ? rows.findIndex((row) => row[0] === String(lastMoveRow.number))
    : undefined

  return {
    title: "Current game",
    columns: [
      col("#", "right", 3),
      col("Opp", "left", 8),
      col("Opp ms", "right", 10),
      col("Us", "left", 22),
      col("Us ms", "right", 14),
    ],
    rows: rows.length > 0 ? rows : [["-", "-", "-", "-", "-"]],
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

function populateDashboard(ns: NS, log: ScriptLogBuilder, snapshot: IpvgoDashboardSnapshot): void {
  log.react(buildSetupPickerReact(snapshot), setupPickerSize(snapshot))
  log.table(buildStatusTable(snapshot))
  log.table(buildCheatTable(snapshot))
  log.table(buildRecordTable(snapshot))

  const boardSizePx = boardGridSizePx(snapshot.board.length || snapshot.boardSize)
  log.react(buildBoardReact(snapshot.board, snapshot.lastOurMove, snapshot.lastOpponentMove), boardSizePx)

  log.table(buildCurrentGameTable(snapshot))
}

export function enrichSnapshotWithFactionConfig(
  ns: NS,
  snapshot: IpvgoDashboardSnapshot,
  config: IpvgoFactionConfig
): IpvgoDashboardSnapshot {
  const nodePowerByFaction = estimateNodePowerByFaction(ns, snapshot.opponentStats)
  const autoOpponent = pickLowestNodePowerFaction(nodePowerByFaction, config)
  const factionSims: Partial<Record<GoOpponent, number>> = {}
  const factionEnabled: Partial<Record<GoOpponent, boolean>> = {}
  for (const faction of IPVGO_OPPONENTS) {
    factionSims[faction] = getFactionSims(config, faction)
    factionEnabled[faction] = isFactionEnabled(config, faction)
  }
  const simEditFaction = getSimEditFaction() ?? snapshot.simEditFaction ?? snapshot.opponent
  return {
    ...snapshot,
    factionSims,
    factionEnabled,
    nodePowerByFaction,
    autoOpponent,
    simEditFaction,
    iterations: getFactionSims(config, snapshot.opponent),
  }
}

export function refreshFactionStats(snapshot: IpvgoDashboardSnapshot, ns: NS): IpvgoDashboardSnapshot {
  const allStats = ns.go.analysis.getStats()
  const opponentStats: Partial<Record<GoOpponent, IpvgoFactionStats>> = {}
  for (const faction of IPVGO_OPPONENTS) {
    const stats = allStats[faction]
    if (!stats) continue
    opponentStats[faction] = {
      wins: stats.wins ?? 0,
      losses: stats.losses ?? 0,
      winStreak: stats.winStreak ?? 0,
      bonusPercent: stats.bonusPercent ?? 0,
      bonusDescription: stats.bonusDescription ?? "",
    }
  }
  const current = opponentStats[snapshot.opponent]
  return {
    ...snapshot,
    opponentStats,
    winStreak: current?.winStreak ?? snapshot.winStreak,
    wins: current?.wins ?? snapshot.wins,
    losses: current?.losses ?? snapshot.losses,
  }
}

export async function renderIpvgoDashboard(
  ns: NS,
  log: ScriptLogBuilder,
  snapshot: IpvgoDashboardSnapshot,
  adaptive?: AdaptiveTailLogHandle
): Promise<void> {
  log.reset()
  populateDashboard(ns, log, snapshot)
  if (adaptive) {
    await adaptive.render(ns, log)
  } else {
    await log.render(ns)
  }
}

export function applyIpvgoSetupChange(
  ns: NS,
  snapshot: IpvgoDashboardSnapshot,
  pending: IpvgoSetupSelection | null,
  options?: { forceReset?: boolean }
): { snapshot: IpvgoDashboardSnapshot; changed: boolean } {
  if (!pending) return { snapshot, changed: false }
  if (
    !options?.forceReset &&
    pending.opponent === snapshot.opponent &&
    pending.boardSize === snapshot.boardSize &&
    pending.iterations === snapshot.iterations
  ) {
    return { snapshot, changed: false }
  }

  const boardChanged =
    pending.opponent !== snapshot.opponent || pending.boardSize !== snapshot.boardSize
  const needsReset = boardChanged || options?.forceReset === true

  if (needsReset) {
    ns.go.resetBoardState(pending.opponent, pending.boardSize)
  }

  const phase = needsReset
    ? `${pending.opponent} ${pending.boardSize}x${pending.boardSize}`
    : `Sims ${pending.iterations}`

  const next = refreshFactionStats(
    {
      ...snapshot,
      opponent: pending.opponent,
      boardSize: pending.boardSize,
      iterations: pending.iterations,
      deferredSetup: null,
      ...(needsReset
        ? {
            moveNumber: 0,
            gameMoves: [],
            lastOurMove: undefined,
            lastOpponentMove: undefined,
            thinkMs: 0,
            sims: 0,
            thinking: false,
          }
        : {}),
      phase,
    },
    ns
  )
  return { snapshot: next, changed: true }
}

export function syncDeferredSetupSnapshot(snapshot: IpvgoDashboardSnapshot): IpvgoDashboardSnapshot {
  const deferred = getDeferredSetup()
  const prev = snapshot.deferredSetup
  const same =
    (deferred == null && prev == null) ||
    (deferred != null &&
      prev != null &&
      deferred.opponent === prev.opponent &&
      deferred.boardSize === prev.boardSize &&
      deferred.iterations === prev.iterations)
  if (same) return snapshot
  return { ...snapshot, deferredSetup: deferred ?? undefined }
}
