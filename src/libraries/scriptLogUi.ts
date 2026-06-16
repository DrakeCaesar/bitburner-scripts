/**
 * React tail rendering primitives. Scripts should use {@link ./scriptLogUiLayout.js} instead.
 */

import { NS, ReactNode } from "@ns"
import type { Alignment, ColumnConfig, KeyValueTableConfig, TableConfig, ThreeColumnTableConfig } from "./tableBuilder.js"
import {
  applyScriptTailScreenRect,
  probeScriptTailScreenRect,
  type WindowScreenRect,
} from "./scriptLogWindowCoords.js"

export interface TableLayout {
  fontSizePx: number
  paddingXPx: number
  borderPx: number
  headerRowHeightPx: number
  bodyRowHeightPx: number
  tableWidthPx: number
  /** Bitburner tail title row in px (override; default matches logs calc(100% - Npx)). */
  tailTitleBarPx: number
  /** Widest table in a tabbed log; used for resizeTail only, not per-table width. */
  tailTableWidthPx?: number
  /** Estimated content height in px (excludes title bar); used with resolveTailSize. */
  tailContentHeightPx?: number
  /** Optional floor for tail window width (defaults to measured content width). */
  tailWidthPx?: number
  /** Optional fixed total tail height; overrides tailContentHeightPx when set. */
  tailHeightPx?: number
  /** Cap for tail width; defaults to ~95% of the game window. */
  tailMaxWidthPx?: number
  /** Cap for total tail height; defaults to full game window height. */
  tailMaxHeightPx?: number
  /** Scrollable content area inside the tail (set when sizing before render). */
  tailViewportMaxHeightPx?: number
  /** Calling script pid; used to restore scroll across tail redraws. */
  tailScriptPid?: number
  /** Tabbed tail: tab bar stays fixed; only the panel area scrolls. */
  tailTabbed?: boolean
  /** Active tab id for per-tab scroll restore in tabbed tails. */
  tailActiveTabId?: string
  sectionGapPx: number
}

export const DEFAULT_LAYOUT: TableLayout = {
  fontSizePx: 12,
  paddingXPx: 8,
  borderPx: 1,
  headerRowHeightPx: 26,
  bodyRowHeightPx: 22,
  tableWidthPx: 640,
  /** Bitburner tail title row (h6 + buttons); logs panel uses calc(100% - Npx). */
  tailTitleBarPx: 33,
  sectionGapPx: 8,
}

export const HIGHLIGHT_BG = "rgba(0, 255, 0, 0.18)"
export const SELECTED_ROW_BG = "rgba(255, 255, 255, 0.06)"
export const ACTIVE_HEADER_BG = "rgba(0, 255, 0, 0.12)"
const BODY_BORDER = "rgba(255, 255, 255, 0.08)"
const HEADER_BORDER = "rgba(255, 255, 255, 0.15)"
const HEADER_BG = "rgba(255, 255, 255, 0.04)"
/** Prefer text glyphs over color emoji in monospace tail UI. */
const TAIL_EMOJI_TEXT_STYLE: Record<string, string> = {
  fontVariantEmoji: "text",
}

function appendTextPresentationSelector(ch: string): string {
  return ch.endsWith("\uFE0E") ? ch : `${ch}\uFE0E`
}

const TAIL_EMOJI_CHAR_RE: RegExp = (() => {
  try {
    return new RegExp("\\p{Extended_Pictographic}", "gu")
  } catch {
    // Enclosed Alphanumeric Supplement (squared letters/digits in darknet hostnames)
    return /[\u{1F100}-\u{1F1FF}]/gu
  }
})()

/** Force pictographic code points to render as plain text (not color emoji). */
export function tailDisplayText(text: string): string {
  let s = text.replace(/\uFE0F/g, "\uFE0E")
  s = s.replace(TAIL_EMOJI_CHAR_RE, appendTextPresentationSelector)
  return s
}

type ReactComponent<P = Record<string, unknown>> = (props: P) => ReactNode

export type ReactRef = {
  createElement(type: string, props?: Record<string, unknown> | null, ...children: unknown[]): ReactNode
  createElement<P extends Record<string, unknown>>(
    type: ReactComponent<P>,
    props?: P | null,
    ...children: unknown[]
  ): ReactNode
  useState: <T>(initial: T) => [T, (value: T | ((prev: T) => T)) => void]
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => void
}

export function getReact(): ReactRef {
  return eval("window.React") as ReactRef
}

export function mergeLayout(partial?: Partial<TableLayout>): TableLayout {
  return { ...DEFAULT_LAYOUT, ...partial }
}

const SCRIPT_LOG_VIEWPORT_ATTR = "data-script-log-viewport"
const SCRIPT_LOG_PID_ATTR = "data-script-log-pid"
const SCRIPT_LOG_PANEL_ATTR = "data-script-log-panel"
/** Opaque background so sticky tab chips cover scrolling panel content. */
const TAB_BAR_BG = "#141414"

function isVerticallyScrollable(el: HTMLElement, win: Window): boolean {
  const style = win.getComputedStyle(el)
  const overflowY = style.overflowY
  return (
    (overflowY === "scroll" || overflowY === "auto") && el.scrollHeight > el.clientHeight + 1
  )
}

/** Innermost scroll container with offset, or innermost scrollable ancestor (includes el). */
function findActiveScrollContainer(el: HTMLElement): HTMLElement | null {
  const win = eval("window") as Window
  const scrollables: HTMLElement[] = []
  let node: HTMLElement | null = el
  while (node) {
    if (isVerticallyScrollable(node, win)) scrollables.push(node)
    node = node.parentElement
  }
  if (scrollables.length === 0) return null
  for (let i = scrollables.length - 1; i >= 0; i--) {
    if (scrollables[i].scrollTop > 0) return scrollables[i]
  }
  return scrollables[0]
}

/** Per-script scroll offset preserved across clearLog / renderTail redraws. */
const lastScrollTopByPid = new Map<number, number>()

/** Per-script, per-tab panel scroll offsets in tabbed tails. */
const lastScrollTopByPidAndTab = new Map<number, Map<string, number>>()

function getTabScrollMap(pid: number): Map<string, number> {
  let map = lastScrollTopByPidAndTab.get(pid)
  if (!map) {
    map = new Map()
    lastScrollTopByPidAndTab.set(pid, map)
  }
  return map
}

function readTabbedPanelScroll(pid: number, tabId: string | undefined): number | undefined {
  if (tabId == null) return lastScrollTopByPid.get(pid)
  const map = lastScrollTopByPidAndTab.get(pid)
  if (map?.has(tabId)) return map.get(tabId)
  return undefined
}

function writeTabbedPanelScroll(pid: number, tabId: string | undefined, scrollTop: number): void {
  if (tabId != null) getTabScrollMap(pid).set(tabId, scrollTop)
  lastScrollTopByPid.set(pid, scrollTop)
}

/** Measured or default title row from Bitburner tail chrome (h6 + control buttons). */
let cachedTailTitleBarPx: number | null = null

/** Per-script last resizeTail (module is shared across all running scripts in the game). */
const lastTailSizeByPid = new Map<number, { width: number; height: number }>()

function resetTailSession(pid: number): void {
  lastTailSizeByPid.delete(pid)
  lastScrollTopByPid.delete(pid)
  lastScrollTopByPidAndTab.delete(pid)
}

function findTabbedPanelScrollEl(viewport: HTMLElement): HTMLElement | null {
  const panel = viewport.querySelector(`[${SCRIPT_LOG_PANEL_ATTR}]`)
  return panel instanceof HTMLElement ? panel : null
}

function saveTabbedPanelScroll(pid: number, tabId: string): void {
  try {
    const doc = eval("document") as Document
    const viewport = doc.querySelector(`[${SCRIPT_LOG_PID_ATTR}="${pid}"]`) as HTMLElement | null
    if (!viewport) return
    const panel = findTabbedPanelScrollEl(viewport)
    if (!panel) return
    writeTabbedPanelScroll(pid, tabId, panel.scrollTop)
  } catch {
    // ignore
  }
}

function restoreTabbedPanelScroll(pid: number, tabId: string | undefined, panelEl?: HTMLElement | null): void {
  if (tabId == null) return
  try {
    const panel =
      panelEl ??
      (() => {
        const doc = eval("document") as Document
        const viewport = doc.querySelector(`[${SCRIPT_LOG_PID_ATTR}="${pid}"]`) as HTMLElement | null
        return viewport ? findTabbedPanelScrollEl(viewport) : null
      })()
    if (!panel) return
    const saved = readTabbedPanelScroll(pid, tabId)
    if (saved != null) {
      const maxScroll = Math.max(0, panel.scrollHeight - panel.clientHeight)
      panel.scrollTop = Math.min(saved, maxScroll)
    } else {
      panel.scrollTop = 0
    }
    writeTabbedPanelScroll(pid, tabId, panel.scrollTop)
  } catch {
    // ignore
  }
}

function saveTailScrollPosition(pid: number, activeTabId?: string): void {
  try {
    const doc = eval("document") as Document
    const viewport = doc.querySelector(`[${SCRIPT_LOG_PID_ATTR}="${pid}"]`) as HTMLElement | null
    if (!viewport) return
    const win = eval("window") as Window
    const panelEl = findTabbedPanelScrollEl(viewport)
    if (panelEl) {
      writeTabbedPanelScroll(pid, activeTabId, panelEl.scrollTop)
      return
    }
    const scrollEl = findActiveScrollContainer(viewport)
    if (!scrollEl) return
    lastScrollTopByPid.set(pid, scrollEl.scrollTop)
  } catch {
    // ignore
  }
}

