interface ReactFiberNode {
  memoizedProps?: Record<string, unknown>
  pendingProps?: Record<string, unknown>
  child?: ReactFiberNode | null
  return?: ReactFiberNode | null
}

interface TrustedClickEvent {
  isTrusted: boolean
  preventDefault?: () => void
}

type ClickHandler = (event: TrustedClickEvent) => void

const INFILTRATE_BUTTON = "Infiltrate Company"
const START_BUTTON = "Start"

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function getReactFiber(node: Element): ReactFiberNode | null {
  for (const key of Object.keys(node)) {
    if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
      return (node as unknown as Record<string, ReactFiberNode>)[key]
    }
  }
  return null
}

function findInfiltrateCompanyButton(): HTMLButtonElement | null {
  for (const button of Array.from(document.querySelectorAll("button"))) {
    if (normalizeText(button.textContent ?? "") === INFILTRATE_BUTTON) {
      return button
    }
  }
  return null
}

function findClickHandler(element: HTMLElement): ClickHandler | null {
  let fiber = getReactFiber(element)
  const seen = new Set<ReactFiberNode>()

  while (fiber) {
    if (seen.has(fiber)) break
    seen.add(fiber)

    for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
      if (props && typeof props.onClick === "function") {
        return props.onClick as ClickHandler
      }
    }

    fiber = fiber.return ?? null
  }

  return null
}

function invokeTrustedHandler(element: HTMLElement): { ok: boolean; detail: string } {
  const handler = findClickHandler(element)
  if (!handler) {
    return { ok: false, detail: "no React onClick handler" }
  }

  try {
    handler({ isTrusted: true, preventDefault: () => {} })
    return { ok: true, detail: "invoked trusted handler" }
  } catch (err) {
    return { ok: false, detail: String(err) }
  }
}

/** Invoke Infiltrate Company's trusted React onClick (required by CompanyLocation.tsx). */
export function invokeInfiltrateCompanyButton(): { ok: boolean; detail: string } {
  const button = findInfiltrateCompanyButton()
  if (!button) {
    return { ok: false, detail: "Infiltrate Company button not visible" }
  }

  return invokeTrustedHandler(button)
}

function findStartButton(): HTMLButtonElement | null {
  for (const button of Array.from(document.querySelectorAll("button"))) {
    if (normalizeText(button.textContent ?? "") !== START_BUTTON) continue
    if (button.disabled) continue
    return button
  }
  return null
}

/** Start the run via the intro screen's trusted React onClick handler. */
export function invokeStartInfiltration(): { ok: boolean; detail: string } {
  const button = findStartButton()
  if (!button) {
    return { ok: false, detail: "Start button not visible" }
  }

  return invokeTrustedHandler(button)
}

export function invokeTrustedClick(element: HTMLElement): boolean {
  return invokeTrustedHandler(element).ok
}
