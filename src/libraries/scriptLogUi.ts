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
}

export function getReact(): ReactRef {
  return eval("window.React") as ReactRef
}

export function mergeLayout(partial?: Partial<TableLayout>): TableLayout {
  return { ...DEFAULT_LAYOUT, ...partial }
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

function computeColumnWidths(config: TableConfig, columnWidths?: number[]): number[] {
  if (columnWidths) return columnWidths

  return config.columns.map((col, colIdx) => {
    let maxWidth = col.header.length
    for (const row of config.rows) {
      if (row[colIdx]) maxWidth = Math.max(maxWidth, row[colIdx].length)
    }
    return Math.max(maxWidth, col.minWidth ?? 0)
  })
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
  const tableWidth = config.tableWidth ?? layout.tableWidthPx
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
  const { rows, title, separatorAfter = [], valueAlign = "right" } = config
  return buildReactTable({
    title,
    layout: config.layout,
    tableWidth: config.tableWidth,
    columns: [
      { header: "", align: "left" },
      { header: "", align: valueAlign },
    ],
    rows: rows.map((r) => [r.label, r.value]),
    separatorAfter,
  })
}

export function buildReactThreeColumnTable(
  config: ThreeColumnTableConfig & Pick<ReactTableConfig, "layout" | "tableWidth">
): ReactNode {
  const { headers, rows, title, separatorAfter = [], align = ["left", "right", "right"] } = config
  return buildReactTable({
    title,
    layout: config.layout,
    tableWidth: config.tableWidth,
    columns: [
      { header: headers[0], align: align[0] },
      { header: headers[1], align: align[1] },
      { header: headers[2], align: align[2] },
    ],
    rows,
    separatorAfter,
  })
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

export class ScriptLogBuilder {
  private sections: ReactNode[] = []
  private layout?: Partial<TableLayout>

  constructor(layout?: Partial<TableLayout>) {
    this.layout = layout
  }

  reset(): this {
    this.sections = []
    return this
  }

  text(message: string): this {
    this.sections.push(buildTextBlock(message, this.layout))
    return this
  }

  section(title: string): this {
    this.sections.push(buildSectionHeader(title, this.layout))
    return this
  }

  table(config: ReactTableConfig): this {
    this.sections.push(buildReactTable({ layout: this.layout, ...config }))
    return this
  }

  keyValueTable(config: KeyValueTableConfig & Pick<ReactTableConfig, "tableWidth" | "columnWidths">): this {
    this.sections.push(buildReactKeyValueTable({ layout: this.layout, ...config }))
    return this
  }

  threeColumnTable(config: ThreeColumnTableConfig & Pick<ReactTableConfig, "tableWidth" | "columnWidths">): this {
    this.sections.push(buildReactThreeColumnTable({ layout: this.layout, ...config }))
    return this
  }

  build(): ReactNode {
    return buildStack(this.sections, this.layout)
  }

  render(ns: NS): void {
    renderScriptLog(ns, this.build())
  }
}

export function renderScriptLog(ns: NS, content: ReactNode): void {
  ns.clearLog()
  ns.printRaw(content)
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
