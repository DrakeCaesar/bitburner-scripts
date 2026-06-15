interface DocumentWithKeyWrap extends Document {
  _addEventListener?: typeof document.addEventListener
  _removeEventListener?: typeof document.removeEventListener
  _dispatchEvent?: typeof document.dispatchEvent
  _keydownWrapperMap?: WeakMap<EventListenerOrEventListenerObject, EventListenerOrEventListenerObject>
}

function getKeydownWrapperMap(): WeakMap<
  EventListenerOrEventListenerObject,
  EventListenerOrEventListenerObject
> {
  const doc = document as DocumentWithKeyWrap
  if (!doc._keydownWrapperMap) {
    doc._keydownWrapperMap = new WeakMap()
  }
  return doc._keydownWrapperMap
}

interface KeyboardLikeEvent {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  preventDefault?: () => void
}

interface InfiltrationStageLike {
  onKey: (event: KeyboardLikeEvent) => void
}

interface ReactFiberNode {
  memoizedProps?: Record<string, unknown>
  pendingProps?: Record<string, unknown>
  child?: ReactFiberNode | null
  sibling?: ReactFiberNode | null
  return?: ReactFiberNode | null
}

interface WindowWithPlayer extends Window {
  Player?: { infiltration?: { stage?: InfiltrationStageLike } }
}

let trustedKeyInjectionEnabled = false
let infiltrationKeyHandler: ((event: KeyboardEvent) => void) | null = null

/** Delay between injected minigame key presses. */
export const INFILTRATION_KEY_DELAY_MS = 0

const CANCEL_LABEL = "Cancel Infiltration"
const VICTORY_TITLE = "Infiltration successful!"

function isInfiltrationVictoryScreenActive(): boolean {
  const headings = document.querySelectorAll("h4")
  for (let i = 0; i < headings.length; i++) {
    const text = headings[i].textContent?.replace(/\s+/g, " ").trim() ?? ""
    if (text === VICTORY_TITLE) {
      return true
    }
  }
  return false
}

function isInfiltrationMinigameActive(): boolean {
  const buttons = document.querySelectorAll("button")
  for (let i = 0; i < buttons.length; i++) {
    const label = buttons[i].textContent?.replace(/\s+/g, " ").trim() ?? ""
    if (label.startsWith(CANCEL_LABEL)) {
      return true
    }
  }
  return false
}

function isOnInfiltrationPage(): boolean {
  if (isInfiltrationMinigameActive()) return true

  const headings = document.querySelectorAll("h4")
  for (let i = 0; i < headings.length; i++) {
    const text = headings[i].textContent?.trim() ?? ""
    if (text.startsWith("Infiltrating ")) {
      return true
    }
    if (/^Level\s+\d+\s*\/\s*\d+$/i.test(text)) {
      return true
    }
  }

  // Intro screen uses "Cancel" before the minigame renames it.
  const buttons = document.querySelectorAll("button")
  for (let i = 0; i < buttons.length; i++) {
    const label = buttons[i].textContent?.replace(/\s+/g, " ").trim() ?? ""
    if (label === "Cancel" && buttons[i].closest(".MuiContainer-root")) {
      return true
    }
  }

  return false
}

function getReactFiber(node: Element): ReactFiberNode | null {
  for (const key of Object.keys(node)) {
    if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
      return (node as unknown as Record<string, ReactFiberNode>)[key]
    }
  }
  return null
}

function looksLikeInfiltration(value: unknown): value is { stage: InfiltrationStageLike } {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return typeof record.stage === "object" && typeof (record.stage as InfiltrationStageLike).onKey === "function"
}

function extractStageOnKey(props: Record<string, unknown> | undefined): InfiltrationStageLike | null {
  if (!props) return null

  const stage = props.stage
  if (stage && typeof stage === "object" && typeof (stage as InfiltrationStageLike).onKey === "function") {
    return stage as InfiltrationStageLike
  }

  const state = props.state
  if (looksLikeInfiltration(state)) {
    return state.stage
  }

  for (const value of Object.values(props)) {
    if (looksLikeInfiltration(value)) {
      return value.stage
    }
  }

  return null
}

