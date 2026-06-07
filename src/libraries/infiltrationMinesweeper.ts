export type MinesweeperPhase = "remember" | "mark"

export interface MinesweeperCellState {
  index: number
  hasMine: boolean
  marked: boolean
  isCursor: boolean
}

export interface MinesweeperDomState {
  phase: MinesweeperPhase
  cols: number
  rows: number
  /** All mine cell indices from the remember phase. */
  mineIndices: number[]
  /** Indices already marked with space during the mark phase. */
  markedIndices: number[]
  /** Indices still to visit and mark. */
  remainingIndices: number[]
  cursorIndex: number
}

const REMEMBER_TITLE = "remember all the mines"
const MARK_TITLE = "mark all the mines"

let rememberedMines: { cols: number; indices: number[] } | null = null

export function clearRememberedMines(): void {
  rememberedMines = null
}

export function isMinesweeperTask(taskTitle: string): boolean {
  const title = taskTitle.trim().toLowerCase()
  return title.includes(REMEMBER_TITLE) || title.includes(MARK_TITLE)
}

export function getMinesweeperPhase(taskTitle: string): MinesweeperPhase | null {
  const title = taskTitle.trim().toLowerCase()
  if (title.includes(REMEMBER_TITLE)) return "remember"
  if (title.includes(MARK_TITLE)) return "mark"
  return null
}

function gridDimensions(cellCount: number): { cols: number; rows: number } | null {
  const cols = Math.round(Math.sqrt(cellCount))
  if (cols <= 0 || cols * cols !== cellCount) return null
  return { cols, rows: cols }
}

function cellHasIcon(cell: Element, testId: string): boolean {
  return cell.querySelector(`[data-testid="${testId}"]`) !== null
}

function parseGridCells(gridRoot: Element): MinesweeperCellState[] {
  const cells = gridRoot.querySelectorAll(":scope > p")
  return Array.from(cells).map((cell, index) => ({
    index,
    hasMine: cellHasIcon(cell, "ReportIcon"),
    marked: cellHasIcon(cell, "FlagIcon"),
    isCursor: cellHasIcon(cell, "CloseIcon"),
  }))
}

function rememberMineLayout(cols: number, indices: number[]): void {
  rememberedMines = { cols, indices: [...indices].sort((a, b) => a - b) }
}

function getRememberedMineIndices(cols: number): number[] {
  if (rememberedMines?.cols === cols) {
    return rememberedMines.indices
  }
  return []
}

export function parseMinesweeperState(taskRoot: Element, taskTitle: string): MinesweeperDomState | null {
  const phase = getMinesweeperPhase(taskTitle)
  if (!phase) return null

  const gridRoot = taskRoot.querySelector("div[class*='MuiBox-root']")
  if (!gridRoot) return null

  const cells = parseGridCells(gridRoot)
  const dims = gridDimensions(cells.length)
  if (!dims) return null

  const markedIndices = cells.filter((cell) => cell.marked).map((cell) => cell.index)
  const cursorCell = cells.find((cell) => cell.isCursor)
  const cursorIndex = cursorCell?.index ?? 0

  let mineIndices: number[] = []
  if (phase === "remember") {
    mineIndices = cells.filter((cell) => cell.hasMine).map((cell) => cell.index)
    if (mineIndices.length > 0) {
      rememberMineLayout(dims.cols, mineIndices)
    }
  } else {
    mineIndices = getRememberedMineIndices(dims.cols)
    if (mineIndices.length === 0) {
      mineIndices = cells.filter((cell) => cell.hasMine).map((cell) => cell.index)
    }
  }

  const markedSet = new Set(markedIndices)
  const remainingIndices = mineIndices.filter((index) => !markedSet.has(index))

  return {
    phase,
    cols: dims.cols,
    rows: dims.rows,
    mineIndices,
    markedIndices,
    remainingIndices,
    cursorIndex,
  }
}

export function formatMinesweeperPhaseLabel(phase: MinesweeperPhase | null | undefined): string {
  switch (phase) {
    case "remember":
      return "Remember mines"
    case "mark":
      return "Mark mines"
    default:
      return "(waiting...)"
  }
}
