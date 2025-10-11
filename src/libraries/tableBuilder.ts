/**
 * Table Builder Library
 * Provides utilities for building beautiful formatted tables with box-drawing characters
 */

/** Alignment options for table columns */
export type Alignment = "left" | "right" | "center"

/** Configuration for a single column */
export interface ColumnConfig {
  /** Column header text */
  header: string
  /** Alignment for this column (default: left for first column, right for others) */
  align?: Alignment
  /** Minimum width for this column (optional) */
  minWidth?: number
}

/** A single row of data (array of cell values) */
export type TableRow = string[]

/** Configuration for building a table */
export interface TableConfig {
  /** Column configurations */
  columns: ColumnConfig[]
  /** Data rows */
  rows: TableRow[]
  /** Optional title to display above the table */
  title?: string
  /** Row indices after which to add separators (0-indexed) */
  separatorAfter?: number[]
}

/** Configuration for building a key-value table (2 columns) */
export interface KeyValueTableConfig {
  /** Pairs of label and value */
  rows: Array<{ label: string; value: string }>
  /** Optional title to display above the table */
  title?: string
  /** Row indices after which to add separators (0-indexed) */
  separatorAfter?: number[]
  /** Alignment for values column (default: right) */
  valueAlign?: Alignment
}

/** Configuration for building a 3-column table (common pattern) */
export interface ThreeColumnTableConfig {
  /** Column headers */
  headers: [string, string, string]
  /** Data rows (each row has 3 values) */
  rows: Array<[string, string, string]>
  /** Optional title */
  title?: string
  /** Row indices after which to add separators (0-indexed) */
  separatorAfter?: number[]
  /** Alignment for each column (default: left, right, right) */
  align?: [Alignment, Alignment, Alignment]
}

/**
 * Pad a string to a given length with specified alignment
 */
function padString(str: string, length: number, align: Alignment = "left"): string {
  if (align === "left") {
    return str.padEnd(length)
  } else if (align === "right") {
    return str.padStart(length)
  } else {
    // center
    const totalPad = length - str.length
    const leftPad = Math.floor(totalPad / 2)
    const rightPad = totalPad - leftPad
    return " ".repeat(leftPad) + str + " ".repeat(rightPad)
  }
}

/**
 * Build a formatted table with box-drawing characters
 *
 * @param config Table configuration
 * @returns Formatted table string ready for printing
 *
 * @example
 * ```ts
 * const table = buildTable({
 *   title: "Server Stats",
 *   columns: [
 *     { header: "Server", align: "left" },
 *     { header: "RAM", align: "right" },
 *     { header: "Money", align: "right" }
 *   ],
 *   rows: [
 *     ["n00dles", "4GB", "$1.2m"],
 *     ["foodnstuff", "16GB", "$5.0m"]
 *   ],
 *   separatorAfter: [0] // Add separator after first row
 * })
 * ```
 */
export function buildTable(config: TableConfig): string {
  const { columns, rows, title, separatorAfter = [] } = config

  // Calculate column widths
  const colWidths = columns.map((col, colIdx) => {
    let maxWidth = col.header.length
    for (const row of rows) {
      if (row[colIdx]) {
        maxWidth = Math.max(maxWidth, row[colIdx].length)
      }
    }
    return Math.max(maxWidth, col.minWidth || 0)
  })

  // Determine alignment (default: left for first column, right for others)
  const alignments = columns.map((col, idx) => col.align || (idx === 0 ? "left" : "right"))

  // Build header row
  const headerCells = columns.map((col, idx) => padString(col.header, colWidths[idx], alignments[idx]))

  // Build data rows
  const dataRows = rows.map((row) => row.map((cell, idx) => padString(cell || "", colWidths[idx], alignments[idx])))

  // Build table parts
  const topBorder = `┏━${colWidths.map((w) => "━".repeat(w)).join("━┳━")}━┓`
  const headerSeparator = `┣━${colWidths.map((w) => "━".repeat(w)).join("━╋━")}━┫`
  const rowSeparator = `┣━${colWidths.map((w) => "━".repeat(w)).join("━╋━")}━┫`
  const bottomBorder = `┗━${colWidths.map((w) => "━".repeat(w)).join("━┻━")}━┛`

  // Assemble table
  let table = ""
  if (title) {
    table += `\n═══ ${title} ═══\n`
  }
  table += topBorder + "\n"
  table += `┃ ${headerCells.join(" ┃ ")} ┃\n`
  table += headerSeparator + "\n"

  dataRows.forEach((row, rowIdx) => {
    table += `┃ ${row.join(" ┃ ")} ┃\n`
    if (separatorAfter.includes(rowIdx)) {
      table += rowSeparator + "\n"
    }
  })

  table += bottomBorder

  return table
}

/**
 * Build a simple key-value table (2 columns: label and value)
 *
 * @param config Key-value table configuration
 * @returns Formatted table string
 *
 * @example
 * ```ts
 * const table = buildKeyValueTable({
 *   title: "Batch Configuration",
 *   rows: [
 *     { label: "Target Server", value: "n00dles" },
 *     { label: "Hack Threshold", value: "50.00%" },
 *     { label: "Money/Second", value: "$1.5m/s" }
 *   ],
 *   separatorAfter: [1] // Add separator after second row
 * })
 * ```
 */
export function buildKeyValueTable(config: KeyValueTableConfig): string {
  const { rows, title, separatorAfter = [], valueAlign = "right" } = config

  return buildTable({
    title,
    columns: [
      { header: "", align: "left" }, // Labels don't need a header
      { header: "", align: valueAlign },
    ],
    rows: rows.map((r) => [r.label, r.value]),
    separatorAfter,
  })
}

/**
 * Build a 3-column table (common pattern for operation/threads/ram)
 *
 * @param config Three-column table configuration
 * @returns Formatted table string
 *
 * @example
 * ```ts
 * const table = buildThreeColumnTable({
 *   title: "Thread Distribution",
 *   headers: ["Operation", "Threads", "RAM"],
 *   rows: [
 *     ["Hack", "100", "10GB"],
 *     ["Weaken", "50", "5GB"],
 *     ["Grow", "200", "20GB"]
 *   ],
 *   align: ["left", "right", "right"],
 *   separatorAfter: [2] // Separator after third row
 * })
 * ```
 */
export function buildThreeColumnTable(config: ThreeColumnTableConfig): string {
  const { headers, rows, title, separatorAfter = [], align = ["left", "right", "right"] } = config

  return buildTable({
    title,
    columns: [
      { header: headers[0], align: align[0] },
      { header: headers[1], align: align[1] },
      { header: headers[2], align: align[2] },
    ],
    rows,
    separatorAfter,
  })
}

/**
 * Build a simple text header with box-drawing characters
 *
 * @param text Header text
 * @returns Formatted header string
 *
 * @example
 * ```ts
 * ns.tprint(buildHeader("Server Analysis"))
 * // Output: ═══ Server Analysis ═══
 * ```
 */
export function buildHeader(text: string): string {
  return `\n═══ ${text} ═══`
}
