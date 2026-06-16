/**
 * Adaptive script-log sink: normal Bitburner tail while the UI is visible,
 * floating DOM window while infiltration (or similar) hides tails and the sidebar.
 */

import { NS } from "@ns"
import {
  FloatingWindow,
  probeFloatingWindowRect,
  readPrimaryUiColor,
} from "./floatingWindow.js"
import {
  applyScriptTailWindowRect,
  layoutForTailRender,
  measureScriptLogViewportSize,
  mergeLayout,
  probeScriptTailWindow,
  renderScriptLogToContainer,
  resolveTailSize,
  syncScriptLogContainerLayout,
  unmountScriptLogContainer,
  type ScriptLogBuilder,
  type ScriptLogWindowRect,
  type TableLayout,
} from "./scriptLogUi.js"

export type { ScriptLogWindowRect }

export type AdaptiveTailLogOptions = {
  /** Stable DOM id for the floating window (e.g. "ipvgo-script-log"). */
  windowId: string
  /** Title shown in both tail and floating chrome. */
  title: string
  /** When true, render into a floating DOM window instead of the script tail. */
  shouldUseFloating: () => boolean
  layout?: Partial<TableLayout>
}

type AdaptiveMode = "tail" | "floating"

export type AdaptiveTailLogHandle = {
  log: ScriptLogBuilder
  render: (ns: NS, log?: ScriptLogBuilder) => Promise<void>
  dispose: () => void
}

function createScriptLogMountContainer(primaryColor: string): HTMLDivElement {
  const container = document.createElement("div")
  container.style.fontFamily = "monospace"
  container.style.fontSize = "12px"
  container.style.lineHeight = "1.2"
  container.style.color = primaryColor
  container.style.overflow = "auto"
  container.style.width = "100%"
  container.style.boxSizing = "border-box"
  return container
}

