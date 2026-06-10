import { NS, ReactNode } from "@ns"
import type { Alignment, ColumnConfig, KeyValueTableConfig, TableConfig, ThreeColumnTableConfig } from "./tableBuilder.js"

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
    const scrollParent = findScrollParent(containerEl)
    if (scrollParent) scrollParent.scrollTop = 0
  }, [containerEl])

  const viewportMax = props.layout.tailViewportMaxHeightPx
  return React.createElement(
    "div",
    {
      [SCRIPT_LOG_VIEWPORT_ATTR]: "",
      ref: (node: unknown) => {
        const el = node as HTMLElement | null
        setContainerEl((prev) => (prev === el ? prev : el))
      },
      style: {
        display: "block",
        margin: "0",
        padding: "0",
        width: "100%",
        boxSizing: "border-box",
        ...(viewportMax != null
          ? { maxHeight: `${viewportMax}px`, overflowY: "auto", overflowX: "hidden" }
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

function resolveTailWidth(layout: TableLayout): number {
  const win = eval("window") as Window
  const contentWidth = layout.tailTableWidthPx ?? layout.tableWidthPx
  const minWidth = layout.tailWidthPx ?? contentWidth
  const maxWidth = layout.tailMaxWidthPx ?? Math.floor(win.innerWidth * 0.95)
  const padded = Math.ceil(contentWidth + layout.sectionGapPx)
  return Math.min(maxWidth, Math.max(minWidth, padded))
}

function resolveTailMaxHeight(layout: TableLayout): number {
  const win = eval("window") as Window
  return layout.tailMaxHeightPx ?? win.innerHeight
}

/** Total tail window size from layout estimates (call applyTailSize before renderScriptLog). */
export function resolveTailSize(layout?: Partial<TableLayout>): {
  width: number
  height: number
  viewportMaxHeightPx: number
} {
  const merged = mergeLayout(layout)
  const contentHeight = merged.tailContentHeightPx ?? 0
  let height = merged.tailHeightPx ?? merged.tailTitleBarPx + contentHeight
  height = Math.max(merged.tailTitleBarPx + 40, height)
  height = Math.min(height, resolveTailMaxHeight(merged))
  const viewportMaxHeightPx = Math.max(40, height - merged.tailTitleBarPx)
  return {
    width: resolveTailWidth(merged),
    height,
    viewportMaxHeightPx,
  }
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
  const { width, height } = resolveTailSize(layout)
  ns.ui.resizeTail(width, height)
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

type ColumnWidthUnit = "ch" | "px"

interface ColumnWidthSpec {
  value: number
  unit: ColumnWidthUnit
}

/** Horizontal inset per cell side; column width includes both sides. */
const CELL_HORIZONTAL_PAD_CH = 0.5

/** Monospace column width = max(text, minWidth) + horizontal pad on both sides. */
function computeColumnWidths(config: TableConfig, columnWidthsPx?: number[]): ColumnWidthSpec[] {
  if (columnWidthsPx) {
    return columnWidthsPx.map((value) => ({ value, unit: "px" as const }))
  }

  return config.columns.map((col, colIdx) => {
    let maxChars = col.header.length
    for (const row of config.rows) {
      if (row[colIdx]) maxChars = Math.max(maxChars, row[colIdx].length)
    }
    const contentChars = Math.max(maxChars, col.minWidth ?? 0)
    return { value: contentChars + CELL_HORIZONTAL_PAD_CH * 2, unit: "ch" as const }
  })
}

/** Typical advance width of one monospace glyph in CSS ch units (not 1em). */
const MONOSPACE_CH_TO_FONT_SIZE = 0.6

function columnWidthToPx(spec: ColumnWidthSpec, layout: TableLayout): number {
  if (spec.unit === "px") return spec.value
  return spec.value * layout.fontSizePx * MONOSPACE_CH_TO_FONT_SIZE
}

function sumColumnWidthsPx(specs: ColumnWidthSpec[], layout: TableLayout): number {
  return specs.reduce((sum, spec) => sum + columnWidthToPx(spec, layout), 0)
}

/** Pixel width a table needs (same rules as buildReactTable). */
export function estimateReactTableWidthPx(config: ReactTableConfig, layout?: Partial<TableLayout>): number {
  const merged = mergeLayout(config.layout ?? layout)
  const colWidths = computeColumnWidths(config, config.columnWidths)
  const sumColWidths = sumColumnWidthsPx(colWidths, merged)
  if (config.tableWidth != null) return Math.max(config.tableWidth, sumColWidths)
  return sumColWidths
}

export function estimateReactTableHeightPx(config: ReactTableConfig, layout?: Partial<TableLayout>): number {
  const merged = mergeLayout(config.layout ?? layout)
  let height = merged.headerRowHeightPx + config.rows.length * merged.bodyRowHeightPx
  if (config.title) height += merged.fontSizePx + 4 + merged.sectionGapPx
  return height + merged.sectionGapPx
}

function estimateTextHeightPx(message: string, layout: TableLayout): number {
  const lines = message.split("\n").length
  return lines * (layout.fontSizePx + 4) + layout.sectionGapPx
}

const TAB_BAR_HEIGHT_PX = 36

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
  const colWidths = computeColumnWidths(config, config.columnWidths)
  const sumColWidths = sumColumnWidthsPx(colWidths, layout)
  const tableWidthPx = config.tableWidth != null ? Math.max(config.tableWidth, sumColWidths) : sumColWidths
  // ch-based cols: do not force a px table width wider than the cols (fixed layout would stretch them).
  const shrinkToColumns = config.columnWidths == null && config.tableWidth == null
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
    ...colWidths.map((spec, idx) =>
      React.createElement("col", {
        key: `col-${idx}`,
        style: { width: spec.unit === "ch" ? `${spec.value}ch` : `${spec.value}px` },
      })
    )
  )

  const table = React.createElement(
    "table",
    {
      style: {
        borderCollapse: "collapse",
        tableLayout: "fixed",
        width: shrinkToColumns ? "max-content" : `${tableWidthPx}px`,
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
  tableWidth?: number
  columnWidths?: number[]
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
    tableWidth: config.tableWidth,
    columnWidths: config.columnWidths,
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
    tableWidth: config.tableWidth,
    columnWidths: config.columnWidths,
    columns: [{ header: config.treeColumnHeader ?? "Host", align: "left", minWidth: maxTreeChars }, ...config.columns],
    rows: flat.map(({ row, treePrefix }) => [formatTreeCellLabel(row.label, treePrefix), ...row.cells]),
  }
  return estimateReactTableWidthPx(tableConfig, config.layout ?? layout)
}

export function estimateReactTreeTableHeightPx(config: TreeTableConfig, layout?: Partial<TableLayout>): number {
  const flat = flattenTreeRows(config.rows, config.rootIds)
  const merged = mergeLayout(config.layout ?? layout)
  let height = merged.headerRowHeightPx + flat.length * merged.bodyRowHeightPx
  if (config.title) height += merged.fontSizePx + 4 + merged.sectionGapPx
  return height + merged.sectionGapPx
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
  | { kind: "treeTable"; config: TreeTableConfig }
  | { kind: "keyValue"; config: KeyValueTableConfig & Pick<ReactTableConfig, "tableWidth" | "columnWidths"> }
  | { kind: "threeColumn"; config: ThreeColumnTableConfig & Pick<ReactTableConfig, "tableWidth" | "columnWidths"> }

function logSectionMaxWidthPx(section: LogSection, layout?: Partial<TableLayout>): number {
  switch (section.kind) {
    case "table":
      return estimateReactTableWidthPx({ layout, ...section.config }, layout)
    case "treeTable":
      return estimateReactTreeTableWidthPx(section.config, layout)
    case "keyValue":
      return estimateReactTableWidthPx({ layout, ...keyValueToReactTableConfig(section.config) }, layout)
    case "threeColumn":
      return estimateReactTableWidthPx({ layout, ...threeColumnToReactTableConfig(section.config) }, layout)
    default:
      return 0
  }
}

function logSectionHeightPx(section: LogSection, merged: TableLayout): number {
  switch (section.kind) {
    case "text":
      return estimateTextHeightPx(section.message, merged)
    case "section":
      return merged.sectionGapPx + merged.fontSizePx + 4
    case "table":
      return estimateReactTableHeightPx({ layout: merged, ...section.config }, merged)
    case "treeTable":
      return estimateReactTreeTableHeightPx({ layout: merged, ...section.config }, merged)
    case "keyValue":
      return estimateReactTableHeightPx({ layout: merged, ...keyValueToReactTableConfig(section.config) }, merged)
    case "threeColumn":
      return estimateReactTableHeightPx(
        { layout: merged, ...threeColumnToReactTableConfig(section.config) },
        merged
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
    let max = 0
    for (const section of this.sections) {
      max = Math.max(max, logSectionMaxWidthPx(section, this.layout))
    }
    return max > 0 ? max : mergeLayout(this.layout).tableWidthPx
  }

  /** Tallest stacked content height in px (tables, text, section headers). */
  estimateContentHeightPx(): number {
    const merged = mergeLayout(this.layout)
    let height = 0
    for (const section of this.sections) {
      height += logSectionHeightPx(section, merged)
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
    return renderScriptLog(ns, this.build(), {
      ...this.layout,
      tailTableWidthPx: this.estimateMaxTableWidthPx(),
      tailContentHeightPx: this.estimateContentHeightPx(),
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
    { style: { display: "block", margin: "0", padding: "0" } },
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

  private resolveTailTableWidthPx(): number {
    let maxWidth = 0
    for (const builder of this.builders.values()) {
      maxWidth = Math.max(maxWidth, builder.estimateMaxTableWidthPx())
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

export async function renderScriptLog(ns: NS, content: ReactNode, layout?: Partial<TableLayout>): Promise<void> {
  const renderLayout = layoutForTailRender(layout)
  applyTailSize(ns, renderLayout)
  ns.clearLog()
  ns.printRaw(buildViewportShell(content, renderLayout))
  ns.ui.renderTail()
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
  return resolveTailSize({
    ...layout,
    tailTableWidthPx: merged.tailTableWidthPx ?? merged.tableWidthPx,
    tailContentHeightPx: tableHeightPx + sectionHeight,
  })
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