function applyTailScrollPosition(
  containerEl: HTMLElement,
  pid: number | undefined,
  activeTabId?: string
): void {
  if (pid == null) return

  const viewport = containerEl.hasAttribute(SCRIPT_LOG_VIEWPORT_ATTR)
    ? containerEl
    : (containerEl.closest(`[${SCRIPT_LOG_VIEWPORT_ATTR}]`) as HTMLElement | null)
  const panelEl =
    containerEl.hasAttribute(SCRIPT_LOG_PANEL_ATTR)
      ? containerEl
      : viewport
        ? findTabbedPanelScrollEl(viewport)
        : null
  if (panelEl) {
    const saved = readTabbedPanelScroll(pid, activeTabId)
    if (saved != null) {
      const maxScroll = Math.max(0, panelEl.scrollHeight - panelEl.clientHeight)
      panelEl.scrollTop = Math.min(saved, maxScroll)
    } else {
      panelEl.scrollTop = 0
    }
    writeTabbedPanelScroll(pid, activeTabId, panelEl.scrollTop)
    return
  }

  const saved = lastScrollTopByPid.get(pid)
  if (saved === 0) {
    setAllTailScrollToVisualTop(pid)
    return
  }

  if (saved != null && saved > 0) {
    const scrollEl = findActiveScrollContainer(containerEl)
    if (!scrollEl) return
    const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)
    scrollEl.scrollTop = Math.min(saved, maxScroll)
    return
  }

  const hasScriptLogViewport =
    containerEl.hasAttribute(SCRIPT_LOG_VIEWPORT_ATTR) ||
    containerEl.querySelector(`[${SCRIPT_LOG_VIEWPORT_ATTR}]`) != null
  if (hasScriptLogViewport) {
    setAllTailScrollToVisualTop(pid)
    return
  }

  const scrollEl = findActiveScrollContainer(containerEl)
  if (!scrollEl) return
  const win = eval("window") as Window
  const flexDirection = win.getComputedStyle(scrollEl).flexDirection
  if (flexDirection === "column-reverse") {
    scrollEl.scrollTop = scrollEl.scrollHeight - scrollEl.clientHeight
  }
}

/** Collect every vertically scrollable element in this script tail window. */
function collectTailScrollables(viewport: HTMLElement, win: Window): HTMLElement[] {
  const seen = new Set<HTMLElement>()
  const scrollables: HTMLElement[] = []
  const add = (el: HTMLElement | null | undefined): void => {
    if (!el || seen.has(el) || !isVerticallyScrollable(el, win)) return
    seen.add(el)
    scrollables.push(el)
  }

  let node: HTMLElement | null = viewport
  while (node) {
    add(node)
    node = node.parentElement
  }

  const tailRoot = viewport.closest(".react-resizable") as HTMLElement | null
  if (tailRoot) {
    for (const el of Array.from(tailRoot.querySelectorAll("*"))) {
      if (el instanceof HTMLElement) add(el)
    }
  }

  return scrollables
}

/** True when this element or a flex ancestor up to the tail root uses column-reverse. */
function isInColumnReverseFlex(el: HTMLElement, tailRoot: HTMLElement | null, win: Window): boolean {
  let node: HTMLElement | null = el
  while (node && node !== tailRoot?.parentElement) {
    const flexDirection = win.getComputedStyle(node).flexDirection
    if (flexDirection === "column-reverse") return true
    node = node.parentElement
  }
  return false
}

/** scrollTop that shows the start of content (tab bar / table headers) in this container. */
function setScrollableVisualTop(el: HTMLElement, win: Window, tailRoot: HTMLElement | null): void {
  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
  if (maxScroll <= 0) return
  if (isInColumnReverseFlex(el, tailRoot, win)) {
    el.scrollTop = maxScroll
  } else {
    el.scrollTop = 0
  }
}

/** Reset every tail scroll container so content starts at the top. */
function setAllTailScrollToVisualTop(pid: number): void {
  try {
    const doc = eval("document") as Document
    const viewport = doc.querySelector(`[${SCRIPT_LOG_PID_ATTR}="${pid}"]`) as HTMLElement | null
    if (!viewport) return
    const win = eval("window") as Window
    const tailRoot = viewport.closest(".react-resizable") as HTMLElement | null

    for (const el of collectTailScrollables(viewport, win)) {
      setScrollableVisualTop(el, win, tailRoot)
    }

    viewport.firstElementChild?.scrollIntoView({ block: "start", inline: "nearest" })
    viewport.scrollIntoView({ block: "start", inline: "nearest" })
    lastScrollTopByPid.set(pid, 0)
  } catch {
    // ignore
  }
}

function tabbedPanelHeightPx(layout: TableLayout): number | undefined {
  if (layout.tailViewportMaxHeightPx == null) return undefined
  return Math.max(40, layout.tailViewportMaxHeightPx - estimateTabBarHeightPx(layout))
}

/** Enforce tabbed chrome in the live tail DOM (tab switch resize without full re-render). */
function applyTabbedTailChrome(pid: number, layout: TableLayout): void {
  if (layout.tailTabbed !== true || layout.tailViewportMaxHeightPx == null) return
  try {
    const doc = eval("document") as Document
    const viewport = doc.querySelector(`[${SCRIPT_LOG_PID_ATTR}="${pid}"]`) as HTMLElement | null
    if (!viewport) return
    const contentAreaH = layout.tailViewportMaxHeightPx
    viewport.style.height = `${contentAreaH}px`
    viewport.style.maxHeight = `${contentAreaH}px`
    viewport.style.overflowY = "hidden"

    const panel = findTabbedPanelScrollEl(viewport)
    const panelH = tabbedPanelHeightPx(layout)
    if (panel && panelH != null) {
      panel.style.height = `${panelH}px`
      panel.style.maxHeight = `${panelH}px`
      panel.style.overflowY = "auto"
    }

    const tabbedRoot = panel?.parentElement
    if (tabbedRoot instanceof HTMLElement) {
      tabbedRoot.style.display = "flex"
      tabbedRoot.style.flexDirection = "column"
      tabbedRoot.style.height = `${contentAreaH}px`
      tabbedRoot.style.maxHeight = `${contentAreaH}px`
      tabbedRoot.style.overflow = "hidden"
      tabbedRoot.style.boxSizing = "border-box"
    }
  } catch {
    // ignore
  }
}

function scrollTabbedPanelAfterLayout(pid: number, layout: TableLayout): void {
  const win = eval("window") as Window
  const tabId = layout.tailActiveTabId
  const tick = (): void => {
    applyTabbedTailChrome(pid, layout)
    restoreTabbedPanelScroll(pid, tabId)
  }
  tick()
  win.requestAnimationFrame(() => {
    tick()
    win.requestAnimationFrame(tick)
  })
}

/**
 * Resize the script tail window from the live DOM (no Netscript APIs).
 * Used on tab clicks so the window resizes immediately without waiting for the main loop.
 */
function applyDomTailWindowSize(pid: number, layout: TableLayout): void {
  primeChWidthPx(layout.fontSizePx)
  primeTailLogChrome(layout)
  const renderLayout = layoutForTailRender({ ...layout, tailScriptPid: pid })
  const next = resolveTailSize(renderLayout)
  try {
    const doc = eval("document") as Document
    const viewport = doc.querySelector(`[${SCRIPT_LOG_PID_ATTR}="${pid}"]`) as HTMLElement | null
    if (!viewport) return
    const tailRoot = viewport.closest(".react-resizable") as HTMLElement | null
    if (tailRoot) {
      tailRoot.style.width = `${next.width}px`
      tailRoot.style.height = `${next.height}px`
    }
    lastTailSizeByPid.set(pid, next)
    applyTabbedTailChrome(pid, renderLayout)
  } catch {
    // ignore
  }
}

function syncTabbedTailLayoutDom(pid: number, layout: TableLayout): void {
  applyDomTailWindowSize(pid, layout)
  scrollTabbedPanelAfterLayout(pid, layout)
}

function scrollTailToTopAfterLayout(pid: number, layout?: TableLayout): void {
  if (layout?.tailTabbed) {
    scrollTabbedPanelAfterLayout(pid, layout)
    return
  }
  const win = eval("window") as Window
  const tick = (): void => setAllTailScrollToVisualTop(pid)
  tick()
  win.requestAnimationFrame(() => {
    tick()
    win.requestAnimationFrame(tick)
  })
}

/** Parsed from Bitburner logs panel `height: calc(100% - Npx)` (see script tail DOM). */
const LOGS_HEIGHT_CALC_RE = /calc\(\s*100%\s*-\s*(\d+(?:\.\d+)?)px\s*\)/i

function defaultTailTitleBarPx(layout: TableLayout): number {
  return layout.tailTitleBarPx
}

function getTailTitleBarPx(layout: TableLayout): number {
  return cachedTailTitleBarPx ?? defaultTailTitleBarPx(layout)
}

/** Read N from any tail logs panel `calc(100% - Npx)` — same chrome for every script window. */
function probeBitburnerTitleBarPx(): number | null {
  try {
    const doc = eval("document") as Document
    for (const el of Array.from(doc.querySelectorAll("div"))) {
      const match = LOGS_HEIGHT_CALC_RE.exec(el.style.height)
      if (match) {
        const px = Math.round(parseFloat(match[1]))
        if (px >= 24 && px <= 56) return px
      }
    }
  } catch {
    // ignore
  }
  return null
}

/** Prime title bar from Bitburner tail DOM (calc(100% - Npx)) before first render when possible. */
function primeTailLogChrome(layout: TableLayout): void {
  const probed = probeBitburnerTitleBarPx()
  if (probed != null) {
    cachedTailTitleBarPx = probed
  } else if (cachedTailTitleBarPx == null) {
    cachedTailTitleBarPx = defaultTailTitleBarPx(layout)
  }
}

interface ViewportShellProps {
  layout: TableLayout
  children: ReactNode
}

