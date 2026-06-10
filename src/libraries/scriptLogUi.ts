/**
 * React tail rendering primitives. Scripts should use {@link ./scriptLogUiLayout.js} instead.
 */

import { NS, ReactNode } from "@ns"
import type { Alignment, ColumnConfig, KeyValueTableConfig, TableConfig, ThreeColumnTableConfig } from "./tableBuilder.js"

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
  /** Log sizing breakdown to the browser console (F12); once per tailSizingDebugLabel. */
  debugTailSizing?: boolean
  /** Groups one-time F12 sizing logs when several tail scripts run (e.g. "crime"). */
  tailSizingDebugLabel?: string
  /** Per-render viewport id so DOM sizing targets this tail only (set in renderScriptLog). */
  tailViewportInstanceId?: number
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

function findScrollParent(el: HTMLElement): HTMLElement | null {
  const win = eval("window") as Window
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const style = win.getComputedStyle(node)
    if (style.overflowY === "scroll" || style.overflowY === "auto") {
      return node
    }
    node = node.parentElement
  }
  return null
}

const SCRIPT_LOG_VIEWPORT_ATTR = "data-script-log-viewport"
const SCRIPT_LOG_VIEWPORT_ID_ATTR = "data-script-log-viewport-id"

let tailViewportSeq = 0

function findTailViewport(instanceId?: number): HTMLElement | null {
  try {
    const doc = eval("document") as Document
    if (instanceId != null) {
      return doc.querySelector(`[${SCRIPT_LOG_VIEWPORT_ID_ATTR}="${instanceId}"]`) as HTMLElement | null
    }
    return doc.querySelector(`[${SCRIPT_LOG_VIEWPORT_ATTR}]`) as HTMLElement | null
  } catch {
    return null
  }
}

/** Measured or default title row from Bitburner tail chrome (h6 + control buttons). */
let cachedTailTitleBarPx: number | null = null
interface TailLogInsets {
  top: number
  right: number
  bottom: number
  left: number
}

const EMPTY_TAIL_LOG_INSETS: TailLogInsets = { top: 0, right: 0, bottom: 0, left: 0 }

/** Per-script last resizeTail (module is shared across all running scripts in the game). */
const lastTailSizeByPid = new Map<number, { width: number; height: number }>()

function resetTailSession(pid: number): void {
  lastTailSizeByPid.delete(pid)
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

function findTailLogsPanel(viewport: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = viewport.parentElement
  while (node) {
    if (LOGS_HEIGHT_CALC_RE.test(node.style.height)) return node
    node = node.parentElement
  }
  return null
}

function measureTitleBarFromViewport(viewport: HTMLElement): number | null {
  try {
    const resizable = viewport.closest(".react-resizable") as HTMLElement | null
    const logsPanel = findTailLogsPanel(viewport)
    if (resizable && logsPanel) {
      const px = Math.round(logsPanel.getBoundingClientRect().top - resizable.getBoundingClientRect().top)
      if (px >= 24 && px <= 56) return px
    }
    const probed = probeBitburnerTitleBarPx()
    if (probed != null) return probed
  } catch {
    // ignore
  }
  return null
}

function measureHorizontalInsetsFromViewport(
  viewport: HTMLElement
): Pick<TailLogInsets, "left" | "right"> | null {
  try {
    const logsPanel = findTailLogsPanel(viewport)
    if (!logsPanel) return null
    const panel = logsPanel.getBoundingClientRect()
    const content = viewport.getBoundingClientRect()
    return {
      left: Math.max(0, Math.round(content.left - panel.left)),
      right: Math.max(0, Math.round(panel.right - content.right)),
    }
  } catch {
    return null
  }
}

/** CSS padding/margin/border from viewport up through the logs panel (stable across resizes). */
function measureStructuralVerticalInsets(viewport: HTMLElement): Pick<TailLogInsets, "top" | "bottom"> | null {
  try {
    const logsPanel = findTailLogsPanel(viewport)
    if (!logsPanel) return null
    const win = eval("window") as Window
    let top = 0
    let bottom = 0
    let node: HTMLElement | null = viewport.parentElement
    while (node && node !== logsPanel) {
      const style = win.getComputedStyle(node)
      top += parseFloat(style.marginTop) + parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth)
      bottom +=
        parseFloat(style.marginBottom) + parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth)
      node = node.parentElement
    }
    const panelStyle = win.getComputedStyle(logsPanel)
    top += parseFloat(panelStyle.paddingTop) + parseFloat(panelStyle.borderTopWidth)
    bottom += parseFloat(panelStyle.paddingBottom) + parseFloat(panelStyle.borderBottomWidth)
    return { top: Math.ceil(top), bottom: Math.ceil(bottom) }
  } catch {
    return null
  }
}

