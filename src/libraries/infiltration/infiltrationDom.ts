import { createStandardContainer, FloatingWindow } from "../floatingWindow.js"
import { isEnterTheCodeTask, parseEnterTheCodeState } from "./infiltrationArrowCode.js"
import { isSaySomethingNiceTask } from "./infiltrationBribeWords.js"
import {
  formatSlashStatusLabel,
  isSlashTaskRoot,
  isSlashTaskTitle,
  parseSlashStatus,
  readSlashInstructions,
  SLASH_TASK_TITLE,
  type SlashPhase,
} from "./infiltrationSlash.js"
import {
  isWireCutRuleText,
  isWireCuttingTask,
  isWireCuttingTaskRoot,
  parseWireCuttingState,
} from "./infiltrationWireCutting.js"
import {
  formatMinesweeperPhaseLabel,
  isMinesweeperTask,
  parseMinesweeperState,
  type MinesweeperPhase,
} from "./infiltrationMinesweeper.js"
import {
  formatInfiltrationRunViewLines,
  type InfiltrationRunView,
} from "./infiltrationRunStats.js"

export interface InfiltrationDomState {
  active: boolean
  levelText: string
  levelCurrent: number | null
  levelMax: number | null
  progressPercent: number | null
  taskTitle: string
  assignmentLines: string[]
  /** True when assignment text uses scaleX(-1) mirroring in the UI. */
  assignmentMirrored: boolean
  /** Match the symbols: target sequence from h5 spans. */
  symbolTargets?: string[]
  /** Match the symbols: 5x5 grid cell values in row-major order. */
  symbolGrid?: string[]
  /** Match the symbols: index of the highlighted grid cell. */
  symbolCursorIndex?: number
  /** Enter the Code: bright arrow to press (dimmed ones are already entered). */
  codePressArrow?: string
  /** Enter the Code: arrows still to type (one, or full burst with Trickery of Hermes). */
  codePendingArrows?: string[]
  /** Enter the Code: whole sequence visible (Trickery of Hermes). */
  codeFullSequence?: boolean
  /** Slash the sentinel: current sentinel phase from status h4. */
  slashStatus?: SlashPhase
  /** Wire cutting: 1-based wire numbers still to cut. */
  wireCutRemaining?: number[]
  /** Minesweeper: remember or mark phase. */
  minesPhase?: MinesweeperPhase
  mineGridCols?: number
  mineIndices?: number[]
  mineRemaining?: number[]
  mineCursorIndex?: number
}

export interface InfiltrationDomWindow {
  window: FloatingWindow
  container: HTMLElement
}

const CANCEL_LABEL = "Cancel Infiltration"

function findCancelButton(): HTMLButtonElement | null {
  const buttons = document.querySelectorAll("button")
  for (const button of Array.from(buttons)) {
    const label = button.textContent?.replace(/\s+/g, " ").trim() ?? ""
    if (label.startsWith(CANCEL_LABEL)) {
      return button
    }
  }
  return null
}

function parseLevel(levelText: string): { current: number | null; max: number | null } {
  const match = levelText.match(/Level\s+(\d+)\s*\/\s*(\d+)/i)
  if (!match) {
    return { current: null, max: null }
  }
  return { current: Number(match[1]), max: Number(match[2]) }
}

function readProgressPercent(progressRoot: Element | null | undefined): number | null {
  if (!progressRoot) return null

  const progressbar = progressRoot.querySelector('[role="progressbar"]')
  if (progressbar instanceof HTMLElement) {
    const valueNow = progressbar.getAttribute("aria-valuenow")
    const valueMax = progressbar.getAttribute("aria-valuemax")
    if (valueNow !== null && valueMax !== null) {
      const now = Number(valueNow)
      const max = Number(valueMax)
      if (Number.isFinite(now) && Number.isFinite(max) && max > 0) {
        return (now / max) * 100
      }
    }
  }

  const bar = progressRoot.querySelector('[class*="MuiLinearProgress-bar"]') as HTMLElement | null
  if (bar) {
    const transform = bar.style.transform
    const translateMatch = transform.match(/translateX\((-?\d+(?:\.\d+)?)%\)/)
    if (translateMatch) {
      const translate = Number(translateMatch[1])
      if (Number.isFinite(translate)) {
        return Math.max(0, Math.min(100, 100 + translate))
      }
    }
  }

  return null
}

