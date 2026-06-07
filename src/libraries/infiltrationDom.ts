import { createStandardContainer, FloatingWindow } from "./floatingWindow.js"

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
    if (text) symbolTargets.push(text)
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

function formatStateText(state: InfiltrationDomState, solverPreview?: string): string {
  if (!state.active) {
    return "Not infiltrating.\n\nRun this script, then start infiltration.\nIf keys fail, cancel and restart the run\n(after this script is already running).\n"
  }

  const lines: string[] = ["Status: Active", ""]

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

  if (state.assignmentLines.length > 0) {
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

  if (solverPreview) {
    lines.push("")
    lines.push(solverPreview)
  }

  return lines.join("\n")
}

export function createInfiltrationDomWindow(
  primaryColor: string,
  position?: { x: number; y: number },
  isCollapsed?: boolean
): InfiltrationDomWindow {
  const container = createStandardContainer(primaryColor)
  container.textContent = formatStateText(readInfiltrationDomState())

  const window = new FloatingWindow({
    title: "Infiltration",
    content: container,
    id: "infiltration-dom-window",
    x: position?.x ?? 1050,
    y: position?.y ?? 50,
    width: 420,
    height: 280,
  })

  if (isCollapsed) {
    window.toggle()
  }

  return { window, container }
}

export function updateInfiltrationDomView(container: HTMLElement, solverPreview?: string): void {
  container.textContent = formatStateText(readInfiltrationDomState(), solverPreview)
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