function traverseFiber(
  fiber: ReactFiberNode | null | undefined,
  depth: number,
  maxDepth: number,
  seen: Set<ReactFiberNode>
): InfiltrationStageLike | null {
  if (!fiber || depth > maxDepth || seen.has(fiber)) {
    return null
  }
  seen.add(fiber)

  const fromMemo = extractStageOnKey(fiber.memoizedProps)
  if (fromMemo) return fromMemo

  const fromPending = extractStageOnKey(fiber.pendingProps)
  if (fromPending) return fromPending

  return (
    traverseFiber(fiber.child, depth + 1, maxDepth, seen) ??
    traverseFiber(fiber.sibling, depth + 1, maxDepth, seen)
  )
}

function findStageInFiberAncestors(element: Element | null, seen: Set<ReactFiberNode>): InfiltrationStageLike | null {
  let fiber = element ? getReactFiber(element) : null
  while (fiber) {
    const fromMemo = extractStageOnKey(fiber.memoizedProps)
    if (fromMemo) return fromMemo

    const fromPending = extractStageOnKey(fiber.pendingProps)
    if (fromPending) return fromPending

    const fromTree = traverseFiber(fiber.child, 0, 100, seen)
    if (fromTree) return fromTree

    fiber = fiber.return ?? null
  }
  return null
}

function findCancelButtonElement(): HTMLButtonElement | null {
  const buttons = document.querySelectorAll("button")
  for (let i = 0; i < buttons.length; i++) {
    const label = buttons[i].textContent?.replace(/\s+/g, " ").trim() ?? ""
    if (label.startsWith(CANCEL_LABEL) || label === "Cancel") {
      return buttons[i]
    }
  }
  return null
}

function getInfiltrationFiberRoots(): Element[] {
  const roots: Element[] = []
  const seen = new Set<Element>()

  const add = (element: Element | null | undefined): void => {
    if (!element || seen.has(element)) return
    seen.add(element)
    roots.push(element)
  }

  add(findCancelButtonElement())

  add(document.getElementById("root"))

  const containers = document.querySelectorAll(".MuiContainer-root")
  for (let i = 0; i < containers.length; i++) {
    add(containers[i])
  }

  const papers = document.querySelectorAll(".MuiContainer-root .MuiPaper-root")
  for (let i = 0; i < papers.length; i++) {
    add(papers[i])
  }

  const grids = document.querySelectorAll("[style*='grid-template-columns']")
  for (let i = 0; i < grids.length; i++) {
    add(grids[i])
  }

  const headings = document.querySelectorAll("h4, h5")
  for (let i = 0; i < headings.length; i++) {
    add(headings[i])
  }

  return roots
}

function getPlayerInfiltrationStage(): InfiltrationStageLike | null {
  try {
    const win = eval("window") as WindowWithPlayer
    const stage = win.Player?.infiltration?.stage
    if (stage && typeof stage.onKey === "function") {
      return stage
    }
  } catch {
    // ignore
  }

  const stage = (window as WindowWithPlayer).Player?.infiltration?.stage
  if (stage && typeof stage.onKey === "function") {
    return stage
  }

  return null
}

function wrapStageOnKey(stage: InfiltrationStageLike): (event: KeyboardLikeEvent) => void {
  return (event) => stage.onKey(event)
}

function findStageOnKeyUncached(): ((event: KeyboardLikeEvent) => void) | null {
  const playerStage = getPlayerInfiltrationStage()
  if (playerStage) {
    return wrapStageOnKey(playerStage)
  }

  const seenFibers = new Set<ReactFiberNode>()

  const cancelButton = findCancelButtonElement()
  const fromCancel = findStageInFiberAncestors(cancelButton, seenFibers)
  if (fromCancel) {
    return wrapStageOnKey(fromCancel)
  }

  for (const root of getInfiltrationFiberRoots()) {
    const stage = traverseFiber(getReactFiber(root), 0, 140, seenFibers)
    if (stage) {
      return wrapStageOnKey(stage)
    }
  }

  return null
}

function upgradeUntrustedKeyboardEvent(event: KeyboardEvent): KeyboardEvent {
  if (event.isTrusted) {
    return event
  }

  try {
    Object.defineProperty(event, "isTrusted", { value: true, configurable: true })
    return event
  } catch {
    // Fall back when isTrusted is not configurable (rare).
    const trusted = new KeyboardEvent(event.type, {
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      which: event.which,
      location: event.location,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
      bubbles: event.bubbles,
      cancelable: event.cancelable,
    })
    Object.defineProperty(trusted, "isTrusted", { value: true })
    return trusted
  }
}