function measureGeometricTopInset(viewport: HTMLElement): number | null {
  try {
    const logsPanel = findTailLogsPanel(viewport)
    if (!logsPanel) return null
    return Math.max(0, Math.round(viewport.getBoundingClientRect().top - logsPanel.getBoundingClientRect().top))
  } catch {
    return null
  }
}

/** Horizontal from geometry; vertical top from layout offset, bottom from CSS only (not flex slack). */
function measureLogInsetsFromViewport(viewport: HTMLElement): TailLogInsets | null {
  try {
    const horizontal = measureHorizontalInsetsFromViewport(viewport)
    const structural = measureStructuralVerticalInsets(viewport)
    const topInset = measureGeometricTopInset(viewport)
    if (!horizontal && !structural && topInset == null) return null
    return {
      left: horizontal?.left ?? 0,
      right: horizontal?.right ?? 0,
      top: topInset ?? structural?.top ?? 0,
      bottom: structural?.bottom ?? 0,
    }
  } catch {
    return null
  }
}

function measureLogInsets(scrollParent: HTMLElement): TailLogInsets {
  const win = eval("window") as Window
  const style = win.getComputedStyle(scrollParent)
  return {
    top: Math.ceil(parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth)),
    right: Math.ceil(parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth)),
    bottom: Math.ceil(parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth)),
    left: Math.ceil(parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth)),
  }
}