/** Restores scroll after redraw; first open pins column-reverse tails to content start. */
function ViewportShell(props: ViewportShellProps): ReactNode {
  const React = getReact()
  const { children } = props
  const [containerEl, setContainerEl] = React.useState<HTMLElement | null>(null)

  React.useEffect(() => {
    if (!containerEl) return
    const win = eval("window") as Window
    const syncScroll = (): void => {
      applyTailScrollPosition(containerEl, props.layout.tailScriptPid, props.layout.tailActiveTabId)
    }
    syncScroll()
    const frame = win.requestAnimationFrame(syncScroll)
    return () => win.cancelAnimationFrame(frame)
  }, [containerEl, props.layout.tailViewportMaxHeightPx, props.layout.tailScriptPid, props.layout.tailActiveTabId])

  const viewportMax = props.layout.tailViewportMaxHeightPx
  const pid = props.layout.tailScriptPid
  const tabbed = props.layout.tailTabbed === true
  return React.createElement(
    "div",
    {
      [SCRIPT_LOG_VIEWPORT_ATTR]: "",
      ...(pid != null ? { [SCRIPT_LOG_PID_ATTR]: String(pid) } : {}),
      ref: (node: unknown) => {
        const el = node as HTMLElement | null
        setContainerEl((prev) => (prev === el ? prev : el))
      },
      style: {
        display: "block",
        margin: "0",
        padding: "0",
        width: "max-content",
        boxSizing: "border-box",
        overflowX: "auto",
        overflowAnchor: "none",
        ...(tabbed && viewportMax != null
          ? { height: `${viewportMax}px`, maxHeight: `${viewportMax}px`, overflowY: "hidden" }
          : viewportMax != null
            ? { maxHeight: `${viewportMax}px`, overflowY: "auto" }
            : {}),
      },
    },
    children
  )
}

function buildViewportShell(content: ReactNode, layout: TableLayout): ReactNode {
  const React = getReact()
  return React.createElement(ViewportShell, { layout, children: content })
}

function resolveTailWidth(layout: TableLayout): { width: number; capped: boolean; maxWidth: number; padded: number } {
  const win = eval("window") as Window
  const contentWidth = layout.tailTableWidthPx ?? layout.tableWidthPx
  const maxWidth = layout.tailMaxWidthPx ?? Math.floor(win.innerWidth * 0.95)
  const floor = layout.tailWidthPx ?? 0
  const padded = Math.ceil(contentWidth)
  const uncapped = Math.max(floor, padded)
  const capped = uncapped > maxWidth
  return { width: capped ? maxWidth : uncapped, capped, maxWidth, padded: uncapped }
}

function resolveTailMaxHeight(layout: TableLayout): number {
  const win = eval("window") as Window
  return layout.tailMaxHeightPx ?? win.innerHeight
}

/** Tail window size from ch/row estimates (stable across redraws and restarts). */
export function resolveTailSize(layout?: Partial<TableLayout>): {
  width: number
  height: number
  viewportMaxHeightPx?: number
} {
  const merged = mergeLayout(layout)
  const contentHeight = merged.tailContentHeightPx ?? 0
  const titleBarPx = getTailTitleBarPx(merged)
  const naturalTotal = titleBarPx + contentHeight
  const maxTotal = resolveTailMaxHeight(merged)
  const height = Math.min(merged.tailHeightPx ?? naturalTotal, maxTotal)
  const scrollable = naturalTotal > maxTotal
  return {
    width: resolveTailWidth(merged).width,
    height,
    viewportMaxHeightPx: scrollable ? Math.max(40, height - titleBarPx) : undefined,
  }
}

/** Merge capped tail dimensions for resizeTail + scrollable viewport. */
export function layoutForTailRender(layout?: Partial<TableLayout>): TableLayout {
  const base = mergeLayout(layout)
  const sized = resolveTailSize(base)
  const titleBarPx = getTailTitleBarPx(base)
  const contentAreaH = Math.max(40, sized.height - titleBarPx)
  const viewportMaxHeightPx = base.tailTabbed ? contentAreaH : sized.viewportMaxHeightPx
  return mergeLayout({
    ...base,
    tailHeightPx: sized.height,
    tailViewportMaxHeightPx: viewportMaxHeightPx,
  })
}

function isScriptDeathError(error: unknown): boolean {
  return error instanceof Error && error.name === "ScriptDeath"
}

export function applyTailSize(ns: NS, layout?: Partial<TableLayout>): void {
  syncTailSize(ns, layoutForTailRender(mergeLayout(layout)))
}

export interface CellStyleState {
  highlight?: boolean
  selectedRow?: boolean
  activeHeader?: boolean
  isHeader?: boolean
}

function baseCellStyle(
  layout: TableLayout,
  rowHeightPx: number,
  borderColor: string,
  state: CellStyleState
): Record<string, string> {
  const { highlight = false, selectedRow = false, activeHeader = false, isHeader = false } = state
  let backgroundColor = "transparent"
  if (highlight) {
    backgroundColor = HIGHLIGHT_BG
  } else if (selectedRow) {
    backgroundColor = SELECTED_ROW_BG
  } else if (isHeader) {
    backgroundColor = activeHeader ? ACTIVE_HEADER_BG : HEADER_BG
  }

  return {
    boxSizing: "border-box",
    height: `${rowHeightPx}px`,
    lineHeight: `${layout.fontSizePx}px`,
    padding: `0 ${CELL_HORIZONTAL_PAD_CH}ch`,
    border: `${layout.borderPx}px solid ${borderColor}`,
    fontSize: `${layout.fontSizePx}px`,
    verticalAlign: "middle",
    backgroundColor,
    whiteSpace: "nowrap",
    ...TAIL_EMOJI_TEXT_STYLE,
  }
}

export function cellStyle(layout: TableLayout, state: CellStyleState, align: Alignment = "left"): Record<string, string> {
  return {
    ...baseCellStyle(layout, layout.bodyRowHeightPx, BODY_BORDER, state),
    textAlign: align,
  }
}

export function headerCellStyle(layout: TableLayout, activeHeader = false): Record<string, string> {
  return {
    ...baseCellStyle(layout, layout.headerRowHeightPx, HEADER_BORDER, { isHeader: true, activeHeader }),
    fontWeight: "bold",
  }
}

/** Horizontal inset per cell side; column width includes both sides. */
const CELL_HORIZONTAL_PAD_CH = 0.5

/** Fallback px-per-ch when the tail font metric is not cached yet (RAM calc, etc.). */
const CH_WIDTH_FALLBACK_RATIO = 0.6

const chWidthPxByFontSize = new Map<number, number>()

/** Measured CSS ch width (may be fractional); primed in initScriptLogTail. */
function getChWidthPx(fontSizePx: number): number {
  const cached = chWidthPxByFontSize.get(fontSizePx)
  if (cached != null) return cached
  return fontSizePx * CH_WIDTH_FALLBACK_RATIO
}

/** Whole-pixel ch width for column sizing: integer ch count x integer px/ch. */
function getWholeChWidthPx(fontSizePx: number): number {
  return Math.round(getChWidthPx(fontSizePx))
}

/** Prime ch width cache when the tail opens so column px widths match cell padding in ch. */
function primeChWidthPx(fontSizePx: number): void {
  if (chWidthPxByFontSize.has(fontSizePx)) return

  try {
    const doc = eval("document") as Document
    const probe = doc.createElement("div")
    probe.style.position = "absolute"
    probe.style.visibility = "hidden"
    probe.style.pointerEvents = "none"
    probe.style.fontFamily = "monospace"
    probe.style.fontSize = `${fontSizePx}px`
    probe.style.width = "1ch"
    probe.style.height = "1px"
    doc.body.appendChild(probe)
    const chPx = probe.getBoundingClientRect().width
    doc.body.removeChild(probe)
    if (chPx > 0) {
      chWidthPxByFontSize.set(fontSizePx, chPx)
    }
  } catch {
    // keep fallback
  }
}

/** Monospace column width in whole characters (content + horizontal pad on both sides). */
function computeColumnWidthsCh(config: TableConfig): number[] {
  return config.columns.map((col, colIdx) => {
    let maxChars = col.header.length
    for (const row of config.rows) {
      if (row[colIdx]) maxChars = Math.max(maxChars, row[colIdx].length)
    }
    const contentChars = Math.max(maxChars, col.minWidth ?? 0)
    return contentChars + CELL_HORIZONTAL_PAD_CH * 2
  })
}

/** Whole-pixel column width: integer ch x integer px/ch (same value used in colgroup). */
function columnWidthChToPx(widthCh: number, layout: TableLayout): number {
  return widthCh * getWholeChWidthPx(layout.fontSizePx)
}

/** Per-column px widths for colgroup and tail sizing (single source of truth). */
function computeColumnWidthsPx(widthsCh: number[], layout: TableLayout): number[] {
  return widthsCh.map((widthCh) => columnWidthChToPx(widthCh, layout))
}

function sumColumnWidthsPx(widthsPx: number[]): number {
  return widthsPx.reduce((sum, px) => sum + px, 0)
}

/** Table content width in px from column ch widths (matches rendered colgroup). */
function columnWidthsChToPx(widthsCh: number[], layout: TableLayout): number {
  return sumColumnWidthsPx(computeColumnWidthsPx(widthsCh, layout))
}

function computeStringWidthPx(text: string, layout: TableLayout): number {
  return text.length * getWholeChWidthPx(layout.fontSizePx)
}

/** Sum of colgroup ch widths (same function buildReactTable uses for columns). */
export function computeTableWidthCh(config: TableConfig): number {
  return computeColumnWidthsCh(config).reduce((sum, ch) => sum + ch, 0)
}

