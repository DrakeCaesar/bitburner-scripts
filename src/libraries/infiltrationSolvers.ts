import type { InfiltrationDomState } from "./infiltrationDom.js"
import { arrowSymbolToKey, isEnterTheCodeTask } from "./infiltrationArrowCode.js"
import { isPositiveBribeWord, isSaySomethingNiceTask } from "./infiltrationBribeWords.js"
import { isSlashTaskTitle } from "./infiltrationSlash.js"

const BRACKET_CLOSERS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "<": ">",
}

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

    case "Enter the Code!":
      return solveEnterTheCode(state.codePressArrow ?? "")

    case "Slash the sentinel":
      return solveSlashTheSentinel(state)

    default:
      if (isSaySomethingNiceTask(taskTitle)) {
        return solveSaySomethingNice(state.assignmentLines[0] ?? "")
      }
      if (isEnterTheCodeTask(taskTitle)) {
        return solveEnterTheCode(state.codePressArrow ?? "")
      }
      if (isSlashTaskTitle(taskTitle)) {
        return solveSlashTheSentinel(state)
      }
      return null
  }
}

/** Press space when the sentinel is distracted. */
function solveSlashTheSentinel(state: InfiltrationDomState): string[] | null {
  if (state.slashStatus !== "distracted") return null
  return [" "]
}

/** Press the current bright arrow. One key per solve pass. */
function solveEnterTheCode(pressArrow: string): string[] | null {
  const key = arrowSymbolToKey(pressArrow.trim())
  if (!key) return null
  return [key]
}

/** Scroll up until a positive word is shown, then confirm with space. One key per solve pass. */
function solveSaySomethingNice(currentWord: string): string[] | null {
  const word = currentWord.trim().toLowerCase()
  if (!word) return null
  if (isPositiveBribeWord(word)) return [" "]
  return ["ArrowUp"]
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

function symbolGridCols(cellCount: number): number | null {
  const cols = Math.round(Math.sqrt(cellCount))
  if (cols <= 0 || cols * cols !== cellCount) return null
  return cols
}

/** Move cursor to each target cell in order, then confirm with space. */
function solveMatchTheSymbols(state: InfiltrationDomState): string[] | null {
  const { symbolTargets, symbolGrid, symbolCursorIndex } = state
  if (!symbolTargets?.length || !symbolGrid?.length) return null

  const cols = symbolGridCols(symbolGrid.length)
  if (!cols) return null

  const keys: string[] = []
  let pos = symbolCursorIndex ?? 0

  for (const target of symbolTargets) {
    const targetIndex = symbolGrid.findIndex((cell) => cell === target)
    if (targetIndex < 0) continue

    keys.push(...navigationKeys(pos, targetIndex, cols))
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

function formatKeySequence(taskTitle: string, keys: string[]): string {
  if (taskTitle === "Match the symbols!" || taskTitle.includes("Match the symbols")) {
    return keys.map(abbreviateKey).join("")
  }
  if (isSaySomethingNiceTask(taskTitle)) {
    return keys.map(abbreviateKey).join("")
  }
  if (isEnterTheCodeTask(taskTitle)) {
    return keys.map(abbreviateKey).join("")
  }
  if (isSlashTaskTitle(taskTitle)) {
    return keys.map(abbreviateKey).join("")
  }
  return keys.join("")
}

export function formatSentKeySequence(taskTitle: string, keys: string[]): string {
  return formatKeySequence(taskTitle, keys)
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
    return `Solver: ${formatKeySequence(taskTitle, keys)} (${keys.length} keys)`
  }

  if (isSaySomethingNiceTask(taskTitle)) {
    const action = keys[0] === " " ? "confirm" : "scroll up"
    return `Solver: ${action} (${formatKeySequence(taskTitle, keys)})`
  }

  if (isEnterTheCodeTask(taskTitle)) {
    return `Solver: ${formatKeySequence(taskTitle, keys)}`
  }

  if (isSlashTaskTitle(taskTitle)) {
    return `Solver: attack (${formatKeySequence(taskTitle, keys)})`
  }

  return `Solver: ${formatKeySequence(taskTitle, keys)}`
}
