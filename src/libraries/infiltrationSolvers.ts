import type { InfiltrationDomState } from "./infiltrationDom.js"

const BRACKET_CLOSERS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "<": ">",
}

const SYMBOL_GRID_COLS = 5

/** Return keypress sequence for the current minigame, or null if unsupported. */
export function solveInfiltrationTask(taskTitle: string, state: InfiltrationDomState): string[] | null {
  const assignment = state.assignmentLines.join("")

  switch (taskTitle) {
    case "Close the brackets":
      return solveCloseTheBrackets(assignment)

    case "Match the symbols!":
      return solveMatchTheSymbols(state)

    case "Type it backward":
      return solveTypeItBackward(assignment)

    default:
      return null
  }
}

/** Enter matching closers for each opener, right to left. */
function solveCloseTheBrackets(openers: string): string[] {
  const keys: string[] = []

  for (let i = openers.length - 1; i >= 0; i--) {
    const closer = BRACKET_CLOSERS[openers[i]]
    if (closer) {
      keys.push(closer)
    }
  }

  return keys
}

/** Type assignment characters in reverse order (DOM text is mirrored in the UI). */
function solveTypeItBackward(text: string): string[] | null {
  if (!text) return null
  return [...text].reverse()
}

/** Move cursor to each target cell in order, then confirm with space. */
function solveMatchTheSymbols(state: InfiltrationDomState): string[] | null {
  const { symbolTargets, symbolGrid, symbolCursorIndex } = state
  if (!symbolTargets?.length || !symbolGrid?.length) return null

  const keys: string[] = []
  let pos = symbolCursorIndex ?? 0

  for (const target of symbolTargets) {
    const targetIndex = symbolGrid.findIndex((cell) => cell === target)
    if (targetIndex < 0) continue

    keys.push(...navigationKeys(pos, targetIndex, SYMBOL_GRID_COLS))
    keys.push(" ")
    pos = targetIndex
  }

  return keys.length > 0 ? keys : null
}

function navigationKeys(fromIndex: number, toIndex: number, cols: number): string[] {
  const fromRow = Math.floor(fromIndex / cols)
  const fromCol = fromIndex % cols
  const toRow = Math.floor(toIndex / cols)
  const toCol = toIndex % cols
  const keys: string[] = []

  const rowDelta = toRow - fromRow
  const colDelta = toCol - fromCol

  for (let i = 0; i < Math.abs(rowDelta); i++) {
    keys.push(rowDelta > 0 ? "ArrowDown" : "ArrowUp")
  }
  for (let i = 0; i < Math.abs(colDelta); i++) {
    keys.push(colDelta > 0 ? "ArrowRight" : "ArrowLeft")
  }

  return keys
}

function abbreviateKey(key: string): string {
  switch (key) {
    case "ArrowUp":
      return "^"
    case "ArrowDown":
      return "v"
    case "ArrowLeft":
      return "<"
    case "ArrowRight":
      return ">"
    case " ":
      return "_"
    default:
      return key
  }
}

/** Human-readable preview of the planned key sequence. */
export function formatSolverPreview(taskTitle: string, keys: string[] | null): string {
  if (keys === null) {
    return "Solver: (unsupported task)"
  }
  if (keys.length === 0) {
    return "Solver: (no keys)"
  }

  if (taskTitle === "Match the symbols!") {
    return `Solver: ${keys.map(abbreviateKey).join("")} (${keys.length} keys)`
  }

  return `Solver: ${keys.join("")}`
}