/** Tail width in px from the same ch column widths as the rendered table. */
export function computeReactTableWidthPx(config: TableConfig, layout?: Partial<TableLayout>): number {
  const merged = mergeLayout(layout)
  const colPx = columnWidthsChToPx(computeColumnWidthsCh(config), merged)
  const title = config.title
  if (title) {
    return Math.max(colPx, computeStringWidthPx(`=== ${title} ===`, merged))
  }
  return colPx
}

/** @deprecated Use computeReactTableWidthPx */
export function estimateReactTableWidthPx(config: ReactTableConfig, layout?: Partial<TableLayout>): number {
  return computeReactTableWidthPx(config, layout)
}

function estimateTextWidthPx(message: string, layout: TableLayout): number {
  const maxChars = message.split("\n").reduce((max, line) => Math.max(max, line.length), 0)
  return maxChars * getChWidthPx(layout.fontSizePx)
}

/** Line box for pre/title blocks — matches lineHeight set in buildTextBlock / buildReactTable. */
function textLineBoxPx(layout: TableLayout): number {
  return layout.fontSizePx + 4
}

function estimateTitleBlockHeightPx(title: string, layout: TableLayout, contentWidthPx: number): number {
  const titleText = `=== ${title} ===`
  const titleWidthPx = computeStringWidthPx(titleText, layout)
  const lines = Math.max(1, Math.ceil(titleWidthPx / Math.max(1, contentWidthPx)))
  return lines * textLineBoxPx(layout) + 4
}

export function estimateReactTableHeightPx(
  config: ReactTableConfig,
  layout?: Partial<TableLayout>,
  contentWidthPx?: number
): number {
  const merged = mergeLayout(config.layout ?? layout)
  let height = merged.headerRowHeightPx + config.rows.length * merged.bodyRowHeightPx
  if (config.separatorAfter?.length) {
    height += config.separatorAfter.length
  }
  if (config.title) {
    height += estimateTitleBlockHeightPx(config.title, merged, contentWidthPx ?? merged.tableWidthPx)
  }
  return height
}

function estimateTextHeightPx(message: string, layout: TableLayout, contentWidthPx: number): number {
  const lines = message.split("\n")
  let totalLines = 0
  for (const line of lines) {
    const lineWidthPx = computeStringWidthPx(line, layout)
    totalLines += Math.max(1, Math.ceil(lineWidthPx / Math.max(1, contentWidthPx)))
  }
  return totalLines * textLineBoxPx(layout)
}

const EMPTY_TAB_PLACEHOLDER = "(no content yet)"

function estimateTabChipHeightPx(layout: TableLayout): number {
  return 4 + textLineBoxPx(layout) + 4 + layout.borderPx * 2
}

function estimateEmptyTabPanelHeightPx(layout: TableLayout, contentWidthPx: number): number {
  return estimateTextHeightPx(EMPTY_TAB_PLACEHOLDER, layout, contentWidthPx) + 4
}

function estimateEmptyTabPanelWidthPx(layout: TableLayout): number {
  return estimateTextWidthPx(EMPTY_TAB_PLACEHOLDER, layout)
}

function estimateTabLabelWidthPx(label: string, layout: TableLayout): number {
  return label.length * getChWidthPx(layout.fontSizePx) + layout.paddingXPx * 2 + layout.borderPx * 2
}

function estimateTabBarHeightPx(layout: TableLayout): number {
  return estimateTabChipHeightPx(layout) + layout.sectionGapPx
}

function keyValueToReactTableConfig(config: KeyValueTableConfig): ReactTableConfig {
  const { rows, title, separatorAfter = [], valueAlign = "right" } = config
  return {
    title,
    columns: [
      { header: "", align: "left" },
      { header: "", align: valueAlign },
    ],
    rows: rows.map((r) => [r.label, r.value]),
    separatorAfter,
  }
}

function threeColumnToReactTableConfig(config: ThreeColumnTableConfig): ReactTableConfig {
  const { headers, rows, title, separatorAfter = [], align = ["left", "right", "right"] } = config
  return {
    title,
    columns: [
      { header: headers[0], align: align[0] },
      { header: headers[1], align: align[1] },
      { header: headers[2], align: align[2] },
    ],
    rows,
    separatorAfter,
  }
}

export interface ReactTableConfig extends TableConfig {
  layout?: Partial<TableLayout>
  selectedRowIndex?: number
  highlightCells?: ReadonlySet<string>
  activeHeaderColumns?: ReadonlySet<number>
}

export function buildReactTable(config: ReactTableConfig): ReactNode {
  const React = getReact()
  const layout = mergeLayout(config.layout)
  const { columns, rows, title, separatorAfter = [] } = config
  const colWidthsPx = computeColumnWidthsPx(computeColumnWidthsCh(config), layout)
  const alignments = columns.map((col, idx) => col.align ?? (idx === 0 ? "left" : "right"))

  const headerCells = columns.map((col, idx) =>
    React.createElement(
      "th",
      {
        key: `h-${idx}`,
        style: headerCellStyle(layout, config.activeHeaderColumns?.has(idx) ?? false),
      },
      tailDisplayText(col.header)
    )
  )

  const bodyRows = rows.map((row, rowIdx) => {
    const selectedRow = config.selectedRowIndex === rowIdx
    const hasSeparator = separatorAfter.includes(rowIdx)
    const cells = row.map((cell, colIdx) => {
      const highlight = config.highlightCells?.has(`${rowIdx},${colIdx}`) ?? false
      const style = cellStyle(layout, { highlight, selectedRow }, alignments[colIdx])
      if (hasSeparator) {
        style.borderBottom = `2px solid ${HEADER_BORDER}`
      }
      return React.createElement(
        "td",
        {
          key: `c-${rowIdx}-${colIdx}`,
          style,
        },
        tailDisplayText(cell ?? "")
      )
    })

    return React.createElement("tr", { key: `r-${rowIdx}` }, ...cells)
  })

  const colgroup = React.createElement(
    "colgroup",
    null,
    ...colWidthsPx.map((widthPx, idx) =>
      React.createElement("col", {
        key: `col-${idx}`,
        style: { width: `${widthPx}px` },
      })
    )
  )

  const table = React.createElement(
    "table",
    {
      style: {
        borderCollapse: "collapse",
        tableLayout: "fixed",
        width: "max-content",
        margin: "0",
        fontFamily: "monospace",
        fontSize: `${layout.fontSizePx}px`,
        ...TAIL_EMOJI_TEXT_STYLE,
      },
    },
    colgroup,
    React.createElement("thead", null, React.createElement("tr", null, ...headerCells)),
    React.createElement("tbody", null, ...bodyRows)
  )

  if (!title) return table

  return React.createElement(
    "div",
    { style: { display: "block", margin: "0", padding: "0" } },
    React.createElement(
      "div",
      {
        style: {
          fontFamily: "monospace",
          fontSize: `${layout.fontSizePx}px`,
          lineHeight: `${textLineBoxPx(layout)}px`,
          marginBottom: "4px",
          fontWeight: "bold",
          ...TAIL_EMOJI_TEXT_STYLE,
        },
      },
      tailDisplayText(`=== ${title} ===`)
    ),
    table
  )
}

export function buildReactKeyValueTable(config: KeyValueTableConfig & Pick<ReactTableConfig, "layout">): ReactNode {
  return buildReactTable({ layout: config.layout, ...keyValueToReactTableConfig(config) })
}

export function buildReactThreeColumnTable(config: ThreeColumnTableConfig & Pick<ReactTableConfig, "layout">): ReactNode {
  return buildReactTable({ layout: config.layout, ...threeColumnToReactTableConfig(config) })
}

export interface TreeTableRow {
  id: string
  parentId: string | null
  label: string
  cells: string[]
  highlight?: boolean
}

export interface TreeTableConfig {
  layout?: Partial<TableLayout>
  title?: string
  treeColumnHeader?: string
  treeMinWidth?: number
  columns: ColumnConfig[]
  rows: TreeTableRow[]
  rootIds?: string[]
  /** One tbody row: column headers in thead, all data lines in a single merged cell. */
  singleBodyRow?: boolean
}

const TREE_PIPE = "\u2502  "
const TREE_GAP = "   "
const TREE_BRANCH = "\u251c\u2500\u2500 "
const TREE_LAST = "\u2514\u2500\u2500 "

interface FlatTreeRow {
  row: TreeTableRow
  depth: number
  flatIndex: number
  treePrefix: string
}

function formatTreePrefix(ancestorHasMore: boolean[], isLast: boolean): string {
  let prefix = ""
  for (const hasMore of ancestorHasMore) {
    prefix += hasMore ? TREE_PIPE : TREE_GAP
  }
  prefix += isLast ? TREE_LAST : TREE_BRANCH
  return prefix
}

function formatTreeCellLabel(label: string, treePrefix: string): string {
  return treePrefix + label
}

function flattenTreeRows(rows: TreeTableRow[], rootIds?: string[]): FlatTreeRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const children = new Map<string, TreeTableRow[]>()

  for (const row of rows) {
    const pid = row.parentId
    if (pid != null && byId.has(pid)) {
      const list = children.get(pid) ?? []
      list.push(row)
      children.set(pid, list)
    }
  }

  let roots: string[]
  if (rootIds && rootIds.length > 0) {
    roots = rootIds.filter((id) => byId.has(id))
  } else {
    roots = rows
      .filter((row) => row.parentId == null || !byId.has(row.parentId))
      .map((row) => row.id)
    roots.sort((a, b) => {
      if (a === "darkweb") return -1
      if (b === "darkweb") return 1
      return a.localeCompare(b)
    })
  }

  const out: FlatTreeRow[] = []
  const visited = new Set<string>()
  let flatIndex = 0

  function walk(id: string, depth: number, ancestorHasMore: boolean[], isLast: boolean): void {
    if (visited.has(id)) return
    const row = byId.get(id)
    if (!row) return
    visited.add(id)
    const treePrefix = depth === 0 ? "" : formatTreePrefix(ancestorHasMore, isLast)
    out.push({ row, depth, flatIndex: flatIndex++, treePrefix })
    const kids = (children.get(id) ?? []).slice().sort((a, b) => a.label.localeCompare(b.label))
    const nextAncestors = depth === 0 ? [] : [...ancestorHasMore, !isLast]
    for (let i = 0; i < kids.length; i++) {
      walk(kids[i].id, depth + 1, nextAncestors, i === kids.length - 1)
    }
  }

  for (const root of roots) {
    walk(root, 0, [], true)
  }
  for (const row of rows) {
    if (!visited.has(row.id)) {
      walk(row.id, 0, [], true)
    }
  }
  return out
}