function logInsetsTotalX(insets: TailLogInsets): number {
  return insets.left + insets.right
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

let pendingTailSizingDebug: Record<string, unknown> | null = null

const tailSizingDebugLogged = new Set<string>()

function getTailSizingDebugLabel(layout: Partial<TableLayout>): string {
  return layout.tailSizingDebugLabel ?? "tail"
}

function shouldLogTailSizingDebug(layout: Partial<TableLayout>): boolean {
  return layout.debugTailSizing === true && !tailSizingDebugLogged.has(getTailSizingDebugLabel(layout))
}

interface ViewportShellProps {
  layout: TableLayout
  children: ReactNode
}

/** Pins tail log scroll to top (Bitburner uses column-reverse on the log container). */
function ViewportShell(props: ViewportShellProps): ReactNode {
  const React = getReact()
  const { children } = props
  const [containerEl, setContainerEl] = React.useState<HTMLElement | null>(null)

  React.useEffect(() => {
    if (!containerEl) return
    const win = eval("window") as Window
    const pinScroll = (): void => {
      const scrollParent = findScrollParent(containerEl)
      if (!scrollParent) return
      const flexDirection = win.getComputedStyle(scrollParent).flexDirection
      // column-reverse tails leave empty space at the visual top unless scrolled to the end
      const target =
        flexDirection === "column-reverse"
          ? scrollParent.scrollHeight - scrollParent.clientHeight
          : 0
      if (Math.abs(scrollParent.scrollTop - target) <= 1) return
      scrollParent.scrollTop = target
    }
    pinScroll()
    const frame = win.requestAnimationFrame(pinScroll)
    return () => win.cancelAnimationFrame(frame)
  }, [containerEl, props.layout.tailViewportMaxHeightPx])

  const viewportMax = props.layout.tailViewportMaxHeightPx
  return React.createElement(
    "div",
    {
      [SCRIPT_LOG_VIEWPORT_ATTR]: "",
      [SCRIPT_LOG_VIEWPORT_ID_ATTR]:
        props.layout.tailViewportInstanceId != null ? String(props.layout.tailViewportInstanceId) : "",
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
        ...(viewportMax != null ? { maxHeight: `${viewportMax}px`, overflowY: "auto" } : {}),
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

function debugMeasureTailHeightInViewport(
  merged: TableLayout,
  sized: ReturnType<typeof resolveTailSize>
): Record<string, unknown> | null {
  try {
    const win = eval("window") as Window
    const viewport = findTailViewport(merged.tailViewportInstanceId)
    if (!viewport) return null
    const scrollParent = findScrollParent(viewport)
    const tables = Array.from(viewport.querySelectorAll("table"))
    const renderedTableHeightPx = tables.reduce((sum, table) => sum + table.offsetHeight, 0)
    const renderedViewportHeightPx = viewport.offsetHeight
    const titleBarPx = getTailTitleBarPx(merged)
    const estimatedContentHeightPx = merged.tailContentHeightPx ?? null
    const scrollParentClientHeightPx = scrollParent?.clientHeight ?? null
    const scrollParentScrollHeightPx = scrollParent?.scrollHeight ?? null
    const scrollParentFlexDirection = scrollParent ? win.getComputedStyle(scrollParent).flexDirection : null
    const topGapPx =
      scrollParentClientHeightPx != null ? scrollParentClientHeightPx - renderedViewportHeightPx : null
    const scrollParentClientWidthPx = scrollParent?.clientWidth ?? null
    const bottomClipPx = renderedViewportHeightPx - renderedTableHeightPx
    const logsPanel = findTailLogsPanel(viewport)
    const insets =
      measureLogInsetsFromViewport(viewport) ??
      (scrollParent ? measureLogInsets(scrollParent) : EMPTY_TAIL_LOG_INSETS)
    const logsPanelTopGapPx =
      logsPanel != null ? Math.round(viewport.getBoundingClientRect().top - logsPanel.getBoundingClientRect().top) : null
    const geometricInsets = (() => {
      if (!logsPanel) return null
      const panel = logsPanel.getBoundingClientRect()
      const content = viewport.getBoundingClientRect()
      return {
        top: Math.max(0, Math.round(content.top - panel.top)),
        bottom: Math.max(0, Math.round(panel.bottom - content.bottom)),
      }
    })()
    return {
      estimatedContentHeightPx,
      renderedViewportHeightPx,
      renderedTableHeightPx,
      resolvedTailHeightPx: sized.height,
      titleBarPx,
      titleBarProbedPx: probeBitburnerTitleBarPx(),
      titleBarFromViewportPx: measureTitleBarFromViewport(viewport),
      logsPanelInsetsPx: measureLogInsetsFromViewport(viewport),
      logsPanelGeometricVerticalPx: geometricInsets,
      structuralVerticalInsetsPx: measureStructuralVerticalInsets(viewport),
      logsPanelTopGapPx,
      scrollParentClientHeightPx,
      scrollParentClientWidthPx,
      scrollParentScrollHeightPx,
      scrollParentFlexDirection,
      topGapPx,
      bottomClipPx,
      heightEstimateMinusRenderedPx:
        estimatedContentHeightPx != null ? estimatedContentHeightPx - renderedViewportHeightPx : null,
      tailHeightMinusTitleMinusRenderedPx:
        sized.height - titleBarPx - renderedViewportHeightPx,
      renderedTables: tables.map((table, index) => ({
        index,
        offsetHeightPx: table.offsetHeight,
        scrollWidthPx: table.scrollWidth,
        clientWidthPx: table.clientWidth,
      })),
    }
  } catch {
    return null
  }
}

function debugMeasureTablesInViewport(
  instanceId?: number
): Array<{ scrollWidth: number; offsetWidth: number; clientWidth: number }> {
  try {
    const viewport = findTailViewport(instanceId)
    if (!viewport) return []
    return Array.from(viewport.querySelectorAll("table")).map((table) => ({
      scrollWidth: table.scrollWidth,
      offsetWidth: table.offsetWidth,
      clientWidth: table.clientWidth,
    }))
  } catch {
    return []
  }
}

function diagnoseTailSizingIssues(
  merged: TableLayout,
  sized: ReturnType<typeof resolveTailSize>,
  widthInfo: ReturnType<typeof resolveTailWidth>,
  pid: number,
  heightInfo: Record<string, unknown> | null,
  widestRendered: number
): string[] {
  const issues: string[] = []
  const topGapPx = heightInfo?.topGapPx as number | null | undefined
  const renderedViewportHeightPx = heightInfo?.renderedViewportHeightPx as number | undefined
  const tailSparePx = heightInfo?.tailHeightMinusTitleMinusRenderedPx as number | undefined
  const heightEstDelta = heightInfo?.heightEstimateMinusRenderedPx as number | null | undefined
  const contentWidthPx = merged.tailTableWidthPx

  if (topGapPx != null && topGapPx > 2) {
    issues.push(`TOP GAP ${topGapPx}px: logs-area padding above content (column-reverse shows at top)`)
  }
  if (tailSparePx != null && tailSparePx < -2) {
    issues.push(`HEIGHT SHORT ${-tailSparePx}px: resizeTail height smaller than title+content (clip at bottom)`)
  }
  if (heightEstDelta != null && heightEstDelta < -2) {
    issues.push(`HEIGHT EST LOW ${-heightEstDelta}px: content estimate below rendered viewport height`)
  }
  if (heightEstDelta != null && heightEstDelta > 4) {
    issues.push(`HEIGHT EST HIGH ${heightEstDelta}px: content estimate above rendered viewport height`)
  }
  if (widestRendered > 0 && contentWidthPx != null && widestRendered - contentWidthPx > 2) {
    issues.push(`WIDTH EST LOW ${widestRendered - contentWidthPx}px: table wider than ch column estimate`)
  }
  if (widestRendered > 0 && contentWidthPx != null && contentWidthPx - widestRendered > 4) {
    issues.push(`WIDTH EST HIGH ${contentWidthPx - widestRendered}px: ch estimate wider than rendered table`)
  }
  if (widestRendered > 0 && widthInfo.width - widestRendered < -2) {
    issues.push(
      `TAIL NARROW ${widestRendered - widthInfo.width}px: window width below table (${widthInfo.width} vs need ~${widestRendered})`
    )
  }
  if (widthInfo.capped && widestRendered > widthInfo.width + 2) {
    issues.push(
      `SCREEN CAP: content needs ~${widestRendered}px but tail capped at ${widthInfo.width}px (max ${widthInfo.maxWidth}) — use horizontal scroll`
    )
  }
  if (issues.length === 0) {
    issues.push("No sizing mismatch detected (gaps within 2px)")
  }
  return issues
}

function logTailSizingReport(pid: number, layout: Partial<TableLayout> | undefined): void {
  const merged = mergeLayout(layout)
  const label = getTailSizingDebugLabel(merged)
  if (!shouldLogTailSizingDebug(merged)) return
  tailSizingDebugLogged.add(label)

  const widthInfo = resolveTailWidth(merged)
  const resolvedSize = resolveTailSize(merged)
  const chPx = getChWidthPx(merged.fontSizePx)
  const win = eval("window") as Window
  const tables = debugMeasureTablesInViewport(merged.tailViewportInstanceId)
  const widestRendered = tables.reduce((max, t) => Math.max(max, t.scrollWidth), 0)
  const heightInfo = debugMeasureTailHeightInViewport(merged, resolvedSize)
  const issues = diagnoseTailSizingIssues(
    merged,
    resolvedSize,
    widthInfo,
    pid,
    heightInfo,
    widestRendered
  )

  console.log(`[tail-sizing:${label}]`, {
    sizingSource: "estimate",
    issues,
    ...pendingTailSizingDebug,
    ...heightInfo,
    contentWidthPx: merged.tailTableWidthPx,
    contentHeightPx: merged.tailContentHeightPx,
    chPx,
    chSource: isChWidthCached(merged.fontSizePx) ? "cached" : "fallback",
    tailPid: pid,
    paddedWidthPx: widthInfo.padded,
    resolvedTailWidthPx: resolvedSize.width,
    resolvedTailHeightPx: resolvedSize.height,
    screenMaxWidthPx: widthInfo.maxWidth,
    cappedByScreen: widthInfo.capped,
    windowInnerWidth: win.innerWidth,
    windowInnerHeight: win.innerHeight,
    widestTableScrollWidthPx: widestRendered || null,
    gapRenderedMinusContentPx:
      widestRendered > 0 && merged.tailTableWidthPx != null ? widestRendered - merged.tailTableWidthPx : null,
    gapTailMinusRenderedPx: widestRendered > 0 ? resolvedSize.width - widestRendered : null,
    gapRenderedMinusTailPx: widestRendered > 0 ? widestRendered - resolvedSize.width : null,
    tables,
  })
  pendingTailSizingDebug = null
}

/** Merge capped tail dimensions for resizeTail + scrollable viewport. */
export function layoutForTailRender(layout?: Partial<TableLayout>): TableLayout {
  const base = mergeLayout(layout)
  const sized = resolveTailSize(base)
  return mergeLayout({
    ...base,
    tailHeightPx: sized.height,
    tailViewportMaxHeightPx: sized.viewportMaxHeightPx,
  })
}

export function applyTailSize(ns: NS, layout?: Partial<TableLayout>): void {
  syncTailSize(ns, mergeLayout(layout))
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

function isChWidthCached(fontSizePx: number): boolean {
  return chWidthPxByFontSize.has(fontSizePx)
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

const TAB_BAR_HEIGHT_PX = 36

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
      col.header
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
        cell ?? ""
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
        },
      },
      `=== ${title} ===`
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

export function buildReactTreeTable(config: TreeTableConfig): ReactNode {
  const flat = flattenTreeRows(config.rows, config.rootIds)
  const treeMin = config.treeMinWidth ?? 16
  const maxTreeChars = Math.max(
    treeMin,
    ...flat.map(({ row, treePrefix }) => formatTreeCellLabel(row.label, treePrefix).length)
  )
  const columns: ColumnConfig[] = [
    { header: config.treeColumnHeader ?? "Host", align: "left", minWidth: maxTreeChars },
    ...config.columns,
  ]
  const tableRows = flat.map(({ row, treePrefix }) => [formatTreeCellLabel(row.label, treePrefix), ...row.cells])
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
    rows: tableRows,
    highlightCells,
    activeHeaderColumns,
  })
}

export function estimateReactTreeTableWidthPx(config: TreeTableConfig, layout?: Partial<TableLayout>): number {
  const flat = flattenTreeRows(config.rows, config.rootIds)
  const treeMin = config.treeMinWidth ?? 16
  const maxTreeChars = Math.max(
    treeMin,
    ...flat.map(({ row, treePrefix }) => formatTreeCellLabel(row.label, treePrefix).length)
  )
  const tableConfig: ReactTableConfig = {
    layout: config.layout ?? layout,
    columns: [{ header: config.treeColumnHeader ?? "Host", align: "left", minWidth: maxTreeChars }, ...config.columns],
    rows: flat.map(({ row, treePrefix }) => [formatTreeCellLabel(row.label, treePrefix), ...row.cells]),
  }
  return computeReactTableWidthPx(tableConfig, config.layout ?? layout)
}

export function estimateReactTreeTableHeightPx(
  config: TreeTableConfig,
  layout?: Partial<TableLayout>,
  contentWidthPx?: number
): number {
  const flat = flattenTreeRows(config.rows, config.rootIds)
  const merged = mergeLayout(config.layout ?? layout)
  let height = merged.headerRowHeightPx + flat.length * merged.bodyRowHeightPx
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
      },
    },
    `=== ${title} ===`
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
      },
    },
    text
  )
}