function createKeyboardLikeEvent(key: string): KeyboardLikeEvent {
  const { key: eventKey } = resolveKeyEvent(key)
  return {
    key: eventKey,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  }
}

function createKeyboardEvent(key: string): KeyboardEvent {
  const { key: eventKey, code, keyCode } = resolveKeyEvent(key)
  return new KeyboardEvent("keydown", {
    key: eventKey,
    code,
    keyCode,
    which: keyCode,
    bubbles: true,
    cancelable: true,
  })
}

/** Returns true when a key path handled the event. */
function deliverKeyboardEvent(key: string): boolean {
  const stageOnKey = findStageOnKeyUncached()
  if (stageOnKey) {
    stageOnKey(createKeyboardLikeEvent(key))
    return true
  }

  return dispatchDomKeyboardEvent(key)
}

function dispatchDomKeyboardEvent(key: string, target?: HTMLElement | null): boolean {
  const rawEvent = createKeyboardEvent(key)

  if (infiltrationKeyHandler) {
    infiltrationKeyHandler(upgradeUntrustedKeyboardEvent(rawEvent))
    return true
  }

  if (!isOnInfiltrationPage() || isInfiltrationVictoryScreenActive()) {
    return false
  }

  const dispatchTarget =
    target ??
    (document.activeElement instanceof HTMLElement &&
    document.activeElement !== document.body
      ? document.activeElement
      : null)

  if (dispatchTarget) {
    dispatchTarget.focus()
    return dispatchTarget.dispatchEvent(rawEvent)
  }

  return document.dispatchEvent(rawEvent)
}

function wrapKeydownListener(callback: EventListenerOrEventListenerObject): EventListenerOrEventListenerObject {
  const keydownWrapperMap = getKeydownWrapperMap()
  const existing = keydownWrapperMap.get(callback)
  if (existing) {
    return existing
  }

  if (typeof callback === "function") {
    const listener = callback as (event: KeyboardEvent) => void
    const wrapped = function (this: Document, event: Event) {
      if (event instanceof KeyboardEvent && !event.isTrusted) {
        return listener.call(this, upgradeUntrustedKeyboardEvent(event))
      }
      return listener.call(this, event as KeyboardEvent)
    }
    keydownWrapperMap.set(callback, wrapped)
    return wrapped
  }

  const wrapped: EventListenerObject = {
    handleEvent(event: Event) {
      if (event instanceof KeyboardEvent && !event.isTrusted) {
        return callback.handleEvent(upgradeUntrustedKeyboardEvent(event))
      }
      return callback.handleEvent(event)
    },
  }
  keydownWrapperMap.set(callback, wrapped)
  return wrapped
}

function resolveKeydownWrappedListener(
  callback: EventListenerOrEventListenerObject | null
): EventListenerOrEventListenerObject | null {
  if (!callback) {
    return null
  }
  return getKeydownWrapperMap().get(callback) ?? callback
}

/**
 * Keep removeEventListener patched for the page lifetime so React/MUI cleanup
 * can detach wrapped keydown handlers after disableTrustedKeyInjection restores add.
 */
