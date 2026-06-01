import { NS, ReactNode } from "@ns"
import type { Alignment, KeyValueTableConfig, TableConfig, ThreeColumnTableConfig } from "./tableBuilder.js"

export type LogFn = (message: string) => void

export interface TableLayout {
  fontSizePx: number
  paddingXPx: number
  borderPx: number
  headerRowHeightPx: number
  bodyRowHeightPx: number
  tableWidthPx: number
  tailTitleBarPx: number
  /** Widest table in a tabbed log; used for resizeTail only, not per-table width. */
  tailTableWidthPx?: number
  /** Minimum tail window width (defaults to tableWidthPx). */
  tailWidthPx?: number
  /** Minimum total tail window height; content taller than this triggers auto-resize. */
  tailHeightPx?: number
  /** Cap for auto-resized tail width; defaults to ~95% of the game window. */
  tailMaxWidthPx?: number
  /** Cap for auto-resized tail height; defaults to ~92% of the game window. */
  tailMaxHeightPx?: number
  sectionGapPx: number
}

export const DEFAULT_LAYOUT: TableLayout = {
  fontSizePx: 12,
  paddingXPx: 8,
  borderPx: 1,
  headerRowHeightPx: 26,
  bodyRowHeightPx: 22,
  tableWidthPx: 640,
  tailTitleBarPx: 33,
  sectionGapPx: 8,
}

export const HIGHLIGHT_BG = "rgba(0, 255, 0, 0.18)"
export const SELECTED_ROW_BG = "rgba(255, 255, 255, 0.06)"
export const ACTIVE_HEADER_BG = "rgba(0, 255, 0, 0.12)"
const BODY_BORDER = "rgba(255, 255, 255, 0.08)"
const HEADER_BORDER = "rgba(255, 255, 255, 0.15)"
const HEADER_BG = "rgba(255, 255, 255, 0.04)"

export type ReactRef = {
  createElement(type: string, props?: Record<string, unknown> | null, ...children: unknown[]): ReactNode
  useState: <T>(initial: T) => [T, (value: T) => void]
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => void
}

export function getReact(): ReactRef {
  return eval("window.React") as ReactRef
}

export function mergeLayout(partial?: Partial<TableLayout>): TableLayout {
  return { ...DEFAULT_LAYOUT, ...partial }
}

function contentViewportMinHeight(layout: TableLayout): number {
  if (layout.tailHeightPx == null) return 0
  return Math.max(0, layout.tailHeightPx - layout.tailTitleBarPx)
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

interface ViewportShellProps {
  layout: TableLayout
  children: ReactNode
}

/** Fills the tail log viewport so Bitburner's column-reverse log layout keeps content at the top. */
function ViewportShell(props: ViewportShellProps): ReactNode {
  const React = getReact()
  const { layout, children } = props
  const fallbackMinHeightPx = contentViewportMinHeight(layout)
  const [minHeightPx, setMinHeightPx] = React.useState(fallbackMinHeightPx)
  const [containerEl, setContainerEl] = React.useState<HTMLElement | null>(null)

  React.useEffect(() => {
    if (!containerEl) return

    const sync = () => {
      const scrollParent = findScrollParent(containerEl)
      const viewportHeight = scrollParent?.clientHeight ?? 0
      const contentHeight = containerEl.scrollHeight
      setMinHeightPx(Math.max(viewportHeight, contentHeight, fallbackMinHeightPx))
      if (scrollParent) scrollParent.scrollTop = 0
    }

    sync()

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(sync)
      observer.observe(containerEl)
      const scrollParent = findScrollParent(containerEl)
      if (scrollParent) observer.observe(scrollParent)
      return () => observer.disconnect()
    }

    const win = eval("window") as Window
    win.addEventListener("resize", sync)
    return () => win.removeEventListener("resize", sync)
  }, [containerEl, fallbackMinHeightPx])

  return React.createElement(
    "div",
    {
      [SCRIPT_LOG_VIEWPORT_ATTR]: "",
      ref: (node: unknown) => {
        const el = node as HTMLElement | null
        setContainerEl((prev) => (prev === el ? prev : el))
      },
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
        alignItems: "flex-start",
        minHeight: minHeightPx > 0 ? `${minHeightPx}px` : undefined,
        width: "100%",
        boxSizing: "border-box",
      },
    },
    children
  )
}

