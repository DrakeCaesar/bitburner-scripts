import type { ReactNode } from "@ns"
import { getReact } from "@/libraries/scriptLogUi.js"
import type { IpvgoBoard } from "./types.js"

/** Square cell size in px (stones, coords, and labels all match). */
export const BOARD_CELL_PX = 48
const VIEW = 24
const CENTER = VIEW / 2
/** Stone radius; smaller than half-cell so connection arms show around the node. */
const STONE_R = 7

/** White routers (O) in IPvGO use purple arms (theme cha). */
export const LIBERTY_WHITE = "#893BC8"
/** Black routers (X) use green arms (theme success). */
export const LIBERTY_BLACK = "#43BF43"
const EMPTY_DOT_NEUTRAL = "#555555"

export type BoardStoneKind = "black" | "white" | "empty" | "blocked"

export type CellHighlight = "our" | "opp"

type StoneColor = "X" | "O"

type ConnectionArms = {
  north: boolean
  east: boolean
  south: boolean
  west: boolean
}

function svgRoot(sizePx: number, key: string | undefined, children: ReactNode[]): ReactNode {
  const React = getReact()
  return React.createElement(
    "svg",
    {
      key,
      width: sizePx,
      height: sizePx,
      viewBox: `0 0 ${VIEW} ${VIEW}`,
      style: { display: "block", flexShrink: 0, overflow: "visible" },
    },
    ...children
  )
}

function inBounds(board: IpvgoBoard, x: number, y: number): boolean {
  const size = board.length
  return x >= 0 && y >= 0 && x < size && y < size
}

function cellAt(board: IpvgoBoard, x: number, y: number): string | null {
  if (!inBounds(board, x, y)) return null
  return board[x][y] ?? "."
}

/** Matches game findNeighbors: north = y+1, south = y-1. */
function neighborCells(board: IpvgoBoard, x: number, y: number) {
  return {
    north: cellAt(board, x, y + 1),
    east: cellAt(board, x + 1, y),
    south: cellAt(board, x, y - 1),
    west: cellAt(board, x - 1, y),
  }
}

/** Same rule as findAdjacentLibertiesAndAlliesForPoint in bitburner-src. */
function connectionArms(board: IpvgoBoard, x: number, y: number, player: StoneColor): ConnectionArms {
  const neighbors = neighborCells(board, x, y)
  const connects = (cell: string | null) => cell === "." || cell === player

  return {
    north: connects(neighbors.north),
    east: connects(neighbors.east),
    south: connects(neighbors.south),
    west: connects(neighbors.west),
  }
}

function libertyColor(player: StoneColor): string {
  return player === "O" ? LIBERTY_WHITE : LIBERTY_BLACK
}

function libertyArmLayers(
  board: IpvgoBoard,
  x: number,
  y: number,
  player: StoneColor,
  arms: ConnectionArms,
  color: string
): ReactNode[] {
  const React = getReact()
  const arm = 1.2
  const neighbors = neighborCells(board, x, y)
  const isAlly = (cell: string | null) => cell === player
  const layers: ReactNode[] = []

  const line = (x1: number, y1: number, x2: number, y2: number, key: string) =>
    React.createElement("line", {
      key,
      x1,
      y1,
      x2,
      y2,
      stroke: color,
      strokeWidth: arm,
      strokeLinecap: "butt",
    })

  // Ally links: one full line per edge (lower-x draws east; higher-y draws south).
  if (arms.north && !isAlly(neighbors.north)) {
    layers.push(line(CENTER, CENTER, CENTER, 0, "n-lib"))
  }

  if (arms.south && isAlly(neighbors.south)) {
    layers.push(line(CENTER, CENTER, CENTER, CENTER + VIEW, "s-ally"))
  } else if (arms.south) {
    layers.push(line(CENTER, CENTER, CENTER, VIEW, "s-lib"))
  }

  if (arms.east && isAlly(neighbors.east)) {
    layers.push(line(CENTER, CENTER, CENTER + VIEW, CENTER, "e-ally"))
  } else if (arms.east) {
    layers.push(line(CENTER, CENTER, VIEW, CENTER, "e-lib"))
  }

  if (arms.west && !isAlly(neighbors.west)) {
    layers.push(line(CENTER, CENTER, 0, CENTER, "w-lib"))
  }

  return layers
}

function emptyDotColor(board: IpvgoBoard, x: number, y: number): string {
  const neighbors = neighborCells(board, x, y)
  let hasWhite = false
  let hasBlack = false

  for (const cell of [neighbors.north, neighbors.east, neighbors.south, neighbors.west]) {
    if (cell === "O") hasWhite = true
    if (cell === "X") hasBlack = true
  }

  if (hasWhite && !hasBlack) return LIBERTY_WHITE
  if (hasBlack && !hasWhite) return LIBERTY_BLACK
  return EMPTY_DOT_NEUTRAL
}