function normalizeSymbolText(text: string): string {
  return text.replace(/\u00a0/g, " ").trim().toUpperCase()
}

function readCheatCodeTask(
  taskRoot: Element
): Pick<
  InfiltrationDomState,
  "taskTitle" | "assignmentLines" | "assignmentMirrored" | "codePressArrow" | "codePendingArrows" | "codeFullSequence"
> {
  const taskTitle = taskRoot.querySelector("h4")?.textContent?.trim() ?? ""
  const { revealed, pressArrow, pendingArrows, hasFullSequence } = parseEnterTheCodeState(taskRoot)

  return {
    taskTitle,
    assignmentLines: revealed,
    assignmentMirrored: false,
    codePressArrow: pressArrow ?? undefined,
    codePendingArrows: pendingArrows.length > 0 ? pendingArrows : undefined,
    codeFullSequence: hasFullSequence || undefined,
  }
}

function isBackwardTaskTitle(taskTitle: string): boolean {
  const title = taskTitle.trim()
  return title === "Type it backward" || title === "Type it"
}

function readBackwardTask(
  taskRoot: Element
): Pick<InfiltrationDomState, "taskTitle" | "assignmentLines" | "assignmentMirrored"> {
  const taskTitle = taskRoot.querySelector("h4")?.textContent?.trim() ?? ""

  for (const paragraph of Array.from(taskRoot.querySelectorAll("p"))) {
    if (!(paragraph instanceof HTMLElement)) continue
    if (!paragraph.style.transform.includes("scaleX(-1)")) continue

    const text = paragraph.textContent?.trim() ?? ""
    return {
      taskTitle,
      assignmentLines: text ? [text] : [],
      assignmentMirrored: true,
    }
  }

  return { taskTitle, assignmentLines: [], assignmentMirrored: false }
}

function readBribeTask(
  taskRoot: Element
): Pick<InfiltrationDomState, "taskTitle" | "assignmentLines" | "assignmentMirrored"> {
  const taskTitle = taskRoot.querySelector("h4")?.textContent?.trim() ?? ""
  const arrowLabels = new Set(["↑", "↓", "←", "→"])

  let currentWord = ""
  for (const h5 of Array.from(taskRoot.querySelectorAll("h5"))) {
    const text = h5.textContent?.trim() ?? ""
    if (!text || arrowLabels.has(text)) continue
    currentWord = text.toLowerCase()
    break
  }

  return {
    taskTitle,
    assignmentLines: currentWord ? [currentWord] : [],
    assignmentMirrored: false,
  }
}

function readMinesweeperTask(
  taskRoot: Element
): Pick<
  InfiltrationDomState,
  "taskTitle" | "assignmentLines" | "assignmentMirrored" | "minesPhase" | "mineGridCols" | "mineIndices" | "mineRemaining" | "mineCursorIndex"
> {
  const taskTitle = taskRoot.querySelector("h4")?.textContent?.trim() ?? ""
  const parsed = parseMinesweeperState(taskRoot, taskTitle)

  return {
    taskTitle,
    assignmentLines: [],
    assignmentMirrored: false,
    minesPhase: parsed?.phase,
    mineGridCols: parsed?.cols,
    mineIndices: parsed?.mineIndices,
    mineRemaining: parsed?.remainingIndices,
    mineCursorIndex: parsed?.cursorIndex,
  }
}

function readWireCuttingTask(
  taskRoot: Element
): Pick<InfiltrationDomState, "taskTitle" | "assignmentLines" | "assignmentMirrored" | "wireCutRemaining"> {
  const taskTitle = taskRoot.querySelector("h4")?.textContent?.trim() ?? ""
  const parsed = parseWireCuttingState(taskRoot)
  const assignmentLines: string[] = []

  for (const paragraph of Array.from(taskRoot.querySelectorAll("p"))) {
    const text = paragraph.textContent?.trim() ?? ""
    if (isWireCutRuleText(text)) {
      assignmentLines.push(text)
    }
  }

  return {
    taskTitle,
    assignmentLines,
    assignmentMirrored: false,
    wireCutRemaining: parsed?.remainingWireNumbers,
  }
}

