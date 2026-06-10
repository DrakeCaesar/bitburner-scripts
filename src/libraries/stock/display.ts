import { NS } from "@ns"
import { TabbedScriptLogBuilder, type TabDefinition } from "@/libraries/scriptLogUi.js"
import { TAIL_LAYOUT } from "@/libraries/scriptLogUiLayout.js"
import { formatSnapshotMoney } from "@/libraries/stock/trader.js"
import type { StockSymbolSnapshot, StockTraderSnapshot } from "@/libraries/stock/types.js"

export const STOCK_TABS: TabDefinition[] = [
  { id: "overview", label: "Overview" },
  { id: "positions", label: "Positions" },
  { id: "log", label: "Log" },
]

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function formatPosition(snap: StockSymbolSnapshot): string {
  const parts: string[] = []
  if (snap.longShares > 0) parts.push(`L ${snap.longShares}`)
  if (snap.shortShares > 0) parts.push(`S ${snap.shortShares}`)
  return parts.length > 0 ? parts.join(" ") : "-"
}

function populateOverviewTab(ns: NS, tabbedLog: TabbedScriptLogBuilder, snapshot: StockTraderSnapshot): void {
  const builder = tabbedLog.tab("overview")
  builder.keyValueTable({
    title: "WSE portfolio",
    rows: [
      { label: "Home cash", value: formatSnapshotMoney(ns, snapshot.homeCash) },
      { label: "Cash reserve", value: formatSnapshotMoney(ns, snapshot.moneyKeep) },
      { label: "Investable", value: formatSnapshotMoney(ns, snapshot.investableCash) },
      { label: "Positions value", value: formatSnapshotMoney(ns, snapshot.portfolioValue) },
      { label: "Net worth", value: formatSnapshotMoney(ns, snapshot.totalNetWorth) },
      { label: "Session P/L", value: formatSnapshotMoney(ns, snapshot.sessionProfit) },
      { label: "Ticks", value: String(snapshot.tickCount) },
      { label: "Commission", value: formatSnapshotMoney(ns, snapshot.commission) },
      { label: "Strategy", value: snapshot.configSummary },
    ],
    separatorAfter: [4],
  })

  builder.text("Session P/L: net worth vs first tick (home cash + marked positions).")
}

function populatePositionsTab(ns: NS, tabbedLog: TabbedScriptLogBuilder, snapshot: StockTraderSnapshot): void {
  const builder = tabbedLog.tab("positions")
  const highlightCells = new Set<string>()

  const rows = snapshot.symbols.map((snap, rowIdx) => {
    const hasPosition = snap.longShares > 0 || snap.shortShares > 0
    const actionable = snap.signal !== "wait"
    if (hasPosition || actionable) {
      for (let col = 0; col < 7; col++) highlightCells.add(`${rowIdx},${col}`)
    }

    const unrealized = snap.longUnrealized + snap.shortUnrealized
    return [
      snap.symbol,
      formatSnapshotMoney(ns, snap.price),
      pct(snap.forecast),
      pct(snap.volatility),
      formatPosition(snap),
      snap.signal,
      formatSnapshotMoney(ns, unrealized),
    ]
  })

  builder.table({
    title: "Symbols (4S)",
    columns: [
      { header: "Sym", align: "left", minWidth: 5 },
      { header: "Price", align: "right", minWidth: 10 },
      { header: "Fcst", align: "right", minWidth: 6 },
      { header: "Vol", align: "right", minWidth: 6 },
      { header: "Pos", align: "left", minWidth: 10 },
      { header: "Signal", align: "left", minWidth: 14 },
      { header: "Unreal P/L", align: "right", minWidth: 12 },
    ],
    rows,
    highlightCells,
  })
}

function populateLogTab(tabbedLog: TabbedScriptLogBuilder, snapshot: StockTraderSnapshot): void {
  const builder = tabbedLog.tab("log")
  if (snapshot.lastTickActions.length > 0) {
    builder.text(snapshot.lastTickActions.join("\n"))
  } else {
    builder.text("(no actions yet)")
  }
}

export async function renderStockTraderDashboard(
  ns: NS,
  tabbedLog: TabbedScriptLogBuilder,
  snapshot: StockTraderSnapshot
): Promise<void> {
  tabbedLog.clearPanels()
  populateOverviewTab(ns, tabbedLog, snapshot)
  populatePositionsTab(ns, tabbedLog, snapshot)
  populateLogTab(tabbedLog, snapshot)
  await tabbedLog.render(ns)
}