export function buildStack(children: ReactNode[], layout?: Partial<TableLayout>): ReactNode {
  const React = getReact()
  const merged = mergeLayout(layout)
  return React.createElement(
    "div",
    { style: { display: "block", margin: "0", padding: "0", fontFamily: "monospace", fontSize: `${merged.fontSizePx}px` } },
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
    default:
      return 0
  }
}

function buildPendingTailSizingDebug(
  sections: LogSection[],
  merged: TableLayout,
  contentWidthPx: number,
  contentHeightPx: number,
  wrapWidthPx: number
): Record<string, unknown> {
  const sectionBreakdown = sections.map((section, index) => ({
    index,
    kind: section.kind,
    estimatedHeightPx: logSectionHeightPx(section, merged, wrapWidthPx),
    bottomMarginPx: sectionBottomMarginPx(section),
    estimatedWidthPx: logSectionMaxWidthPx(section, merged),
    ...(section.kind === "table"
      ? { rowCount: section.config.rows.length, titled: Boolean(section.config.title) }
      : section.kind === "text"
        ? { lineCount: section.message.split("\n").length }
        : {}),
  }))

  let widestTable: ReactTableConfig | null = null
  let widestTablePx = 0
  for (const section of sections) {
    if (section.kind !== "table") continue
    const sectionPx = logSectionMaxWidthPx(section, merged)
    if (sectionPx > widestTablePx) {
      widestTablePx = sectionPx
      widestTable = section.config
    }
  }

  const out: Record<string, unknown> = {
    label: getTailSizingDebugLabel(merged),
    sectionCount: sections.length,
    sectionBreakdown,
    contentWidthPx,
    contentHeightPx,
    titleWrapWidthPx: wrapWidthPx,
  }

  if (widestTable) {
    const widthsCh = computeColumnWidthsCh(widestTable)
    const widthsPx = computeColumnWidthsPx(widthsCh, merged)
    const columnsPx = sumColumnWidthsPx(widthsPx)
    out.widestTable = {
      columns: widestTable.columns.length,
      rows: widestTable.rows.length,
      totalCh: widthsCh.reduce((sum, ch) => sum + ch, 0),
      columnsPx,
      columnWidthsPx: widthsPx,
      tableWidthPx: columnsPx,
    }
  }

  return out
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
  estimateContentHeightPx(): number {
    const merged = mergeLayout(this.layout)
    const contentWidthPx = Math.max(1, this.computeContentWidthPx())
    const { width: tailWidthPx } = resolveTailWidth({ ...merged, tailTableWidthPx: contentWidthPx })
    const wrapWidthPx = Math.max(1, tailWidthPx)
    let height = 0
    for (const section of this.sections) {
      height += logSectionHeightPx(section, merged, wrapWidthPx)
      height += sectionBottomMarginPx(section)
    }
    return height
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
      }
    })
    return buildStack(nodes, layout)
  }

  isEmpty(): boolean {
    return this.sections.length === 0
  }

  render(ns: NS): Promise<void> {
    const merged = mergeLayout(this.layout)
    const contentWidthPx = this.computeContentWidthPx()
    const contentHeightPx = this.estimateContentHeightPx()
    if (shouldLogTailSizingDebug(merged)) {
      const { width: tailWidthPx } = resolveTailWidth({ ...merged, tailTableWidthPx: contentWidthPx })
      const wrapWidthPx = Math.max(1, tailWidthPx)
      pendingTailSizingDebug = buildPendingTailSizingDebug(
        this.sections,
        merged,
        contentWidthPx,
        contentHeightPx,
        wrapWidthPx
      )
    }
    return renderScriptLog(ns, this.build(), {
      ...this.layout,
      tailTableWidthPx: contentWidthPx,
      tailContentHeightPx: contentHeightPx,
    })
  }
}