function readSlashTask(
  taskRoot: Element
): Pick<InfiltrationDomState, "taskTitle" | "assignmentLines" | "assignmentMirrored" | "slashStatus"> {
  return {
    taskTitle: SLASH_TASK_TITLE,
    assignmentLines: readSlashInstructions(taskRoot),
    assignmentMirrored: false,
    slashStatus: parseSlashStatus(taskRoot) ?? undefined,
  }
}

function readMatchSymbolsTask(
  taskRoot: Element
): Pick<
  InfiltrationDomState,
  "taskTitle" | "assignmentLines" | "assignmentMirrored" | "symbolTargets" | "symbolGrid" | "symbolCursorIndex"
> {
  const taskTitle = taskRoot.querySelector("h4")?.textContent?.trim() ?? "Match the symbols!"
  const symbolTargets: string[] = []

  for (const span of Array.from(taskRoot.querySelectorAll("h5 span"))) {
    const text = normalizeSymbolText(span.textContent ?? "")
    if (/^[0-9A-F]{2}$/.test(text)) {
      symbolTargets.push(text)
    }
  }

  if (symbolTargets.length === 0) {
    const h5 = taskRoot.querySelector("h5")
    if (h5) {
      const raw = (h5.textContent ?? "").replace(/^Targets:\s*/i, "")
      for (const part of raw.split(/\s+/)) {
        const text = normalizeSymbolText(part)
        if (/^[0-9A-F]{2}$/.test(text)) {
          symbolTargets.push(text)
        }
      }
    }
  }

  const gridRoot = taskRoot.querySelector("div[class*='MuiBox-root']")
  const symbolGrid: string[] = []
  let symbolCursorIndex = 0

  if (gridRoot) {
    const cells = gridRoot.querySelectorAll(":scope > p")
    const classNames: string[] = []

    cells.forEach((cell, index) => {
      symbolGrid.push(normalizeSymbolText(cell.textContent ?? ""))
      classNames.push(cell.className)
    })

    if (classNames.length > 0) {
      const classCounts = new Map<string, number>()
      for (const className of classNames) {
        classCounts.set(className, (classCounts.get(className) ?? 0) + 1)
      }

      let modeClass = classNames[0]
      let modeCount = 0
      for (const [className, count] of classCounts) {
        if (count > modeCount) {
          modeClass = className
          modeCount = count
        }
      }

      const highlightedIndex = classNames.findIndex((className) => className !== modeClass)
      symbolCursorIndex = highlightedIndex >= 0 ? highlightedIndex : 0
    }
  }

  return {
    taskTitle,
    assignmentLines: symbolTargets,
    assignmentMirrored: false,
    symbolTargets,
    symbolGrid,
    symbolCursorIndex,
  }
}

function readTaskArea(taskRoot: Element | null | undefined): Pick<
  InfiltrationDomState,
  "taskTitle" | "assignmentLines" | "assignmentMirrored" | "symbolTargets" | "symbolGrid" | "symbolCursorIndex"
> {
  if (!taskRoot) {
    return { taskTitle: "", assignmentLines: [], assignmentMirrored: false }
  }

  const taskTitle = taskRoot.querySelector("h4")?.textContent?.trim() ?? ""
  if (taskTitle === "Match the symbols!") {
    return readMatchSymbolsTask(taskRoot)
  }

  if (isMinesweeperTask(taskTitle)) {
    return readMinesweeperTask(taskRoot)
  }

  if (isWireCuttingTaskRoot(taskRoot)) {
    return readWireCuttingTask(taskRoot)
  }

  if (isSlashTaskRoot(taskRoot)) {
    return readSlashTask(taskRoot)
  }

  if (isSaySomethingNiceTask(taskTitle)) {
    return readBribeTask(taskRoot)
  }
  if (isEnterTheCodeTask(taskTitle)) {
    return readCheatCodeTask(taskRoot)
  }

  if (isBackwardTaskTitle(taskTitle)) {
    return readBackwardTask(taskRoot)
  }

  const assignmentLines: string[] = []
  let assignmentMirrored = false

  for (const paragraph of Array.from(taskRoot.querySelectorAll("p"))) {
    const text = paragraph.textContent?.trim() ?? ""
    if (!text || text === "|") continue

    assignmentLines.push(text)
    if (paragraph instanceof HTMLElement && paragraph.style.transform.includes("scaleX(-1)")) {
      assignmentMirrored = true
    }
  }

  return { taskTitle, assignmentLines, assignmentMirrored }
}