function highlightCircle(highlight: CellHighlight): ReactNode {
  const React = getReact()
  const stroke = highlight === "our" ? "#ffffff" : "#bbbbbb"
  const strokeWidth = 1
  return React.createElement("circle", {
    cx: CENTER,
    cy: CENTER,
    r: STONE_R + 2.5,
    fill: "none",
    stroke,
    strokeWidth,
  })
}

function stoneSheenDot(): ReactNode {
  const React = getReact()
  return React.createElement("circle", {
    cx: CENTER - 2.8,
    cy: CENTER - 2.8,
    r: 1.5,
    fill: "rgba(255,255,255,0.12)",
  })
}

function whiteStoneSheenDot(): ReactNode {
  const React = getReact()
  return React.createElement("circle", {
    cx: CENTER - 2.8,
    cy: CENTER - 2.8,
    r: 1.5,
    fill: "#E8E8E8",
  })
}

function stoneLayers(kind: BoardStoneKind): ReactNode[] {
  const React = getReact()
  switch (kind) {
    case "black":
      return [
        React.createElement("circle", { cx: CENTER, cy: CENTER, r: STONE_R, fill: "#1c1c1c" }),
        stoneSheenDot(),
      ]
    case "white":
      return [
        React.createElement("circle", {
          cx: CENTER,
          cy: CENTER,
          r: STONE_R,
          fill: "#D1D1D1",
          stroke: "#555555",
          strokeWidth: 1.2,
        }),
        whiteStoneSheenDot(),
      ]
    case "blocked":
      return [
        React.createElement("rect", { x: 5, y: 5, width: 14, height: 14, fill: "#2a2a2a", rx: 1.5 }),
        React.createElement("line", { x1: 7, y1: 7, x2: 17, y2: 17, stroke: "#555", strokeWidth: 1.2 }),
        React.createElement("line", { x1: 17, y1: 7, x2: 7, y2: 17, stroke: "#555", strokeWidth: 1.2 }),
      ]
    case "empty":
      return []
  }
}

function emptyDotLayer(board: IpvgoBoard, x: number, y: number): ReactNode[] {
  const React = getReact()
  const color = emptyDotColor(board, x, y)
  const size = 2.4
  return [
    React.createElement("circle", {
      cx: CENTER,
      cy: CENTER,
      r: size / 2,
      fill: color,
    }),
  ]
}

export function buildCoordCell(label: string, key?: string): ReactNode {
  const React = getReact()
  const fontSize = label.length >= 2 ? 9 : 11
  return svgRoot(BOARD_CELL_PX, key, [
    React.createElement(
      "text",
      {
        x: CENTER,
        y: CENTER,
        textAnchor: "middle",
        dominantBaseline: "middle",
        fill: "#888888",
        fontSize,
        fontFamily: "monospace",
      },
      label
    ),
  ])
}

export function buildEmptyCell(key?: string): ReactNode {
  return svgRoot(BOARD_CELL_PX, key, [])
}

export function buildBoardCell(
  board: IpvgoBoard,
  x: number,
  y: number,
  highlight?: CellHighlight,
  key?: string
): ReactNode {
  const raw = board[x]?.[y] ?? "."
  const layers: ReactNode[] = []

  if (raw === "X" || raw === "O") {
    const arms = connectionArms(board, x, y, raw)
    layers.push(...libertyArmLayers(board, x, y, raw, arms, libertyColor(raw)))
  } else if (raw === ".") {
    layers.push(...emptyDotLayer(board, x, y))
  }

  const kind: BoardStoneKind =
    raw === "X" ? "black" : raw === "O" ? "white" : raw === "#" ? "blocked" : "empty"
  if (kind !== "empty") {
    layers.push(...stoneLayers(kind))
    if (highlight) {
      layers.push(highlightCircle(highlight))
    }
  }

  return svgRoot(BOARD_CELL_PX, key, layers)
}

/** @deprecated Use buildBoardCell */
export function buildStoneCell(kind: BoardStoneKind, highlight?: CellHighlight, key?: string): ReactNode {
  const layers: ReactNode[] = []
  if (kind !== "empty") {
    layers.push(...stoneLayers(kind))
    if (highlight) layers.push(highlightCircle(highlight))
  }
  return svgRoot(BOARD_CELL_PX, key, layers)
}

export function boardGridSizePx(size: number): { widthPx: number; heightPx: number } {
  const grid = (size + 1) * BOARD_CELL_PX
  return { widthPx: grid + 8, heightPx: grid + 8 }
}