/** Longest Host tree cell (prefix + label) for the given rows. */
export function measureTreeTableHostChars(
  rows: TreeTableRow[],
  rootIds?: string[]
): number {
  const flat = flattenTreeRows(rows, rootIds)
  if (flat.length === 0) {
    return 0
  }
  return Math.max(...flat.map(({ row, treePrefix }) => formatTreeCellLabel(row.label, treePrefix).length))
}

function multilineBodyCellStyle(layout: TableLayout, align: Alignment): Record<string, string> {
  return {
    ...cellStyle(layout, {}, align),
    whiteSpace: "pre",
    height: "auto",
    lineHeight: `${textLineBoxPx(layout)}px`,
    verticalAlign: "top",
  }
}

function columnCellLines(bodyRows: string[][], colIdx: number): string {
  return bodyRows.map((row) => tailDisplayText(row[colIdx] ?? "")).join("\n")
}

function treeTableColumnsAndRows(config: TreeTableConfig): {
  flat: FlatTreeRow[]
  columns: ColumnConfig[]
  preRows: string[][]
  reactRows: string[][]
} {
  const flat = flattenTreeRows(config.rows, config.rootIds)
  const treeMin = config.treeMinWidth ?? 16
  const hostLengths = flat.map(({ row, treePrefix }) => formatTreeCellLabel(row.label, treePrefix).length)
  const maxTreeChars = Math.max(treeMin, ...(hostLengths.length > 0 ? hostLengths : [0]))
  const columns: ColumnConfig[] = [
    { header: config.treeColumnHeader ?? "Host", align: "left", minWidth: maxTreeChars },
    ...config.columns,
  ]
  const preRows: string[][] = []
  const reactRows: string[][] = []
  for (const { row, treePrefix } of flat) {
    const host = formatTreeCellLabel(row.label, treePrefix)
    preRows.push([(row.highlight ? ">" : " ") + host, ...row.cells])
    reactRows.push([host, ...row.cells])
  }
  return { flat, columns, preRows, reactRows }
}

function buildSingleRowTreeTable(
  config: TreeTableConfig,
  columns: ColumnConfig[],
  preRows: string[][],
  flat: FlatTreeRow[]
): ReactNode {
  const React = getReact()
  const layout = mergeLayout(config.layout)
  const tableConfig: ReactTableConfig = { columns, rows: preRows }
  const colWidthsPx = computeColumnWidthsPx(computeColumnWidthsCh(tableConfig), layout)
  const alignments = columns.map((col, idx) => col.align ?? (idx === 0 ? "left" : "right"))
  const activeHeaderColumns = new Set<number>()
  const hasActive = flat.some(({ row }) => row.highlight)
  if (hasActive) {
    const actColIdx = columns.findIndex((col) => col.header === "Act")
    if (actColIdx >= 0) activeHeaderColumns.add(actColIdx)
  }

  const headerCells = columns.map((col, idx) =>
    React.createElement(
      "th",
      {
        key: `h-${idx}`,
        style: headerCellStyle(layout, activeHeaderColumns.has(idx)),
      },
      tailDisplayText(col.header)
    )
  )

  const bodyCells = columns.map((col, colIdx) =>
    React.createElement(
      "td",
      {
        key: `merged-c-${colIdx}`,
        style: multilineBodyCellStyle(layout, alignments[colIdx]),
      },
      columnCellLines(preRows, colIdx)
    )
  )

  const bodyRow = React.createElement("tr", { key: "merged-body" }, ...bodyCells)

  const colgroup = React.createElement(
    "colgroup",
    null,
    ...colWidthsPx.map((widthPx, idx) =>
      React.createElement("col", {
        key: `col-${idx}`,
        style: { width: `${widthPx}px` },
      })
    )
  )

  const table = React.createElement(
    "table",
    {
      style: {
        borderCollapse: "collapse",
        tableLayout: "fixed",
        width: "max-content",
        margin: "0",
        fontFamily: "monospace",
        fontSize: `${layout.fontSizePx}px`,
        ...TAIL_EMOJI_TEXT_STYLE,
      },
    },
    colgroup,
    React.createElement("thead", null, React.createElement("tr", null, ...headerCells)),
    React.createElement("tbody", null, bodyRow)
  )

  if (!config.title) return table

  return React.createElement(
    "div",
    { style: { display: "block", margin: "0", padding: "0" } },
    React.createElement(
      "div",
      {
        style: {
          fontFamily: "monospace",
          fontSize: `${layout.fontSizePx}px`,
          lineHeight: `${textLineBoxPx(layout)}px`,
          marginBottom: "4px",
          fontWeight: "bold",
          ...TAIL_EMOJI_TEXT_STYLE,
        },
      },
      tailDisplayText(`=== ${config.title} ===`)
    ),
    table
  )
}

export function buildReactTreeTable(config: TreeTableConfig): ReactNode {
  const { flat, columns, preRows, reactRows } = treeTableColumnsAndRows(config)
  if (config.singleBodyRow) {
    return buildSingleRowTreeTable(config, columns, preRows, flat)
  }
  const highlightCells = new Set<string>()
  const activeHeaderColumns = new Set<number>()
  let hasActive = false
  flat.forEach(({ row }, rowIdx) => {
    if (!row.highlight) return
    hasActive = true
    for (let colIdx = 0; colIdx < columns.length; colIdx++) {
      highlightCells.add(`${rowIdx},${colIdx}`)
    }
  })
  if (hasActive) {
    const actColIdx = columns.findIndex((col) => col.header === "Act")
    if (actColIdx >= 0) activeHeaderColumns.add(actColIdx)
  }
  return buildReactTable({
    layout: config.layout,
    title: config.title,
    columns,
    rows: reactRows,
    highlightCells,
    activeHeaderColumns,
  })
}

export function estimateReactTreeTableWidthPx(config: TreeTableConfig, layout?: Partial<TableLayout>): number {
  const merged = mergeLayout(config.layout ?? layout)
  const { columns, preRows, reactRows } = treeTableColumnsAndRows(config)
  if (config.singleBodyRow) {
    let width = computeReactTableWidthPx({ columns, rows: preRows }, config.layout ?? layout)
    if (config.title) {
      width = Math.max(width, computeStringWidthPx(`=== ${config.title} ===`, merged))
    }
    return width
  }
  const tableConfig: ReactTableConfig = {
    layout: config.layout ?? layout,
    columns,
    rows: reactRows,
  }
  return computeReactTableWidthPx(tableConfig, config.layout ?? layout)
}

export function estimateReactTreeTableHeightPx(
  config: TreeTableConfig,
  layout?: Partial<TableLayout>,
  contentWidthPx?: number
): number {
  const merged = mergeLayout(config.layout ?? layout)
  const { columns, preRows, reactRows } = treeTableColumnsAndRows(config)
  if (config.singleBodyRow) {
    let height = merged.headerRowHeightPx + preRows.length * textLineBoxPx(merged) + 4
    if (config.title) {
      height += estimateTitleBlockHeightPx(config.title, merged, contentWidthPx ?? merged.tableWidthPx)
    }
    return height
  }
  let height = merged.headerRowHeightPx + reactRows.length * merged.bodyRowHeightPx
  if (config.title) {
    height += estimateTitleBlockHeightPx(config.title, merged, contentWidthPx ?? merged.tableWidthPx)
  }
  return height
}

export function buildSectionHeader(title: string, layout?: Partial<TableLayout>): ReactNode {
  const React = getReact()
  const merged = mergeLayout(layout)
  return React.createElement(
    "div",
    {
      style: {
        fontFamily: "monospace",
        fontSize: `${merged.fontSizePx}px`,
        lineHeight: `${textLineBoxPx(merged)}px`,
        fontWeight: "bold",
        margin: `${merged.sectionGapPx}px 0 4px 0`,
        ...TAIL_EMOJI_TEXT_STYLE,
      },
    },
    tailDisplayText(`=== ${title} ===`)
  )
}

export function buildTextBlock(text: string, layout?: Partial<TableLayout>): ReactNode {
  const React = getReact()
  const merged = mergeLayout(layout)
  return React.createElement(
    "pre",
    {
      style: {
        fontFamily: "monospace",
        fontSize: `${merged.fontSizePx}px`,
        lineHeight: `${textLineBoxPx(merged)}px`,
        margin: "0 0 4px 0",
        padding: "0",
        whiteSpace: "pre-wrap",
        ...TAIL_EMOJI_TEXT_STYLE,
      },
    },
    tailDisplayText(text)
  )
}

export function buildStack(children: ReactNode[], layout?: Partial<TableLayout>): ReactNode {
  const React = getReact()
  const merged = mergeLayout(layout)
  return React.createElement(
    "div",
    {
      style: {
        display: "block",
        margin: "0",
        padding: "0",
        fontFamily: "monospace",
        fontSize: `${merged.fontSizePx}px`,
        ...TAIL_EMOJI_TEXT_STYLE,
      },
    },
    ...children
  )
}