/** Read infiltration UI state from the live DOM. Returns inactive state when not infiltrating. */
export function readInfiltrationDomState(): InfiltrationDomState {
  const cancelButton = findCancelButton()
  if (!cancelButton) {
    return {
      active: false,
      levelText: "",
      levelCurrent: null,
      levelMax: null,
      progressPercent: null,
      taskTitle: "",
      assignmentLines: [],
      assignmentMirrored: false,
    }
  }

  const levelText = cancelButton.nextElementSibling?.textContent?.trim() ?? ""
  const { current: levelCurrent, max: levelMax } = parseLevel(levelText)
  const headerRow = cancelButton.parentElement
  const root = headerRow?.parentElement

  let progressEl: Element | null = null
  let taskEl: Element | null = null

  if (headerRow && root) {
    const siblings = Array.from(root.children)
    const headerIndex = siblings.indexOf(headerRow)
    if (headerIndex >= 0) {
      progressEl = siblings[headerIndex + 1] ?? null
      taskEl = siblings[headerIndex + 2] ?? null
    }
  }

  const progressPercent = readProgressPercent(progressEl)
  const task = readTaskArea(taskEl)

  return {
    active: true,
    levelText,
    levelCurrent,
    levelMax,
    progressPercent,
    ...task,
  }
}

