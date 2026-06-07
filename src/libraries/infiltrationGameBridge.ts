interface ReactFiberNode {
  memoizedProps?: Record<string, unknown>
  pendingProps?: Record<string, unknown>
  memoizedState?: unknown
  child?: ReactFiberNode | null
  sibling?: ReactFiberNode | null
  return?: ReactFiberNode | null
  type?: { name?: string } | string
}

interface TrustedClickEvent {
  isTrusted: boolean
  preventDefault?: () => void
}

export interface InfiltrationLocationLike {
  name: string
  infiltrationData: unknown
}

interface GamePlayer {
  initInfiltration: (location: InfiltrationLocationLike) => void
  infiltration?: { startInfiltration: () => void }
}

type ClickPageFn = (page: string) => void
type ClickHandler = (event: TrustedClickEvent) => void

const INFILTRATE_BUTTON = "Infiltrate Company"
const PAGE_INFILTRATION = "Infiltration"

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

export function findInfiltrateCompanyButton(): HTMLButtonElement | null {
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

export function invokeTrustedClick(element: HTMLElement): boolean {
  const handler = findClickHandler(element)
  if (!handler) {
    element.click()
    return true
  }

  handler({ isTrusted: true, preventDefault: () => {} })
  return true
}

export function findButtonByTextPrefix(prefix: string): HTMLButtonElement | null {
  for (const button of Array.from(document.querySelectorAll("button"))) {
    if (normalizeText(button.textContent ?? "").startsWith(prefix)) {
      return button
    }
  }
  return null
}

export function getGamePlayer(): GamePlayer | null {
  try {
    const win = eval("window") as { Player?: GamePlayer }
    const player = win.Player
    if (player && typeof player.initInfiltration === "function") {
      return player
    }
  } catch {
    // ignore
  }
  return null
}

function looksLikeInfiltrationLocation(value: unknown): value is InfiltrationLocationLike {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return typeof record.name === "string" && record.infiltrationData != null
}

function findLocationInFiberAncestors(element: HTMLElement): InfiltrationLocationLike | null {
  let fiber = getReactFiber(element)
  const seen = new Set<ReactFiberNode>()

  while (fiber) {
    if (seen.has(fiber)) break
    seen.add(fiber)

    for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
      if (!props) continue
      if (looksLikeInfiltrationLocation(props.location)) {
        return props.location
      }
    }

    fiber = fiber.return ?? null
  }

  return null
}

function looksLikeClickPage(fn: ClickPageFn): boolean {
  const source = Function.prototype.toString.call(fn)
  return source.includes("toPage") || source.includes("Router")
}

function extractClickPageFromHooks(hookState: unknown): ClickPageFn | null {
  let hook = hookState as { memoizedState?: unknown; next?: unknown } | null

  while (hook) {
    if (typeof hook.memoizedState === "function") {
      const fn = hook.memoizedState as ClickPageFn
      if (fn.length <= 1 && looksLikeClickPage(fn)) {
        return fn
      }
    }
    hook = hook.next as typeof hook
  }

  return null
}

function findSidebarClickPage(): ClickPageFn | null {
  const seen = new Set<ReactFiberNode>()
  const root = document.getElementById("root")
  if (!root) return null

  function walk(fiber: ReactFiberNode | null | undefined, depth: number): ClickPageFn | null {
    if (!fiber || depth > 180 || seen.has(fiber)) return null
    seen.add(fiber)

    const props = fiber.memoizedProps ?? fiber.pendingProps
    if (props && typeof props.key_ === "string" && typeof props.clickFn === "function") {
      let parent = fiber.return
      while (parent) {
        const clickPage = extractClickPageFromHooks(parent.memoizedState)
        if (clickPage) return clickPage
        parent = parent.return
      }
    }

    const typeName = typeof fiber.type === "function" ? fiber.type.name : null
    if (typeName === "SidebarRoot") {
      const clickPage = extractClickPageFromHooks(fiber.memoizedState)
      if (clickPage) return clickPage
    }

    return (
      walk(fiber.child, depth + 1) ??
      walk(fiber.sibling, depth + 1) ??
      walk(fiber.return, depth + 1)
    )
  }

  return walk(getReactFiber(root), 0)
}

function openInfiltrationIntroFallback(locationName: string): { ok: boolean; detail: string } {
  const player = getGamePlayer()
  if (!player) {
    return { ok: false, detail: "Player.initInfiltration not available on window" }
  }

  const button = findInfiltrateCompanyButton()
  const location = button ? findLocationInFiberAncestors(button) : null
  if (!location) {
    return { ok: false, detail: "Could not read location from company page" }
  }

  if (location.name !== locationName) {
    return { ok: false, detail: `Expected ${locationName}, found ${location.name}` }
  }

  const clickPage = findSidebarClickPage()
  if (!clickPage) {
    return { ok: false, detail: "Could not find sidebar page router" }
  }

  try {
    player.initInfiltration(location)
    clickPage(PAGE_INFILTRATION)
    return { ok: true, detail: "opened via Player.initInfiltration" }
  } catch (err) {
    return { ok: false, detail: String(err) }
  }
}

/** Invoke the React onClick handler with isTrusted set (bypasses the DOM guard). */
export function invokeInfiltrateCompanyButton(locationName: string): { ok: boolean; detail: string } {
  const button = findInfiltrateCompanyButton()
  if (!button) {
    return { ok: false, detail: "Infiltrate Company button not visible" }
  }

  const handler = findClickHandler(button)
  if (!handler) {
    return openInfiltrationIntroFallback(locationName)
  }

  try {
    handler({ isTrusted: true, preventDefault: () => {} })
    return { ok: true, detail: "invoked infiltrate handler" }
  } catch (err) {
    return openInfiltrationIntroFallback(locationName)
  }
}

/** @deprecated Use invokeInfiltrateCompanyButton */
export function openInfiltrationIntro(locationName: string): { ok: boolean; detail: string } {
  return invokeInfiltrateCompanyButton(locationName)
}

/** Start the countdown/minigames from the intro screen. */
export function startInfiltrationRun(): { ok: boolean; detail: string } {
  const player = getGamePlayer()
  const start = player?.infiltration?.startInfiltration
  if (!start) {
    return { ok: false, detail: "Player.infiltration.startInfiltration not available" }
  }

  try {
    start.call(player.infiltration)
    return { ok: true, detail: "started" }
  } catch (err) {
    return { ok: false, detail: String(err) }
  }
}

function findStartClickHandler(): ClickHandler | null {
  for (const button of Array.from(document.querySelectorAll("button"))) {
    if (normalizeText(button.textContent ?? "") !== "Start") continue
    if (button.disabled) continue
    const handler = findClickHandler(button)
    if (handler) return handler
  }
  return null
}

/** Start from intro via handler, Player API, or plain click. */
export function invokeStartInfiltration(): { ok: boolean; detail: string } {
  const fromPlayer = startInfiltrationRun()
  if (fromPlayer.ok) return fromPlayer

  const handler = findStartClickHandler()
  if (handler) {
    try {
      handler({ isTrusted: true, preventDefault: () => {} })
      return { ok: true, detail: "invoked start handler" }
    } catch (err) {
      return { ok: false, detail: String(err) }
    }
  }

  return fromPlayer
}