type LogSection =
  | { kind: "text"; message: string }
  | { kind: "section"; title: string }
  | { kind: "table"; config: ReactTableConfig }
  | { kind: "treeTable"; config: TreeTableConfig }
  | { kind: "keyValue"; config: KeyValueTableConfig }
  | { kind: "threeColumn"; config: ThreeColumnTableConfig }
  | { kind: "react"; node: ReactNode; widthPx?: number; heightPx?: number }

export type ReactSectionSize = {
  widthPx?: number
  heightPx?: number
}

function sectionBottomMarginPx(section: LogSection): number {
  switch (section.kind) {
    case "text":
    case "section":
      return 4
    case "table":
    case "treeTable":
    case "keyValue":
    case "threeColumn":
      return 0
    case "react":
      return 0
  }
}

function logSectionMaxWidthPx(section: LogSection, layout?: Partial<TableLayout>): number {
  const merged = mergeLayout(layout)
  switch (section.kind) {
    case "text":
      return estimateTextWidthPx(section.message, merged)
    case "section":
      return computeStringWidthPx(`=== ${section.title} ===`, merged)
    case "table":
      return computeReactTableWidthPx({ layout, ...section.config }, layout)
    case "treeTable":
      return estimateReactTreeTableWidthPx(section.config, layout)
    case "keyValue":
      return computeReactTableWidthPx(keyValueToReactTableConfig(section.config), layout)
    case "threeColumn":
      return computeReactTableWidthPx(threeColumnToReactTableConfig(section.config), layout)
    case "react":
      return section.widthPx ?? merged.tableWidthPx
    default:
      return 0
  }
}

function logSectionHeightPx(section: LogSection, merged: TableLayout, contentWidthPx: number): number {
  switch (section.kind) {
    case "text":
      return estimateTextHeightPx(section.message, merged, contentWidthPx)
    case "section":
      return merged.sectionGapPx + estimateTitleBlockHeightPx(section.title, merged, contentWidthPx)
    case "table":
      return estimateReactTableHeightPx({ layout: merged, ...section.config }, merged, contentWidthPx)
    case "treeTable":
      return estimateReactTreeTableHeightPx({ layout: merged, ...section.config }, merged, contentWidthPx)
    case "keyValue":
      return estimateReactTableHeightPx(
        { layout: merged, ...keyValueToReactTableConfig(section.config) },
        merged,
        contentWidthPx
      )
    case "threeColumn":
      return estimateReactTableHeightPx(
        { layout: merged, ...threeColumnToReactTableConfig(section.config) },
        merged,
        contentWidthPx
      )
    case "react":
      return section.heightPx ?? merged.bodyRowHeightPx
  }
}

export class ScriptLogBuilder {
  private sections: LogSection[] = []
  private layout?: Partial<TableLayout>

  constructor(layout?: Partial<TableLayout>) {
    this.layout = layout
  }

  reset(): this {
    this.sections = []
    return this
  }

  text(message: string): this {
    this.sections.push({ kind: "text", message })
    return this
  }

  section(title: string): this {
    this.sections.push({ kind: "section", title })
    return this
  }

  table(config: ReactTableConfig): this {
    this.sections.push({ kind: "table", config })
    return this
  }

  treeTable(config: TreeTableConfig): this {
    this.sections.push({ kind: "treeTable", config })
    return this
  }

  keyValueTable(config: KeyValueTableConfig): this {
    this.sections.push({ kind: "keyValue", config })
    return this
  }

  threeColumnTable(config: ThreeColumnTableConfig): this {
    this.sections.push({ kind: "threeColumn", config })
    return this
  }

  react(node: ReactNode, size?: ReactSectionSize): this {
    this.sections.push({ kind: "react", node, widthPx: size?.widthPx, heightPx: size?.heightPx })
    return this
  }

  /** Widest section width in px (same px colgroup widths as buildReactTable). */
  computeContentWidthPx(): number {
    const merged = mergeLayout(this.layout)
    let max = 0
    for (const section of this.sections) {
      max = Math.max(max, logSectionMaxWidthPx(section, this.layout))
    }
    return max > 0 ? Math.ceil(max) : merged.tableWidthPx
  }

  /** Tallest stacked content height in px (tables, text, section headers). */
  measureStackHeightPx(wrapWidthPx: number): number {
    const merged = mergeLayout(this.layout)
    let height = 0
    for (const section of this.sections) {
      height += logSectionHeightPx(section, merged, wrapWidthPx)
      height += sectionBottomMarginPx(section)
    }
    return height
  }

  estimateContentHeightPx(): number {
    const merged = mergeLayout(this.layout)
    const contentWidthPx = Math.max(1, this.computeContentWidthPx())
    const { width: tailWidthPx } = resolveTailWidth({ ...merged, tailTableWidthPx: contentWidthPx })
    return this.measureStackHeightPx(Math.max(1, tailWidthPx))
  }

  build(resolvedLayout?: TableLayout): ReactNode {
    const layout = resolvedLayout ?? mergeLayout(this.layout)
    const nodes = this.sections.map((section) => {
      switch (section.kind) {
        case "text":
          return buildTextBlock(section.message, layout)
        case "section":
          return buildSectionHeader(section.title, layout)
        case "table":
          return buildReactTable({ layout, ...section.config })
        case "treeTable":
          return buildReactTreeTable({ layout, ...section.config })
        case "keyValue":
          return buildReactKeyValueTable({ layout, ...section.config })
        case "threeColumn":
          return buildReactThreeColumnTable({ layout, ...section.config })
        case "react":
          return section.node
      }
    })
    return buildStack(nodes, layout)
  }

  isEmpty(): boolean {
    return this.sections.length === 0
  }

  /** Content and layout passed to renderScriptLog / floating DOM sinks. */
  prepareRender(ns?: NS): { content: ReactNode; layout: Partial<TableLayout> } {
    const contentWidthPx = this.computeContentWidthPx()
    const contentHeightPx = this.estimateContentHeightPx()
    return {
      content: this.build(),
      layout: {
        ...this.layout,
        tailTableWidthPx: contentWidthPx,
        tailContentHeightPx: contentHeightPx,
        tailScriptPid: ns?.pid,
      },
    }
  }

  render(ns: NS): Promise<void> {
    const { content, layout } = this.prepareRender(ns)
    return renderScriptLog(ns, content, layout)
  }
}

export interface TabDefinition {
  id: string
  label: string
}

export interface TabbedLogOptions {
  /**
   * Build React only for the active tab (faster refresh). Inactive tabs stay empty until
   * the next render with that tab selected — do not use when users click tabs between renders.
   */
  lazyInactivePanels?: boolean
}

/** Poll interval while waiting for a user tab switch to be handled by the main loop. */
const TAB_LAYOUT_REFRESH_POLL_MS = 100

/**
 * Sleep up to maxMs, returning early if the user switched tabs.
 * Netscript APIs must not run from React onClick — callers should re-render after this returns true.
 */
export async function sleepUntilTabLayoutRefresh(
  ns: NS,
  tabbedLog: TabbedScriptLogBuilder,
  maxMs: number
): Promise<boolean> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (tabbedLog.hasPendingLayoutRefresh()) {
      await tabbedLog.refreshLayoutIfPending(ns)
      return true
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await ns.sleep(Math.min(TAB_LAYOUT_REFRESH_POLL_MS, remaining))
  }
  if (tabbedLog.hasPendingLayoutRefresh()) {
    await tabbedLog.refreshLayoutIfPending(ns)
    return true
  }
  return false
}

interface TabbedLogViewProps {
  tabOrder: TabDefinition[]
  panels: Record<string, ReactNode>
  populatedTabIds: readonly string[]
  programmaticActiveId: string
  layout: TableLayout
  onTabChange?: (tabId: string) => void
  /** After the active tab panel paints, sync tail size from cached per-tab dimensions. */
  onActiveTabLayout?: (tabId: string) => void
}

