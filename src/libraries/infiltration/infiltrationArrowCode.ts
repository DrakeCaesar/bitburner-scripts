const ARROW_SYMBOLS = new Set(["↑", "↓", "←", "→"])

export interface EnterTheCodeDomState {
  /** Arrow symbols shown so far (stops at first "?" without Trickery of Hermes). */
  revealed: string[]
  /** Arrow to press now: bright span, or last symbol before "?". */
  pressArrow: string | null
  /** Arrows still to type (one key, or full remainder when sequence is visible). */
  pendingArrows: string[]
  /** True when Trickery of Hermes shows the whole code (no "?" placeholders). */
  hasFullSequence: boolean
}

export function isArrowSymbol(text: string): boolean {
  return ARROW_SYMBOLS.has(text.trim())
}

export function isEnterTheCodeTask(taskTitle: string): boolean {
  return taskTitle.trim().toLowerCase().includes("enter the code")
}

/** Map displayed arrow symbol to KeyboardEvent key name. */
export function arrowSymbolToKey(symbol: string): string | null {
  switch (symbol.trim()) {
    case "↑":
      return "ArrowUp"
    case "↓":
      return "ArrowDown"
    case "←":
      return "ArrowLeft"
    case "→":
      return "ArrowRight"
    default:
      return null
  }
}

function isDimmedSpan(span: HTMLElement): boolean {
  const opacity = parseFloat(span.style.opacity)
  return Number.isFinite(opacity) && opacity < 1
}

function findCodeContainer(taskRoot: Element): Element | null {
  const grid = taskRoot.querySelector("[style*='grid-template-columns']")
  if (grid?.querySelector("span")) return grid

  for (const h4 of Array.from(taskRoot.querySelectorAll("h4"))) {
    if (!h4.querySelector("span")) continue
    const label = h4.textContent?.replace(/\s+/g, " ").trim() ?? ""
    if (isEnterTheCodeTask(label)) continue
    return h4
  }

  const h5 = taskRoot.querySelector("h5")
  if (h5?.querySelector("span")) return h5

  return null
}

function parseFromSpans(container: Element): EnterTheCodeDomState {
  const revealed: string[] = []
  const pendingArrows: string[] = []
  let pressArrow: string | null = null
  let hasQuestionMark = false
  let atCurrentArrow = false

  for (const span of Array.from(container.querySelectorAll("span"))) {
    const text = span.textContent?.trim() ?? ""
    if (text === "?") {
      hasQuestionMark = true
      break
    }
    if (!isArrowSymbol(text)) continue

    revealed.push(text)

    const isCurrent = span instanceof HTMLElement && !isDimmedSpan(span)
    if (isCurrent) {
      atCurrentArrow = true
      pressArrow = text
      pendingArrows.push(text)
    } else if (atCurrentArrow) {
      pendingArrows.push(text)
    }
  }

  if (pressArrow === null && revealed.length > 0) {
    pressArrow = revealed[revealed.length - 1]
  }

  const hasFullSequence = !hasQuestionMark && revealed.length > 1
  const arrowsToType = hasFullSequence ? pendingArrows : pressArrow ? [pressArrow] : []

  return { revealed, pressArrow, pendingArrows: arrowsToType, hasFullSequence }
}

/** Fallback when span structure differs: read chars until "?". */
function parseFromText(container: Element): EnterTheCodeDomState {
  const revealed: string[] = []
  let pressArrow: string | null = null
  let hasQuestionMark = false

  for (const char of container.textContent ?? "") {
    if (char === "?") {
      hasQuestionMark = true
      break
    }
    if (isArrowSymbol(char)) {
      revealed.push(char)
      pressArrow = char
    }
  }

  const pendingArrows = pressArrow ? [pressArrow] : []
  return {
    revealed,
    pressArrow,
    pendingArrows,
    hasFullSequence: false,
  }
}

const EMPTY_ENTER_THE_CODE_STATE: EnterTheCodeDomState = {
  revealed: [],
  pressArrow: null,
  pendingArrows: [],
  hasFullSequence: false,
}

export function arrowsToKeyNames(arrows: readonly string[]): string[] | null {
  const keys: string[] = []
  for (const arrow of arrows) {
    const key = arrowSymbolToKey(arrow)
    if (!key) return null
    keys.push(key)
  }
  return keys
}

export function parseEnterTheCodeState(taskRoot: Element): EnterTheCodeDomState {
  const container = findCodeContainer(taskRoot)
  if (!container) return EMPTY_ENTER_THE_CODE_STATE

  const fromSpans = parseFromSpans(container)
  if (fromSpans.revealed.length > 0 || fromSpans.pressArrow) {
    return fromSpans
  }

  return parseFromText(container)
}

/** @deprecated Use parseEnterTheCodeState */
export function parseRevealedArrowCode(taskRoot: Element): string[] {
  return parseEnterTheCodeState(taskRoot).revealed
}