export interface TabDefinition {
  id: string
  label: string
}

interface TabbedLogViewProps {
  tabOrder: TabDefinition[]
  panels: Record<string, ReactNode>
  programmaticActiveId: string
  layout: TableLayout
  onTabChange?: (tabId: string) => void
}

/** Stateful tab UI — uses React hooks (no document/window DOM). Clicks may not work in all game versions. */
function TabbedLogView(props: TabbedLogViewProps): ReactNode {
  const React = getReact()
  const { tabOrder, panels, programmaticActiveId, layout, onTabChange } = props
  const [activeId, setActiveId] = React.useState(programmaticActiveId)

  React.useEffect(() => {
    setActiveId(programmaticActiveId)
  }, [programmaticActiveId])

  const tabBar = React.createElement(
    "div",
    {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: "2px",
        marginBottom: `${layout.sectionGapPx}px`,
      },
    },
    ...tabOrder.map(({ id, label }) => {
      const isActive = id === activeId
      const hasContent = panels[id] != null
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
            fontWeight: isActive ? "bold" : "normal",
            backgroundColor: isActive ? ACTIVE_HEADER_BG : hasContent ? "rgba(255, 255, 255, 0.06)" : "transparent",
            border: `${layout.borderPx}px solid ${HEADER_BORDER}`,
            opacity: hasContent || isActive ? 1 : 0.45,
            cursor: "pointer",
            userSelect: "none",
          },
        },
        label
      )
    })
  )

  const panelContent = panels[activeId] ?? buildTextBlock("(no content yet)", layout)

  return React.createElement(
    "div",
    { style: { display: "block", margin: "0", padding: "0", fontFamily: "monospace", fontSize: `${layout.fontSizePx}px` } },
    tabBar,
    panelContent
  )
}