/** Stateful tab UI — uses React hooks (no document/window DOM). Clicks may not work in all game versions. */
function TabbedLogView(props: TabbedLogViewProps): ReactNode {
  const React = getReact()
  const { tabOrder, panels, populatedTabIds, programmaticActiveId, layout, onTabChange, onActiveTabLayout } = props
  const populated = new Set(populatedTabIds)
  const [activeId, setActiveId] = React.useState(programmaticActiveId)
  const [panelEl, setPanelEl] = React.useState<HTMLElement | null>(null)

  React.useEffect(() => {
    setActiveId(programmaticActiveId)
  }, [programmaticActiveId])

  React.useEffect(() => {
    if (!onActiveTabLayout) return
    const win = eval("window") as Window
    let frame2 = 0
    const frame1 = win.requestAnimationFrame(() => {
      frame2 = win.requestAnimationFrame(() => {
        onActiveTabLayout(activeId)
      })
    })
    return () => {
      win.cancelAnimationFrame(frame1)
      if (frame2) win.cancelAnimationFrame(frame2)
    }
  }, [activeId, onActiveTabLayout])

  React.useEffect(() => {
    if (!panelEl || layout.tailScriptPid == null) return
    const pid = layout.tailScriptPid
    const onScroll = (): void => {
      writeTabbedPanelScroll(pid, activeId, panelEl.scrollTop)
    }
    panelEl.addEventListener("scroll", onScroll, { passive: true })
    return () => panelEl.removeEventListener("scroll", onScroll)
  }, [panelEl, activeId, layout.tailScriptPid])

  React.useEffect(() => {
    if (!panelEl) return
    const win = eval("window") as Window
    const syncScroll = (): void => {
      applyTailScrollPosition(panelEl, layout.tailScriptPid, activeId)
    }
    syncScroll()
    const frame = win.requestAnimationFrame(syncScroll)
    return () => win.cancelAnimationFrame(frame)
  }, [panelEl, layout.tailViewportMaxHeightPx, layout.tailScriptPid, activeId])

  const panelMaxHeight = tabbedPanelHeightPx(layout)

  const tabBar = React.createElement(
    "div",
    {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: "2px",
        marginBottom: `${layout.sectionGapPx}px`,
        flexShrink: "0",
        backgroundColor: TAB_BAR_BG,
      },
    },
    ...tabOrder.map(({ id, label }) => {
      const isActive = id === activeId
      const hasContent = populated.has(id)
      return React.createElement(
        "div",
        {
          key: id,
          onClick: () => {
            setActiveId(id)
            onTabChange?.(id)
          },
          style: {
            padding: `4px ${layout.paddingXPx}px`,
            fontFamily: "monospace",
            fontSize: `${layout.fontSizePx}px`,
            lineHeight: `${textLineBoxPx(layout)}px`,
            fontWeight: isActive ? "bold" : "normal",
            backgroundColor: isActive ? ACTIVE_HEADER_BG : hasContent ? "rgba(255, 255, 255, 0.06)" : "transparent",
            border: `${layout.borderPx}px solid ${HEADER_BORDER}`,
            opacity: hasContent || isActive ? 1 : 0.45,
            cursor: "pointer",
            userSelect: "none",
            ...TAIL_EMOJI_TEXT_STYLE,
          },
        },
        tailDisplayText(label)
      )
    })
  )

  const panelContent = panels[activeId] ?? buildTextBlock(EMPTY_TAB_PLACEHOLDER, layout)

  const panelScroll = React.createElement(
    "div",
    {
      [SCRIPT_LOG_PANEL_ATTR]: "",
      ref: (node: unknown) => {
        const el = node as HTMLElement | null
        setPanelEl((prev) => (prev === el ? prev : el))
      },
      style: {
        display: "block",
        margin: "0",
        padding: "0",
        flex: "1 1 auto",
        minHeight: "0",
        overflowX: "auto",
        overflowAnchor: "none",
        ...(panelMaxHeight != null
          ? {
              height: `${panelMaxHeight}px`,
              maxHeight: `${panelMaxHeight}px`,
              overflowY: "auto",
            }
          : {}),
      },
    },
    panelContent
  )

  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        margin: "0",
        padding: "0",
        fontFamily: "monospace",
        fontSize: `${layout.fontSizePx}px`,
        ...TAIL_EMOJI_TEXT_STYLE,
        boxSizing: "border-box",
        overflow: "hidden",
        ...(layout.tailViewportMaxHeightPx != null
          ? {
              height: `${layout.tailViewportMaxHeightPx}px`,
              maxHeight: `${layout.tailViewportMaxHeightPx}px`,
            }
          : {}),
      },
    },
    tabBar,
    panelScroll
  )
}

export class TabbedScriptLogBuilder {
  private builders = new Map<string, ScriptLogBuilder>()
  /** Content size per tab from the last build(); used for tab-switch resize. */
  private panelDimensions = new Map<string, { widthPx: number; heightPx: number }>()
  /** Tab shown in the UI; kept across re-renders when the user picks a tab. */
  private displayTabId: string
  private layout?: Partial<TableLayout>
  private readonly lazyInactivePanels: boolean
  private pendingLayoutRefresh = false
  private tailScriptPid?: number

  constructor(
    private tabOrder: TabDefinition[],
    layout?: Partial<TableLayout>,
    options?: TabbedLogOptions
  ) {
    this.layout = layout
    this.displayTabId = tabOrder[0]?.id ?? ""
    this.lazyInactivePanels = options?.lazyInactivePanels === true
  }

  reset(): this {
    this.builders.clear()
    this.panelDimensions.clear()
    this.displayTabId = this.tabOrder[0]?.id ?? ""
    return this
  }

  /** Clear tab panel content without changing the selected tab (for live-update loops). */
  clearPanels(): this {
    this.builders.clear()
    this.panelDimensions.clear()
    return this
  }

  /** Clear all tabs except the listed ids (e.g. keep "results" until the next cycle finishes). */
  clearPanelsExcept(keepTabIds: readonly string[]): this {
    const keep = new Set(keepTabIds)
    for (const id of this.builders.keys()) {
      if (!keep.has(id)) {
        this.builders.delete(id)
      }
    }
    for (const id of this.panelDimensions.keys()) {
      if (!keep.has(id)) {
        this.panelDimensions.delete(id)
      }
    }
    return this
  }

  setActiveTab(tabId: string): this {
    this.displayTabId = tabId
    return this
  }

  getActiveTabId(): string {
    return this.displayTabId
  }

  hasPendingLayoutRefresh(): boolean {
    return this.pendingLayoutRefresh
  }

  /** Re-render and resize for a user tab switch. Call from the script main loop only. */
  async refreshLayoutIfPending(ns: NS): Promise<boolean> {
    if (!this.pendingLayoutRefresh) return false
    this.pendingLayoutRefresh = false
    if (this.lazyInactivePanels) {
      if (this.tailScriptPid != null) {
        lastTailSizeByPid.delete(this.tailScriptPid)
      }
      await this.render(ns)
      return true
    }
    this.syncDomLayoutForActiveTab()
    return true
  }

  /** Resize tail window for the active tab using cached panel metrics (DOM only). */
  private syncDomLayoutForActiveTab(): void {
    const pid = this.tailScriptPid
    if (pid == null) return
    lastTailSizeByPid.delete(pid)
    const renderLayout = layoutForTailRender({
      ...this.resolveRenderLayout(),
      tailScriptPid: pid,
      tailActiveTabId: this.displayTabId,
    })
    syncTabbedTailLayoutDom(pid, renderLayout)
  }

  tab(tabId: string): ScriptLogBuilder {
    let builder = this.builders.get(tabId)
    if (!builder) {
      builder = new ScriptLogBuilder(this.layout)
      this.builders.set(tabId, builder)
    }
    return builder
  }

  private estimateTabBarWidthPx(): number {
    const merged = mergeLayout(this.layout)
    let width = 0
    for (const { label } of this.tabOrder) {
      width += estimateTabLabelWidthPx(label, merged)
    }
    width += Math.max(0, this.tabOrder.length - 1) * 2
    return Math.ceil(width)
  }

  private computeSharedWrapWidthPx(merged: TableLayout): number {
    let tailTableWidthPx = this.estimateTabBarWidthPx()
    for (const { id } of this.tabOrder) {
      const builder = this.builders.get(id)
      if (builder && !builder.isEmpty()) {
        tailTableWidthPx = Math.max(tailTableWidthPx, builder.computeContentWidthPx())
      }
    }
    if (tailTableWidthPx <= 0) {
      tailTableWidthPx = merged.tableWidthPx
    }
    return resolveTailWidth({ ...merged, tailTableWidthPx }).width
  }

  /** Snapshot panel sizes from current builders — matches the next painted panels. */
  private refreshPanelDimensions(): void {
    const merged = mergeLayout(this.layout)
    const wrapWidthPx = this.computeSharedWrapWidthPx(merged)
    this.panelDimensions.clear()
    for (const { id } of this.tabOrder) {
      const builder = this.builders.get(id)
      if (builder && !builder.isEmpty()) {
        this.panelDimensions.set(id, {
          widthPx: builder.computeContentWidthPx(),
          heightPx: builder.measureStackHeightPx(wrapWidthPx),
        })
      }
    }
  }

  private resolveTailDimensions(): { tailTableWidthPx: number; tailContentHeightPx: number } {
    const merged = mergeLayout(this.layout)
    primeChWidthPx(merged.fontSizePx)
    primeTailLogChrome(merged)

    const snapshot = this.panelDimensions.get(this.displayTabId)
    const wrapWidthPx = this.computeSharedWrapWidthPx(merged)

    let tailTableWidthPx = this.estimateTabBarWidthPx()
    if (snapshot) {
      tailTableWidthPx = Math.max(tailTableWidthPx, snapshot.widthPx)
    } else {
      tailTableWidthPx = Math.max(tailTableWidthPx, estimateEmptyTabPanelWidthPx(merged))
    }
    if (tailTableWidthPx <= 0) {
      tailTableWidthPx = merged.tableWidthPx
    }

    const panelHeight = snapshot
      ? snapshot.heightPx
      : estimateEmptyTabPanelHeightPx(merged, wrapWidthPx)

    return {
      tailTableWidthPx,
      tailContentHeightPx: panelHeight + estimateTabBarHeightPx(merged),
    }
  }

  private resolveRenderLayout(): TableLayout {
    const { tailTableWidthPx, tailContentHeightPx } = this.resolveTailDimensions()
    return mergeLayout({
      ...this.layout,
      tailTableWidthPx,
      tailContentHeightPx,
      tailTabbed: true,
      tailActiveTabId: this.displayTabId,
    })
  }

  build(): ReactNode {
    const React = getReact()
    this.refreshPanelDimensions()
    const layout = layoutForTailRender({
      ...this.resolveRenderLayout(),
      tailScriptPid: this.tailScriptPid,
      tailActiveTabId: this.displayTabId,
    })
    const populatedTabIds: string[] = []
    for (const { id } of this.tabOrder) {
      const builder = this.builders.get(id)
      if (builder && !builder.isEmpty()) populatedTabIds.push(id)
    }

    const panels: Record<string, ReactNode> = {}
    if (this.lazyInactivePanels) {
      const activeBuilder = this.builders.get(this.displayTabId)
      if (activeBuilder && !activeBuilder.isEmpty()) {
        panels[this.displayTabId] = activeBuilder.build(layout)
      }
    } else {
      for (const { id } of this.tabOrder) {
        const builder = this.builders.get(id)
        if (builder && !builder.isEmpty()) {
          panels[id] = builder.build(layout)
        }
      }
    }

    const syncTabLayout = (): void => {
      this.syncDomLayoutForActiveTab()
    }

    return React.createElement(TabbedLogView, {
      tabOrder: this.tabOrder,
      panels,
      populatedTabIds,
      programmaticActiveId: this.displayTabId,
      layout,
      onTabChange: (tabId: string) => {
        if (this.tailScriptPid != null && this.displayTabId !== tabId) {
          saveTabbedPanelScroll(this.tailScriptPid, this.displayTabId)
        }
        this.displayTabId = tabId
        if (this.lazyInactivePanels) {
          this.pendingLayoutRefresh = true
        }
        syncTabLayout()
      },
      onActiveTabLayout: syncTabLayout,
    })
  }