function formatMinigameSection(
  state: InfiltrationDomState,
  extras?: InfiltrationDomViewExtras
): string[] {
  const lines: string[] = ["--- Minigame ---", "Status: Active", ""]

  if (state.levelText) {
    lines.push(`Level: ${state.levelText}`)
  } else if (state.levelCurrent !== null && state.levelMax !== null) {
    lines.push(`Level: ${state.levelCurrent} / ${state.levelMax}`)
  }

  if (state.progressPercent !== null) {
    lines.push(`Progress: ${state.progressPercent.toFixed(0)}%`)
  }

  lines.push("")

  if (state.taskTitle) {
    lines.push(`Task: ${state.taskTitle}`)
  }

  if (isEnterTheCodeTask(state.taskTitle)) {
    lines.push("Code (revealed):")
    if (state.assignmentLines.length > 0) {
      lines.push(`  ${state.assignmentLines.join(" ")}`)
    } else {
      lines.push("  (waiting...)")
    }
    if (state.codeFullSequence && state.codePendingArrows?.length) {
      lines.push(`  Burst: ${state.codePendingArrows.join(" ")} (${state.codePendingArrows.length} keys)`)
    } else if (state.codePressArrow) {
      lines.push(`  Next: ${state.codePressArrow}`)
    }
  } else if (isSaySomethingNiceTask(state.taskTitle)) {
    lines.push("Current word:")
    if (state.assignmentLines.length > 0) {
      lines.push(`  ${state.assignmentLines[0]}`)
    } else {
      lines.push("  (waiting...)")
    }
  } else if (isSlashTaskTitle(state.taskTitle)) {
    lines.push(`Sentinel: ${formatSlashStatusLabel(state.slashStatus)}`)
  } else if (isWireCuttingTask(state.taskTitle) || isWireCuttingTaskRootFromState(state)) {
    lines.push("Rules:")
    for (const line of state.assignmentLines) {
      lines.push(`  ${line}`)
    }
    if (state.wireCutRemaining && state.wireCutRemaining.length > 0) {
      lines.push("")
      lines.push(`Cut: ${state.wireCutRemaining.join(", ")}`)
    }
  } else if (isMinesweeperTask(state.taskTitle)) {
    lines.push(`Phase: ${formatMinesweeperPhaseLabel(state.minesPhase)}`)
    if (state.mineGridCols) {
      lines.push(`Grid: ${state.mineGridCols}x${state.mineGridCols}`)
    }
    if (state.minesPhase === "remember" && (state.mineIndices?.length ?? 0) > 0) {
      lines.push(`Mines seen: ${state.mineIndices!.length}`)
    }
    if (state.minesPhase === "mark") {
      if ((state.mineRemaining?.length ?? 0) > 0) {
        lines.push(`Mark: ${state.mineRemaining!.length} remaining`)
      }
      if (state.mineCursorIndex !== undefined) {
        lines.push(`Cursor: ${state.mineCursorIndex}`)
      }
    }
  } else if (state.assignmentLines.length > 0) {
    if (state.taskTitle === "Match the symbols!") {
      lines.push("Targets:")
      for (const target of state.assignmentLines) {
        lines.push(`  ${target}`)
      }
      if (state.symbolGrid && state.symbolGrid.length > 0) {
        lines.push("")
        lines.push(`Grid: ${state.symbolGrid.length} cells, cursor ${state.symbolCursorIndex ?? 0}`)
      }
    } else {
      lines.push("Assignment:")
      for (const line of state.assignmentLines) {
        lines.push(`  ${line}`)
      }
      if (state.assignmentMirrored) {
        lines.push("  (mirrored in UI)")
      }
    }
  } else {
    lines.push("Assignment: (waiting for task...)")
  }

  if (extras?.solverPreview) {
    lines.push("")
    lines.push(extras.solverPreview)
  }

  if (extras?.sendStatus) {
    const { sentKeys, totalKeys, handlerReady, handlerMode, handlerDetail, sendState } = extras.sendStatus
    lines.push("")
    lines.push(`Keys sent: ${sentKeys.length}/${totalKeys}`)
    if (sentKeys.length > 0 && extras?.formatSentKeys) {
      lines.push(`Sent: ${extras.formatSentKeys(sentKeys)}`)
    } else {
      lines.push("Sent: (none yet)")
    }
    lines.push(`Handler: ${handlerReady ? handlerMode : (handlerDetail ?? "missing")}`)
    lines.push(`Send: ${sendState}`)
  }

  return lines
}

function formatStateText(state: InfiltrationDomState, extras?: InfiltrationDomViewExtras): string {
  const lines: string[] = []

  if (extras?.trainingViewLines?.length) {
    lines.push(...extras.trainingViewLines)
  }

  if (extras?.runViewLines?.length) {
    if (lines.length > 0) lines.push("")
    lines.push(...extras.runViewLines)
  }

  const showMinigame = extras?.showMinigameInfo === true
  if (showMinigame && state.active) {
    if (lines.length > 0) lines.push("")
    lines.push(...formatMinigameSection(state, extras))
  }

  if (lines.length === 0) {
    return showMinigame && !state.active
      ? "Waiting for infiltration...\n"
      : "Waiting for infiltration run...\n"
  }

  return lines.join("\n")
}

export interface InfiltrationSendStatus {
  sentKeys: string[]
  totalKeys: number
  handlerReady: boolean
  handlerMode: string
  handlerDetail?: string
  sendState: string
}

export interface InfiltrationDomViewExtras {
  trainingViewLines?: string[]
  runViewLines?: string[]
  showMinigameInfo?: boolean
  solverPreview?: string
  sendStatus?: InfiltrationSendStatus
  formatSentKeys?: (keys: string[]) => string
}

export type { InfiltrationRunView }

export function createInfiltrationDomWindow(
  primaryColor: string,
  position?: { x: number; y: number },
  isCollapsed?: boolean,
  showMinigameInfo = false
): InfiltrationDomWindow {
  const container = createStandardContainer(primaryColor)
  container.style.maxHeight = showMinigameInfo ? "520px" : "460px"
  container.textContent = formatStateText(readInfiltrationDomState(), { showMinigameInfo })

  const window = new FloatingWindow({
    title: "Infiltration",
    content: container,
    id: "infiltration-dom-window",
    x: position?.x ?? 1050,
    y: position?.y ?? 50,
    width: 420,
    height: showMinigameInfo ? 620 : 520,
  })

  if (isCollapsed) {
    window.toggle()
  }

  return { window, container }
}

