import { NS, ReactNode } from "@ns"
import {
  buildReactTable,
  estimateReactTableHeightPx,
  estimateReactTableWidthPx,
  mergeLayout,
  renderScriptLog,
  type ReactTableConfig,
  type TableLayout,
} from "./scriptLogUi.js"

/**
 * Standard tail-window layout for React script logs.
 * Empty partial = {@link DEFAULT_LAYOUT} values from scriptLogUi (12px mono, default row heights).
 * Override here only when a script truly needs different sizing.
 */
export const TAIL_LAYOUT: Readonly<Partial<TableLayout>> = Object.freeze({})

export function mergeTailLayout(overrides?: Partial<TableLayout>): TableLayout {
  return mergeLayout({ ...TAIL_LAYOUT, ...overrides })
}

/** Height of a plain-text block (e.g. summary line above a table). */
export function estimateTextBlockHeightPx(lineCount: number, layout?: Partial<TableLayout>): number {
  const merged = mergeTailLayout(layout)
  return lineCount * (merged.fontSizePx + 4)
}

export interface TailContentSizeHints {
  tailTableWidthPx?: number
  tailContentHeightPx?: number
}

/** Render arbitrary React tail content with optional measured width/height. */
export async function renderTailContent(
  ns: NS,
  content: ReactNode,
  layout?: Partial<TableLayout>,
  sizeHints?: TailContentSizeHints
): Promise<void> {
  await renderScriptLog(ns, content, {
    ...layout,
    tailTableWidthPx: sizeHints?.tailTableWidthPx,
    tailContentHeightPx: sizeHints?.tailContentHeightPx,
  })
}

/** Size and render a single React table using standard ch-based columns. */
export async function renderReactTableLog(ns: NS, config: ReactTableConfig, layout?: Partial<TableLayout>): Promise<void> {
  const tableConfig = { layout, ...config }
  await renderTailContent(ns, buildReactTable(tableConfig), layout, {
    tailTableWidthPx: estimateReactTableWidthPx(tableConfig, layout),
    tailContentHeightPx: estimateReactTableHeightPx(tableConfig, layout),
  })
}