export class TabbedScriptLogBuilder {
  private builders = new Map<string, ScriptLogBuilder>()
  /** Tab shown in the UI; kept across re-renders when the user picks a tab. */
  private displayTabId: string
  private layout?: Partial<TableLayout>

  constructor(
    private tabOrder: TabDefinition[],
    layout?: Partial<TableLayout>
  ) {
    this.layout = layout
    this.displayTabId = tabOrder[0]?.id ?? ""
  }

  reset(): this {
    this.builders.clear()
    this.displayTabId = this.tabOrder[0]?.id ?? ""
    return this
  }

  /** Clear tab panel content without changing the selected tab (for live-update loops). */
  clearPanels(): this {
    this.builders.clear()
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
    return this
  }

  setActiveTab(tabId: string): this {
    this.displayTabId = tabId
    return this
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
    const chPx = getChWidthPx(merged.fontSizePx)
    let width = 0
    for (const { label } of this.tabOrder) {
      width += label.length * chPx + merged.paddingXPx * 2 + merged.borderPx * 2 + 4
    }
    width += Math.max(0, this.tabOrder.length - 1) * 2
    return Math.ceil(width)
  }

  private resolveTailTableWidthPx(): number {
    let maxWidth = this.estimateTabBarWidthPx()
    for (const builder of this.builders.values()) {
      maxWidth = Math.max(maxWidth, builder.computeContentWidthPx())
    }
    return maxWidth > 0 ? maxWidth : mergeLayout(this.layout).tableWidthPx
  }