  render(ns: NS): Promise<void> {
    this.pendingLayoutRefresh = false
    this.tailScriptPid = ns.pid
    return renderScriptLog(ns, this.build(), this.resolveRenderLayout())
  }
}

function syncTailSize(ns: NS, layout: TableLayout): void {
  primeChWidthPx(layout.fontSizePx)
  primeTailLogChrome(layout)
  const next = resolveTailSize(layout)
  const prev = lastTailSizeByPid.get(ns.pid)
  if (
    prev &&
    Math.abs(prev.width - next.width) <= 1 &&
    Math.abs(prev.height - next.height) <= 1
  ) {
    return
  }
  try {
    ns.ui.resizeTail(next.width, next.height)
    lastTailSizeByPid.set(ns.pid, next)
  } catch (error) {
    lastTailSizeByPid.delete(ns.pid)
    if (!isScriptDeathError(error)) throw error
  }
}

export type ScriptLogWindowRect = WindowScreenRect

type ScriptLogTailRoots = {
  draggable: HTMLElement
  resizable: HTMLElement
  viewport: HTMLElement
}

function findScriptTailRoots(pid: number): ScriptLogTailRoots | null {
  try {
    const doc = eval("document") as Document
    const viewport = doc.querySelector(`[${SCRIPT_LOG_PID_ATTR}="${pid}"]`) as HTMLElement | null
    if (!viewport) return null
    const resizable = viewport.closest(".react-resizable") as HTMLElement | null
    const draggable = viewport.closest(".react-draggable") as HTMLElement | null
    if (!resizable || !draggable) return null
    return { draggable, resizable, viewport }
  } catch {
    return null
  }
}

function isScriptTailCollapsed(roots: ScriptLogTailRoots): boolean {
  const papers = roots.resizable.querySelectorAll(".MuiPaper-root")
  for (const paper of Array.from(papers)) {
    if (!(paper instanceof HTMLElement)) continue
    if (paper.classList.contains("drag")) continue
    if (window.getComputedStyle(paper).display === "none") return true
  }
  return false
}

/** Screen-space bounds of this script's tail window (null when hidden or not open). */
export function probeScriptTailWindow(pid: number): ScriptLogWindowRect | null {
  const roots = findScriptTailRoots(pid)
  if (!roots) return null
  const dragRect = roots.draggable.getBoundingClientRect()
  if (dragRect.width <= 0 && dragRect.height <= 0) return null
  return probeScriptTailScreenRect(roots.draggable, roots.resizable, isScriptTailCollapsed(roots))
}

/** Restore tail window position/size after switching back from a floating DOM sink. */
export function applyScriptTailWindowRect(pid: number, rect: ScriptLogWindowRect): void {
  const roots = findScriptTailRoots(pid)
  if (!roots) return
  applyScriptTailScreenRect(roots.draggable, roots.resizable, rect)
  lastTailSizeByPid.set(pid, { width: rect.width, height: rect.height })
  const win = eval("window") as Window
  const tick = (): void => {
    applyScriptTailScreenRect(roots.draggable, roots.resizable, rect)
  }
  tick()
  win.requestAnimationFrame(tick)
}

type ReactDomRef = {
  createRoot?: (el: HTMLElement) => { render(node: unknown): void; unmount(): void }
  render?: (node: unknown, el: HTMLElement) => void
  unmountComponentAtNode?: (el: HTMLElement) => void
}

function getReactDom(): ReactDomRef {
  return eval("ReactDOM") as ReactDomRef
}

const reactRootsByContainer = new WeakMap<HTMLElement, { render(node: unknown): void; unmount(): void }>()

function mountScriptLogReactRoot(container: HTMLElement): { render(node: unknown): void; unmount(): void } {
  let root = reactRootsByContainer.get(container)
  if (!root) {
    const ReactDOM = getReactDom()
    if (ReactDOM.createRoot) {
      const domRoot = ReactDOM.createRoot(container)
      root = { render: (node) => domRoot.render(node), unmount: () => domRoot.unmount() }
    } else if (ReactDOM.render && ReactDOM.unmountComponentAtNode) {
      root = {
        render: (node) => ReactDOM.render!(node, container),
        unmount: () => ReactDOM.unmountComponentAtNode!(container),
      }
    } else {
      throw new Error("ReactDOM is not available for script log rendering")
    }
    reactRootsByContainer.set(container, root)
  }
  return root
}

export function unmountScriptLogContainer(container: HTMLElement): void {
  const root = reactRootsByContainer.get(container)
  root?.unmount()
  reactRootsByContainer.delete(container)
}

/** Measured painted script-log content (use after render for floating window sizing). */
export function measureScriptLogViewportSize(container: HTMLElement): { widthPx: number; heightPx: number } {
  try {
    const viewport = container.querySelector(`[${SCRIPT_LOG_VIEWPORT_ATTR}]`) as HTMLElement | null
    const el = viewport ?? container
    return {
      widthPx: Math.ceil(Math.max(el.scrollWidth, el.offsetWidth)),
      heightPx: Math.ceil(Math.max(el.scrollHeight, el.offsetHeight)),
    }
  } catch {
    return { widthPx: 0, heightPx: 0 }
  }
}

/** Apply tail viewport scroll constraints to a floating-window mount (after paint measure). */
export function syncScriptLogContainerLayout(container: HTMLElement, layout: TableLayout): void {
  const viewportMax = layout.tailViewportMaxHeightPx
  const tabbed = layout.tailTabbed === true

  if (viewportMax != null) {
    container.style.height = `${viewportMax}px`
    container.style.maxHeight = `${viewportMax}px`
    container.style.overflowY = "auto"
  } else {
    container.style.height = ""
    container.style.maxHeight = ""
    container.style.overflowY = "auto"
  }
  container.style.overflowX = "auto"
  container.style.boxSizing = "border-box"
  container.style.width = "100%"

  const viewport = container.querySelector(`[${SCRIPT_LOG_VIEWPORT_ATTR}]`) as HTMLElement | null
  if (!viewport || viewport === container) return

  viewport.style.display = "block"
  viewport.style.overflowX = "auto"
  viewport.style.overflowAnchor = "none"
  if (tabbed && viewportMax != null) {
    viewport.style.height = `${viewportMax}px`
    viewport.style.maxHeight = `${viewportMax}px`
    viewport.style.overflowY = "hidden"
  } else if (viewportMax != null) {
    viewport.style.height = ""
    viewport.style.maxHeight = `${viewportMax}px`
    viewport.style.overflowY = "auto"
  } else {
    viewport.style.height = ""
    viewport.style.maxHeight = ""
    viewport.style.overflowY = ""
  }
}

export async function renderScriptLogToContainer(
  ns: NS,
  container: HTMLElement,
  content: ReactNode,
  layout?: Partial<TableLayout>
): Promise<void> {
  const pid = ns.pid
  const merged = mergeLayout(layout)
  saveTailScrollPosition(pid, merged.tailActiveTabId)
  primeTailLogChrome(merged)
  const renderLayout = layoutForTailRender({ ...layout, tailScriptPid: pid })
  container.setAttribute(SCRIPT_LOG_PID_ATTR, String(pid))
  syncScriptLogContainerLayout(container, renderLayout)
  mountScriptLogReactRoot(container).render(buildViewportShell(content, renderLayout))
  if (renderLayout.tailTabbed) {
    const win = eval("window") as Window
    const applyChrome = (): void => applyTabbedTailChrome(pid, renderLayout)
    applyChrome()
    win.requestAnimationFrame(() => {
      applyChrome()
      restoreTabbedPanelScroll(pid, renderLayout.tailActiveTabId)
    })
  }
}

export async function renderScriptLog(ns: NS, content: ReactNode, layout?: Partial<TableLayout>): Promise<void> {
  const pid = ns.pid
  const merged = mergeLayout(layout)
  saveTailScrollPosition(pid, merged.tailActiveTabId)
  primeTailLogChrome(merged)
  const renderLayout = layoutForTailRender({ ...layout, tailScriptPid: pid })
  ns.clearLog()
  ns.printRaw(buildViewportShell(content, renderLayout))
  ns.ui.renderTail()
  syncTailSize(ns, renderLayout)
  if (renderLayout.tailTabbed) {
    const win = eval("window") as Window
    const applyChrome = (): void => applyTabbedTailChrome(pid, renderLayout)
    applyChrome()
    win.requestAnimationFrame(() => {
      applyChrome()
      restoreTabbedPanelScroll(pid, renderLayout.tailActiveTabId)
    })
  }
}

export function initScriptLogTail(ns: NS, title: string, layout?: Partial<TableLayout>): void {
  const merged = mergeLayout(layout)
  resetTailSession(ns.pid)
  ns.disableLog("ALL")
  ns.ui.openTail()
  ns.ui.setTailTitle(title)
  ns.ui.setTailFontSize(merged.fontSizePx)
  primeChWidthPx(merged.fontSizePx)
  primeTailLogChrome(merged)
}