export function createAdaptiveTailLog(
  log: ScriptLogBuilder,
  options: AdaptiveTailLogOptions
): AdaptiveTailLogHandle {
  let mode: AdaptiveMode = "tail"
  /** Last tail bounds in viewport space (saved while tail is still visible). */
  let savedTailRect: ScriptLogWindowRect | null = null
  /** One-shot restore after switching from floating back to the script tail. */
  let pendingTailRestore: ScriptLogWindowRect | null = null
  let floatWindow: FloatingWindow | null = null
  let mountContainer: HTMLDivElement | null = null
  /** Viewport anchor preserved across floating resizes. */
  let floatingAnchor: { x: number; y: number } | null = null

  const rememberTailRect = (ns: NS): void => {
    const probed = probeScriptTailWindow(ns.pid)
    if (probed) savedTailRect = probed
  }

  const closeFloating = (): void => {
    if (mountContainer) {
      unmountScriptLogContainer(mountContainer)
      mountContainer = null
    }
    floatWindow?.close()
    floatWindow = null
  }

  const enterFloating = (ns: NS): void => {
    document.getElementById(options.windowId)?.remove()

    // Tail may already be hidden — use last saved viewport rect from normal renders.
    const rect = probeScriptTailWindow(ns.pid) ?? savedTailRect

    const primaryColor = readPrimaryUiColor()
    mountContainer = createScriptLogMountContainer(primaryColor)

    floatWindow = new FloatingWindow({
      id: options.windowId,
      title: options.title,
      content: mountContainer,
      closable: false,
      collapsible: true,
      isCollapsed: rect?.collapsed,
      contentChrome: "tail",
    })

    if (rect) {
      floatingAnchor = { x: rect.x, y: rect.y }
      floatWindow.setScreenRect(rect)
    } else {
      floatingAnchor = null
    }
  }

  const exitFloating = (): void => {
    const probed = probeFloatingWindowRect(floatWindow?.getElement() ?? null)
    if (probed) {
      pendingTailRestore = {
        ...probed,
        width: savedTailRect?.width ?? probed.width,
        height: savedTailRect?.height ?? probed.height,
      }
    }
    closeFloating()
    floatingAnchor = null
  }

  const measureFloatingLayout = (
    ns: NS,
    mergedLayout: Partial<TableLayout>,
    container: HTMLElement,
    floatRoot: HTMLElement
  ): { renderLayout: TableLayout; sized: ReturnType<typeof resolveTailSize> } => {
    const painted = measureScriptLogViewportSize(container)
    const merged = mergeLayout(mergedLayout)
    const headerPx =
      (floatRoot.querySelector(".drag") as HTMLElement | null)?.offsetHeight ?? merged.tailTitleBarPx
    const maxTotal = Math.floor(window.innerHeight * 0.95)
    const contentHeightPx = Math.max(mergedLayout.tailContentHeightPx ?? 0, painted.heightPx)
    const renderLayout = layoutForTailRender({
      ...mergedLayout,
      tailContentHeightPx: contentHeightPx,
      tailMaxHeightPx: maxTotal,
      tailScriptPid: ns.pid,
    })
    const sized = resolveTailSize(renderLayout)
    // When capped, ensure viewport height matches chrome so inner scroll activates.
    if (contentHeightPx + headerPx > maxTotal && sized.viewportMaxHeightPx == null) {
      const capped = mergeLayout({
        ...renderLayout,
        tailHeightPx: maxTotal,
        tailViewportMaxHeightPx: Math.max(40, maxTotal - headerPx),
      })
      return { renderLayout: capped, sized: resolveTailSize(capped) }
    }
    return { renderLayout, sized }
  }

  const applyFloatingLayout = (
    ns: NS,
    mergedLayout: Partial<TableLayout>,
    container: HTMLElement,
    floatRoot: HTMLElement
  ): void => {
    const { renderLayout, sized } = measureFloatingLayout(ns, mergedLayout, container, floatRoot)
    syncScriptLogContainerLayout(container, renderLayout)
    const scrollable = sized.viewportMaxHeightPx != null
    floatWindow?.setSize(sized.width, sized.height, scrollable)
    if (floatingAnchor) {
      floatWindow?.setScreenPosition(floatingAnchor.x, floatingAnchor.y)
    }
  }

  const renderFloating = async (ns: NS, builder: ScriptLogBuilder): Promise<void> => {
    if (!floatWindow || !mountContainer) {
      enterFloating(ns)
    }

    const { content, layout } = builder.prepareRender(ns)
    const mergedLayout = { ...options.layout, ...layout }
    await renderScriptLogToContainer(ns, mountContainer!, content, mergedLayout)

    const floatRoot = floatWindow?.getElement()
    if (floatRoot && mountContainer) {
      const win = eval("window") as Window
      const applyLayout = (): void => {
        applyFloatingLayout(ns, mergedLayout, mountContainer!, floatRoot)
      }
      applyLayout()
      win.requestAnimationFrame(() => {
        applyLayout()
        win.requestAnimationFrame(applyLayout)
      })
    }
  }

  const renderTail = async (ns: NS, builder: ScriptLogBuilder): Promise<void> => {
    await builder.render(ns)
    if (pendingTailRestore) {
      const rect = pendingTailRestore
      pendingTailRestore = null
      applyScriptTailWindowRect(ns.pid, rect)
    } else {
      rememberTailRect(ns)
    }
  }

  const render = async (ns: NS, builder: ScriptLogBuilder = log): Promise<void> => {
    if (mode === "tail") {
      rememberTailRect(ns)
    }

    const wantFloating = options.shouldUseFloating()
    const nextMode: AdaptiveMode = wantFloating ? "floating" : "tail"

    if (nextMode !== mode) {
      if (mode === "floating") {
        exitFloating()
      } else {
        rememberTailRect(ns)
      }
      if (nextMode === "floating") {
        enterFloating(ns)
      }
      mode = nextMode
    }

    if (mode === "floating") {
      await renderFloating(ns, builder)
    } else {
      await renderTail(ns, builder)
    }
  }

  const dispose = (): void => {
    exitFloating()
    mode = "tail"
    savedTailRect = null
    pendingTailRestore = null
  }

  return { log, render, dispose }
}
