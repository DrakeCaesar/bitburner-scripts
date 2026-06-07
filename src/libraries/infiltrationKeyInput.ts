interface DocumentWithKeyWrap extends Document {
  _addEventListener?: typeof document.addEventListener
}

let trustedKeyInjectionEnabled = false
let infiltrationKeyHandler: ((event: KeyboardEvent) => void) | null = null

const CANCEL_LABEL = "Cancel Infiltration"

function isInfiltrationUiActive(): boolean {
  const buttons = document.querySelectorAll("button")
  for (let i = 0; i < buttons.length; i++) {
    const label = buttons[i].textContent?.replace(/\s+/g, " ").trim() ?? ""
    if (label.startsWith(CANCEL_LABEL)) {
      return true
    }
  }
  return false
}

function markEventTrusted(event: KeyboardEvent): KeyboardEvent {
  Object.defineProperty(event, "isTrusted", { value: true, configurable: true })
  Object.defineProperty(event, "keyCode", { value: event.keyCode, configurable: true })
  Object.defineProperty(event, "which", { value: event.which, configurable: true })
  return event
}

function createTrustedKeyboardEvent(key: string): KeyboardEvent {
  const { key: eventKey, code, keyCode } = resolveKeyEvent(key)
  return markEventTrusted(
    new KeyboardEvent("keydown", {
      key: eventKey,
      code,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
    })
  )
}

function upgradeUntrustedKeyboardEvent(event: KeyboardEvent): KeyboardEvent {
  return markEventTrusted(
    new KeyboardEvent(event.type, {
      key: event.key,
      code: event.code,
      location: event.location,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
      bubbles: event.bubbles,
      cancelable: event.cancelable,
      composed: event.composed,
      keyCode: event.keyCode,
      which: event.which,
    })
  )
}

/**
 * Capture infiltration's keydown handler and upgrade synthetic events.
 * Must run before starting an infiltration (script startup is fine).
 *
 * Current game checks both event.isTrusted and event instanceof KeyboardEvent.
 * Plain-object hacks no longer pass; use a real KeyboardEvent with isTrusted set.
 */
export function enableTrustedKeyInjection(): void {
  const doc = document as DocumentWithKeyWrap
  if (doc._addEventListener) return

  trustedKeyInjectionEnabled = true
  doc._addEventListener = doc.addEventListener.bind(doc)

  doc.addEventListener = function (
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (!callback) {
      return
    }

    if (type !== "keydown" || typeof callback !== "function") {
      doc._addEventListener!(type, callback, options)
      return
    }

    if (isInfiltrationUiActive()) {
      infiltrationKeyHandler = callback as (event: KeyboardEvent) => void
    }

    const listener = callback as (event: KeyboardEvent) => void
    const wrapped = function (this: Document, event: Event) {
      if (event instanceof KeyboardEvent && !event.isTrusted) {
        return listener.call(this, upgradeUntrustedKeyboardEvent(event))
      }
      return listener.call(this, event as KeyboardEvent)
    }

    doc._addEventListener!(type, wrapped, options)
  }
}

export function clearInfiltrationKeyHandler(): void {
  infiltrationKeyHandler = null
}

export function disableTrustedKeyInjection(): void {
  const doc = document as DocumentWithKeyWrap
  if (!doc._addEventListener) return

  doc.addEventListener = doc._addEventListener
  delete doc._addEventListener
  trustedKeyInjectionEnabled = false
  infiltrationKeyHandler = null
}

export function isTrustedKeyInjectionEnabled(): boolean {
  return trustedKeyInjectionEnabled
}

export function hasInfiltrationKeyHandler(): boolean {
  return infiltrationKeyHandler !== null
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

/** Send a trusted keydown to the infiltration minigame. */
export function pressInfiltrationKey(key: string): void {
  const event = createTrustedKeyboardEvent(key)

  if (infiltrationKeyHandler) {
    infiltrationKeyHandler(event)
    return
  }

  document.dispatchEvent(event)
}
