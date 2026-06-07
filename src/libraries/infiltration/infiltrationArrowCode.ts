const ARROW_SYMBOLS = new Set(["↑", "↓", "←", "→"])

export interface EnterTheCodeDomState {
  /** Arrow symbols shown so far (stops at first "?"). */
  revealed: string[]
  /** Arrow to press now: bright span, or last symbol before "?". */
  pressArrow: string | null
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
  let pressArrow: string | null = null

  for (const span of Array.from(container.querySelectorAll("span"))) {
    const text = span.textContent?.trim() ?? ""
    if (text === "?") break
    if (!isArrowSymbol(text)) continue

    revealed.push(text)

    if (span instanceof HTMLElement && !isDimmedSpan(span)) {
      pressArrow = text
    }
  }

  if (pressArrow === null && revealed.length > 0) {
    pressArrow = revealed[revealed.length - 1]
  }

  return { revealed, pressArrow }
}

/** Fallback when span structure differs: read chars until "?". */
function parseFromText(container: Element): EnterTheCodeDomState {
  const revealed: string[] = []
  let pressArrow: string | null = null

  for (const char of container.textContent ?? "") {
    if (char === "?") break
    if (isArrowSymbol(char)) {
      revealed.push(char)
      pressArrow = char
    }
  }

  return { revealed, pressArrow }
}

export function parseEnterTheCodeState(taskRoot: Element): EnterTheCodeDomState {
  const container = findCodeContainer(taskRoot)
  if (!container) return { revealed: [], pressArrow: null }

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