export function updateInfiltrationDomView(container: HTMLElement, extras?: InfiltrationDomViewExtras): void {
  container.textContent = formatStateText(readInfiltrationDomState(), extras)
}

/** Stable key for the current minigame phase (level + task title). */
export function getMinigamePhaseKey(state: InfiltrationDomState): string {
  if (!state.active || !state.taskTitle) return ""

  const title = state.taskTitle.trim()
  if (title === "Get Ready!") return ""

  const base = `${state.levelText}|${title}`
  if (isSaySomethingNiceTask(title)) {
    const word = state.assignmentLines[0]?.trim().toLowerCase() ?? ""
    if (!word) return ""
    return `${base}|${word}`
  }

  if (isEnterTheCodeTask(title)) {
    if (state.codeFullSequence && state.assignmentLines.length > 0) {
      return `${base}|code|${state.assignmentLines.join("")}`
    }
    if (!state.codePressArrow) return ""
    return `${base}|${state.assignmentLines.length}|${state.codePressArrow}`
  }

  if (isSlashTaskTitle(title)) {
    if (!state.slashStatus) return ""
    return `${base}|${state.slashStatus}`
  }

  if (isWireCuttingTask(title) || isWireCuttingTaskRootFromState(state)) {
    if (!state.wireCutRemaining?.length) return ""
    return `${base}|${state.wireCutRemaining.join(",")}`
  }

  if (isMinesweeperTask(title)) {
    if (state.minesPhase !== "mark") return ""
    if (!state.mineRemaining?.length) return ""
    return `${base}|mark|${state.mineIndices?.join(",") ?? ""}`
  }

  return base
}

/** True when the DOM has enough data to compute a solution. */
export function canSolveInfiltrationTask(state: InfiltrationDomState): boolean {
  const title = state.taskTitle.trim()
  if (!title || title === "Get Ready!") return false

  if (title === "Match the symbols!") {
    return (state.symbolTargets?.length ?? 0) > 0 && (state.symbolGrid?.length ?? 0) > 0
  }

  if (isEnterTheCodeTask(title)) {
    return (state.codePendingArrows?.length ?? 0) > 0 || !!state.codePressArrow
  }

  if (isSlashTaskTitle(title)) {
    return state.slashStatus === "distracted"
  }

  if (isWireCuttingTask(title) || isWireCuttingTaskRootFromState(state)) {
    return (state.wireCutRemaining?.length ?? 0) > 0
  }

  if (isMinesweeperTask(title)) {
    return (
      state.minesPhase === "mark" &&
      (state.mineRemaining?.length ?? 0) > 0 &&
      (state.mineIndices?.length ?? 0) > 0
    )
  }

  return state.assignmentLines.length > 0
}

function isWireCuttingTaskRootFromState(state: InfiltrationDomState): boolean {
  if (isWireCuttingTask(state.taskTitle)) return true
  return state.assignmentLines.some((line) => isWireCutRuleText(line))
}

/** Stable id for the current minigame (ignores cursor / in-progress typing). */
export function getMinigameIdentityKey(state: InfiltrationDomState): string {
  if (!state.active || !state.taskTitle) return ""

  const title = state.taskTitle.trim()
  if (title === "Get Ready!") return ""

  if (title === "Match the symbols!") {
    if (!state.symbolTargets?.length || !state.symbolGrid?.length) return ""
    return `${state.levelText}|${title}|${state.symbolTargets.join(",")}|${state.symbolGrid.join(",")}`
  }

  if (state.assignmentLines.length === 0) return ""

  return `${state.levelText}|${title}|${state.assignmentLines.join("|")}`
}

/** @deprecated Use getMinigameIdentityKey */
export function getInfiltrationTaskKey(state: InfiltrationDomState): string {
  return getMinigameIdentityKey(state)
}
