/**
 * Public API for React script-log (tail) UIs.
 *
 * Entry scripts and display builders should import from here, not scriptLogUi.ts directly.
 *
 * Patterns:
 * - Single table:  createTailLog().table(config).render(ns)
 * - Stacked:       createTailLog().text(...).table(...).render(ns)
 * - Tabbed:        createTabbedTailLog(TABS).tab("id").table(...); tabbed.render(ns)
 */

import { NS } from "@ns"
import { col, W } from "./reactTableColumns.js"
import type { LogFn } from "./logFn.js"
import {
  DEFAULT_LAYOUT,
  ScriptLogBuilder,
  TabbedScriptLogBuilder,
  initScriptLogTail,
  measureTreeTableHostChars,
  mergeLayout,
  type ReactTableConfig,
  type TabDefinition,
  type TableLayout,
  type TreeTableConfig,
  type TreeTableRow,
} from "./scriptLogUi.js"

export { col, W }
export type { LogFn }
export {
  DEFAULT_LAYOUT,
  ScriptLogBuilder,
  TabbedScriptLogBuilder,
  initScriptLogTail,
  measureTreeTableHostChars,
  mergeLayout,
  type ReactTableConfig,
  type TabDefinition,
  type TableLayout,
  type TreeTableConfig,
  type TreeTableRow,
}

/** Standard layout for all React tail windows (12px mono, default row heights). */
export const TAIL_LAYOUT: Readonly<TableLayout> = Object.freeze({ ...DEFAULT_LAYOUT })

export function mergeTailLayout(overrides?: Partial<TableLayout>): TableLayout {
  return mergeLayout(overrides ? { ...TAIL_LAYOUT, ...overrides } : TAIL_LAYOUT)
}

/** Fluent builder for a single tail panel (text, tables, sections). */
export function createTailLog(overrides?: Partial<TableLayout>): ScriptLogBuilder {
  return new ScriptLogBuilder(overrides)
}

/** Fluent builder for a tabbed tail window. */
export function createTabbedTailLog(tabs: TabDefinition[], overrides?: Partial<TableLayout>): TabbedScriptLogBuilder {
  return new TabbedScriptLogBuilder(tabs, overrides)
}

/** Open tail window with standard layout (call once at script start). */
export function openTailLog(ns: NS, title: string, overrides?: Partial<TableLayout>): void {
  initScriptLogTail(ns, title, overrides)
}

/** Render one table in the tail (sugar over createTailLog). */
export async function renderTailTable(ns: NS, config: ReactTableConfig, overrides?: Partial<TableLayout>): Promise<void> {
  await createTailLog(overrides).table(config).render(ns)
}