function ensureKeydownRemoveEventListenerPatch(): void {
  const doc = document as DocumentWithKeyWrap
  if (doc._removeEventListener) {
    return
  }

  doc._removeEventListener = doc.removeEventListener.bind(doc)

  doc.removeEventListener = function (
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void {
    if (!callback) {
      return
    }

    if (type !== "keydown") {
      doc._removeEventListener!(type, callback, options)
      return
    }

    const wrapped = resolveKeydownWrappedListener(callback)!
    doc._removeEventListener!(type, wrapped, options)
    const keydownWrapperMap = getKeydownWrapperMap()
    if (keydownWrapperMap.get(callback) === wrapped) {
      keydownWrapperMap.delete(callback)
    }
  }
}

/**
 * Patch document.addEventListener / dispatchEvent so synthetic keydowns reach
 * the infiltration minigame as trusted KeyboardEvents.
 */
export function enableTrustedKeyInjection(): void {
  const doc = document as DocumentWithKeyWrap
  ensureKeydownRemoveEventListenerPatch()

  if (doc._addEventListener) {
    return
  }

  trustedKeyInjectionEnabled = true
  doc._addEventListener = doc.addEventListener.bind(doc)
  doc._dispatchEvent = doc.dispatchEvent.bind(doc)

  doc.dispatchEvent = function (event: Event): boolean {
    if (event instanceof KeyboardEvent && !event.isTrusted) {
      return doc._dispatchEvent!(upgradeUntrustedKeyboardEvent(event))
    }
    return doc._dispatchEvent!(event)
  }

  doc.addEventListener = function (
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (!callback) {
      return
    }

    if (type !== "keydown") {
      doc._addEventListener!(type, callback, options)
      return
    }

    if (typeof callback === "function" && isOnInfiltrationPage()) {
      infiltrationKeyHandler = callback as (event: KeyboardEvent) => void
    }

    doc._addEventListener!(type, wrapKeydownListener(callback), options)
  }
}

export function clearInfiltrationKeyHandler(): void {
  infiltrationKeyHandler = null
}

export function disableTrustedKeyInjection(): void {
  infiltrationKeyHandler = null
  trustedKeyInjectionEnabled = false

  const doc = document as DocumentWithKeyWrap
  if (doc._addEventListener) {
    doc.addEventListener = doc._addEventListener
    delete doc._addEventListener
  }

  if (doc._dispatchEvent) {
    doc.dispatchEvent = doc._dispatchEvent
    delete doc._dispatchEvent
  }
}

/** Force-restore document keyboard handling after script exit or kill. */
export function restoreDocumentKeyboard(): void {
  disableTrustedKeyInjection()
}

/** Enable patching during minigames only (victory uses trusted clicks, not keys). */
export function syncTrustedKeyInjection(): void {
  const shouldEnable =
    isInfiltrationMinigameActive() && !isInfiltrationVictoryScreenActive()

  if (shouldEnable) {
    enableTrustedKeyInjection()
    return
  }

  if (trustedKeyInjectionEnabled) {
    disableTrustedKeyInjection()
  }
}

export function isTrustedKeyInjectionEnabled(): boolean {
  return trustedKeyInjectionEnabled
}

export function hasInfiltrationKeyHandler(): boolean {
  return infiltrationKeyHandler !== null
}

export function hasInfiltrationStageOnKey(): boolean {
  return findStageOnKeyUncached() !== null
}

export function isInfiltrationKeyInputReady(): boolean {
  return findStageOnKeyUncached() !== null || infiltrationKeyHandler !== null
}

export function getInfiltrationKeyInputMode(): string {
  if (findStageOnKeyUncached()) return "stage"
  if (infiltrationKeyHandler) return "handler"
  return "missing"
}

export function describeInfiltrationKeyInput(): string {
  if (findStageOnKeyUncached()) return "stage.onKey"
  if (infiltrationKeyHandler) return "keydown handler"
  if (!isOnInfiltrationPage()) return "not on infiltration page"
  return "no key path found"
}

function resolveKeyEvent(key: string): { key: string; code: string; keyCode: number } {
  switch (key) {
    case " ":
      return { key: " ", code: "Space", keyCode: 32 }
    case "ArrowLeft":
      return { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 }
    case "ArrowUp":
      return { key: "ArrowUp", code: "ArrowUp", keyCode: 38 }
    case "ArrowRight":
      return { key: "ArrowRight", code: "ArrowRight", keyCode: 39 }
    case "ArrowDown":
      return { key: "ArrowDown", code: "ArrowDown", keyCode: 40 }
    case "Tab":
      return { key: "Tab", code: "Tab", keyCode: 9 }
    case "Enter":
      return { key: "Enter", code: "Enter", keyCode: 13 }
    case "Escape":
      return { key: "Escape", code: "Escape", keyCode: 27 }
    default:
      if (key.length !== 1) {
        return { key, code: key, keyCode: 0 }
      }
      if (/[a-z]/i.test(key)) {
        const lower = key.toLowerCase()
        return { key: lower, code: `Key${lower.toUpperCase()}`, keyCode: lower.charCodeAt(0) }
      }
      return { key, code: key, keyCode: key.charCodeAt(0) }
  }
}

/** Send a keydown to the infiltration minigame. Returns true if a path handled it. */
export function pressInfiltrationKey(key: string): boolean {
  return deliverKeyboardEvent(key)
}

/**
 * Send a keydown to the victory UI (dropdown / trade buttons), bypassing stage.onKey
 * so MUI controls receive Tab, Enter, and arrow keys.
 */
export function pressVictoryKeyboardKey(key: string, target?: HTMLElement | null): boolean {
  return dispatchDomKeyboardEvent(key, target)
}
