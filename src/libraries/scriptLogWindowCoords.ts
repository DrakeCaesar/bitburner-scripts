/** Window bounds in viewport (screen) space — safe between tail and floating DOM sinks. */
export type WindowScreenRect = {
  x: number
  y: number
  width: number
  height: number
  collapsed?: boolean
}

/** Read draggable window top-left and size from getBoundingClientRect. */
export function probeDraggableScreenRect(
  draggable: HTMLElement,
  options?: { sizeEl?: HTMLElement; collapsed?: boolean }
): WindowScreenRect {
  const sizeEl = options?.sizeEl ?? draggable
  const rect = draggable.getBoundingClientRect()
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(sizeEl.offsetWidth || rect.width),
    height: Math.round(sizeEl.offsetHeight || rect.height),
    collapsed: options?.collapsed,
  }
}

function draggableLayoutOrigin(draggable: HTMLElement): { left: number; top: number } {
  const prevTransform = draggable.style.transform
  draggable.style.transform = "translate(0px, 0px)"
  const origin = draggable.getBoundingClientRect()
  if (prevTransform) {
    draggable.style.transform = prevTransform
  } else {
    draggable.style.removeProperty("transform")
  }
  return { left: origin.left, top: origin.top }
}

/** Place a react-draggable element so its viewport top-left matches rect.x/y. */
export function applyDraggableScreenPosition(draggable: HTMLElement, x: number, y: number): void {
  const base = draggableLayoutOrigin(draggable)
  const tx = Math.round(x - base.left)
  const ty = Math.round(y - base.top)
  draggable.style.transform = `translate(${tx}px, ${ty}px)`
}

/** Bitburner tail: resizable is the visible frame; draggable top includes the title bar. */
export function probeScriptTailScreenRect(
  draggable: HTMLElement,
  resizable: HTMLElement,
  collapsed?: boolean
): WindowScreenRect {
  const dragRect = draggable.getBoundingClientRect()
  const sizeRect = resizable.getBoundingClientRect()
  return {
    x: Math.round(sizeRect.left),
    y: Math.round(dragRect.top),
    width: Math.round(resizable.offsetWidth || sizeRect.width),
    height: Math.round(resizable.offsetHeight || sizeRect.height),
    collapsed,
  }
}

/** Position tail so resizable matches rect; draggable carries title bar offset. */
export function applyScriptTailScreenRect(
  draggable: HTMLElement,
  resizable: HTMLElement,
  rect: WindowScreenRect
): void {
  const dragRect = draggable.getBoundingClientRect()
  const sizeRect = resizable.getBoundingClientRect()
  const insetX = sizeRect.left - dragRect.left
  const insetY = sizeRect.top - dragRect.top
  applyDraggableScreenPosition(draggable, rect.x - insetX, rect.y - insetY)
  resizable.style.width = `${rect.width}px`
  resizable.style.height = `${rect.height}px`
}

/** Place at viewport position; optionally set size on sizeEl (defaults to draggable). */
export function applyDraggableScreenRect(
  draggable: HTMLElement,
  rect: WindowScreenRect,
  sizeEl?: HTMLElement
): void {
  applyDraggableScreenPosition(draggable, rect.x, rect.y)
  const sizeTarget = sizeEl ?? draggable
  sizeTarget.style.width = `${rect.width}px`
  sizeTarget.style.height = `${rect.height}px`
}