function buildViewportShell(content: ReactNode, layout: TableLayout): ReactNode {
  const React = getReact()
  return React.createElement(ViewportShell, { layout, children: content })
}

function measureTailContentHeightPx(): number | null {
  const doc = eval("document") as Document
  const viewport = doc.querySelector(`[${SCRIPT_LOG_VIEWPORT_ATTR}]`) as HTMLElement | null
  if (!viewport) return null
  return viewport.scrollHeight
}

function resolveTailWidth(layout: TableLayout): number {
  const win = eval("window") as Window
  const contentWidth = layout.tailTableWidthPx ?? layout.tableWidthPx
  const minWidth = layout.tailWidthPx ?? layout.tableWidthPx
  const maxWidth = layout.tailMaxWidthPx ?? Math.floor(win.innerWidth * 0.95)
  const padded = Math.ceil(contentWidth + layout.sectionGapPx)
  return Math.min(maxWidth, Math.max(minWidth, padded))
}

function resolveTailHeight(contentHeightPx: number, layout: TableLayout): number {
  const win = eval("window") as Window
  const minHeight = layout.tailHeightPx ?? 150
  const maxHeight = layout.tailMaxHeightPx ?? Math.floor(win.innerHeight * 0.92)
  const totalHeight = Math.ceil(contentHeightPx + layout.tailTitleBarPx)
  return Math.min(maxHeight, Math.max(minHeight, totalHeight))
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
    padding: `0 ${layout.paddingXPx}px`,
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

/** Extra width (in char units) for one space of inset on each side of cell text. */
const COLUMN_WIDTH_PAD_CHARS = 2
/** Monospace advance width relative to font size (~1ch in browsers). */
const CHAR_WIDTH_TO_FONT_RATIO = 0.6

function computeColumnWidthsPx(config: TableConfig, layout: TableLayout, columnWidths?: number[]): number[] {
  if (columnWidths) return columnWidths

  const charPx = layout.fontSizePx * CHAR_WIDTH_TO_FONT_RATIO
  const cellPaddingPx = layout.paddingXPx * 2
  return config.columns.map((col, colIdx) => {
    let maxChars = col.header.length
    for (const row of config.rows) {
      if (row[colIdx]) maxChars = Math.max(maxChars, row[colIdx].length)
    }
    const charWidth = Math.max(maxChars, col.minWidth ?? 0) + COLUMN_WIDTH_PAD_CHARS
    return Math.ceil(charWidth * charPx + cellPaddingPx)
  })
}

/** Pixel width a table needs (same rules as buildReactTable). */
export function estimateReactTableWidthPx(config: ReactTableConfig, layout?: Partial<TableLayout>): number {
  const merged = mergeLayout(config.layout ?? layout)
  const colWidths = computeColumnWidthsPx(config, merged, config.columnWidths)
  const sumColWidths = colWidths.reduce((sum, width) => sum + width, 0)
  if (config.tableWidth != null) return Math.max(config.tableWidth, sumColWidths)
  return Math.max(sumColWidths, merged.tableWidthPx)
}

function keyValueToReactTableConfig(
  config: KeyValueTableConfig & Pick<ReactTableConfig, "tableWidth" | "columnWidths">
): ReactTableConfig {
  const { rows, title, separatorAfter = [], valueAlign = "right" } = config
  return {
    title,
    tableWidth: config.tableWidth,
    columnWidths: config.columnWidths,
    columns: [
      { header: "", align: "left" },
      { header: "", align: valueAlign },
    ],
    rows: rows.map((r) => [r.label, r.value]),
    separatorAfter,
  }
}

function threeColumnToReactTableConfig(
  config: ThreeColumnTableConfig & Pick<ReactTableConfig, "tableWidth" | "columnWidths">
): ReactTableConfig {
  const { headers, rows, title, separatorAfter = [], align = ["left", "right", "right"] } = config
  return {
    title,
    tableWidth: config.tableWidth,
    columnWidths: config.columnWidths,
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
  tableWidth?: number
  columnWidths?: number[]
  selectedRowIndex?: number
  highlightCells?: ReadonlySet<string>
  activeHeaderColumns?: ReadonlySet<number>
}

export function buildReactTable(config: ReactTableConfig): ReactNode {
  const React = getReact()
  const layout = mergeLayout(config.layout)
  const { columns, rows, title, separatorAfter = [] } = config
  const colWidths = computeColumnWidthsPx(config, layout, config.columnWidths)
  const sumColWidths = colWidths.reduce((sum, width) => sum + width, 0)
  const tableWidth = config.tableWidth != null ? Math.max(config.tableWidth, sumColWidths) : sumColWidths
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
    ...colWidths.map((width, idx) => React.createElement("col", { key: `col-${idx}`, style: { width: `${width}px` } }))
  )

  const table = React.createElement(
    "table",
    {
      style: {
        borderCollapse: "collapse",
        tableLayout: "fixed",
        width: `${tableWidth}px`,
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
    { style: { display: "block", margin: "0 0 4px 0", padding: "0" } },
    React.createElement(
      "div",
      {
        style: {
          fontFamily: "monospace",
          fontSize: `${layout.fontSizePx}px`,
          marginBottom: "4px",
          fontWeight: "bold",
        },
      },
      `=== ${title} ===`
    ),
    table
  )
}

export function buildReactKeyValueTable(config: KeyValueTableConfig & Pick<ReactTableConfig, "layout" | "tableWidth">): ReactNode {
  return buildReactTable({ layout: config.layout, ...keyValueToReactTableConfig(config) })
}

export function buildReactThreeColumnTable(
  config: ThreeColumnTableConfig & Pick<ReactTableConfig, "layout" | "tableWidth">
): ReactNode {
  return buildReactTable({ layout: config.layout, ...threeColumnToReactTableConfig(config) })
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
  | { kind: "keyValue"; config: KeyValueTableConfig & Pick<ReactTableConfig, "tableWidth" | "columnWidths"> }
  | { kind: "threeColumn"; config: ThreeColumnTableConfig & Pick<ReactTableConfig, "tableWidth" | "columnWidths"> }

function logSectionToReactTableConfig(section: LogSection): ReactTableConfig | null {
  switch (section.kind) {
    case "table":
      return section.config
    case "keyValue":
      return keyValueToReactTableConfig(section.config)
    case "threeColumn":
      return threeColumnToReactTableConfig(section.config)
    default:
      return null
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

  keyValueTable(config: KeyValueTableConfig & Pick<ReactTableConfig, "tableWidth" | "columnWidths">): this {
    this.sections.push({ kind: "keyValue", config })
    return this
  }

  threeColumnTable(config: ThreeColumnTableConfig & Pick<ReactTableConfig, "tableWidth" | "columnWidths">): this {
    this.sections.push({ kind: "threeColumn", config })
    return this
  }

  /** Widest table width this builder's sections need (char-based estimate). */
  estimateMaxTableWidthPx(): number {
    let max = mergeLayout(this.layout).tableWidthPx
    for (const section of this.sections) {
      const tableConfig = logSectionToReactTableConfig(section)
      if (tableConfig) max = Math.max(max, estimateReactTableWidthPx(tableConfig, this.layout))
    }
    return max
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
    const layout = mergeLayout(this.layout)
    return renderScriptLog(ns, this.build(layout), {
      ...layout,
      tailTableWidthPx: this.estimateMaxTableWidthPx(),
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
}

/** Stateful tab UI — uses React hooks (no document/window DOM). Clicks may not work in all game versions. */
function TabbedLogView(props: TabbedLogViewProps): ReactNode {
  const React = getReact()
  const { tabOrder, panels, programmaticActiveId, layout } = props
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
          onClick: () => setActiveId(id),
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
    { style: { display: "block", margin: "0", padding: "0" } },
    tabBar,
    panelContent
  )
}

export class TabbedScriptLogBuilder {
  private builders = new Map<string, ScriptLogBuilder>()
  private activeTabId: string
  private layout?: Partial<TableLayout>

  constructor(
    private tabOrder: TabDefinition[],
    layout?: Partial<TableLayout>
  ) {
    this.layout = layout
    this.activeTabId = tabOrder[0]?.id ?? ""
  }

  reset(): this {
    this.builders.clear()
    this.activeTabId = this.tabOrder[0]?.id ?? ""
    return this
  }

  setActiveTab(tabId: string): this {
    this.activeTabId = tabId
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

  private resolveTailTableWidthPx(): number {
    let maxWidth = mergeLayout(this.layout).tableWidthPx
    for (const builder of this.builders.values()) {
      maxWidth = Math.max(maxWidth, builder.estimateMaxTableWidthPx())
    }
    return maxWidth
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
      programmaticActiveId: this.activeTabId,
      layout,
    })
  }

  render(ns: NS): Promise<void> {
    const layout = mergeLayout(this.layout)
    return renderScriptLog(ns, this.build(), {
      ...layout,
      tailTableWidthPx: this.resolveTailTableWidthPx(),
    })
  }
}

let lastTailWidthPx = 0
let lastTailHeightPx = 0

export async function renderScriptLog(ns: NS, content: ReactNode, layout?: Partial<TableLayout>): Promise<void> {
  const merged = mergeLayout(layout)

  ns.clearLog()
  ns.printRaw(buildViewportShell(content, merged))
  ns.ui.renderTail()
  await ns.sleep(50)

  const contentHeightPx = measureTailContentHeightPx()
  if (contentHeightPx == null) return

  const nextWidth = resolveTailWidth(merged)
  const nextHeight = resolveTailHeight(contentHeightPx, merged)
  if (nextWidth === lastTailWidthPx && nextHeight === lastTailHeightPx) return
  lastTailWidthPx = nextWidth
  lastTailHeightPx = nextHeight
  ns.ui.resizeTail(nextWidth, nextHeight)
}

export function initScriptLogTail(ns: NS, title: string, layout?: Partial<TableLayout>): void {
  const merged = mergeLayout(layout)
  ns.disableLog("ALL")
  ns.ui.openTail()
  ns.ui.setTailTitle(title)
  ns.ui.setTailFontSize(merged.fontSizePx)
}

export function tailSizeForTable(
  bodyRowCount: number,
  layout?: Partial<TableLayout>,
  extraSections = 0
): { width: number; height: number } {
  const merged = mergeLayout(layout)
  const tableHeightPx = merged.headerRowHeightPx + bodyRowCount * merged.bodyRowHeightPx
  const sectionHeight = extraSections * (merged.sectionGapPx + merged.fontSizePx * 2)
  return {
    width: merged.tableWidthPx,
    height: tableHeightPx + merged.tailTitleBarPx + sectionHeight,
  }
}

export function estimateStackHeight(sectionCount: number, totalTableRows: number, layout?: Partial<TableLayout>): number {
  const merged = mergeLayout(layout)
  const textSections = Math.max(0, sectionCount - totalTableRows)
  return (
    merged.tailTitleBarPx +
    totalTableRows * merged.headerRowHeightPx +
    totalTableRows * merged.bodyRowHeightPx * 4 +
    textSections * (merged.fontSizePx * 3 + merged.sectionGapPx)
  )
}