  private resolveTailContentHeightPx(): number {
    let panelHeight = 0
    for (const builder of this.builders.values()) {
      if (!builder.isEmpty()) {
        panelHeight = Math.max(panelHeight, builder.estimateContentHeightPx())
      }
    }
    return panelHeight + TAB_BAR_HEIGHT_PX
  }

  private resolveRenderLayout(): TableLayout {
    return mergeLayout({
      ...this.layout,
      tailTableWidthPx: this.resolveTailTableWidthPx(),
      tailContentHeightPx: this.resolveTailContentHeightPx(),
    })
  }

  build(): ReactNode {
    const React = getReact()
    const layout = mergeLayout(this.layout)
    const panels: Record<string, ReactNode> = {}

    for (const { id } of this.tabOrder) {
      const builder = this.builders.get(id)
      if (builder && !builder.isEmpty()) {
        panels[id] = builder.build(layout)
      }
    }

    return React.createElement(TabbedLogView, {
      tabOrder: this.tabOrder,
      panels,
      programmaticActiveId: this.displayTabId,
      layout,
      onTabChange: (tabId: string) => {
        this.displayTabId = tabId
      },
    })
  }

  render(ns: NS): Promise<void> {
    return renderScriptLog(ns, this.build(), this.resolveRenderLayout())
  }
}

function syncTailSize(ns: NS, layout: TableLayout): void {
  const next = resolveTailSize(layout)
  const prev = lastTailSizeByPid.get(ns.pid)
  if (
    prev &&
    Math.abs(prev.width - next.width) <= 1 &&
    Math.abs(prev.height - next.height) <= 1
  ) {
    return
  }
  ns.ui.resizeTail(next.width, next.height)
  lastTailSizeByPid.set(ns.pid, next)
}

export async function renderScriptLog(ns: NS, content: ReactNode, layout?: Partial<TableLayout>): Promise<void> {
  const instanceId = ++tailViewportSeq
  const pid = ns.pid
  primeTailLogChrome(mergeLayout(layout))
  const renderLayout = layoutForTailRender({ ...layout, tailViewportInstanceId: instanceId })
  ns.clearLog()
  ns.printRaw(buildViewportShell(content, renderLayout))
  ns.ui.renderTail()
  syncTailSize(ns, renderLayout)
  logTailSizingReport(pid, { ...layout, ...renderLayout, tailViewportInstanceId: instanceId })
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

