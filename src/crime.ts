import { CrimeType, NS, ReactNode } from "@ns"

type CrimeMode = "money" | "karma" | "xp"

interface CrimeInfo {
  name: CrimeType
  chance: number
  expectedProfitPerMs: number
  expectedKarmaPerMs: number
  totalXpPerMs: number
}

const React = eval("window.React") as {
  createElement(type: string, props?: Record<string, unknown> | null, ...children: unknown[]): ReactNode
}

const LAYOUT = {
  fontSizePx: 12,
  paddingXPx: 8,
  borderPx: 1,
  headerRowHeightPx: 26,
  bodyRowHeightPx: 22,
  tableWidthPx: 640,
  tailTitleBarPx: 33,
  colCrimePx: 160,
  colSuccessPx: 72,
  colMetricPx: 136,
} as const

const HIGHLIGHT_BG = "rgba(0, 255, 0, 0.18)"
const SELECTED_ROW_BG = "rgba(255, 255, 255, 0.06)"
const ACTIVE_HEADER_BG = "rgba(0, 255, 0, 0.12)"

function getCrimeInfos(ns: NS): CrimeInfo[] {
  return Object.values(ns.enums.CrimeType).map((crime) => {
    const stats = ns.singularity.getCrimeStats(crime)
    const chance = ns.singularity.getCrimeChance(crime)
    const profitPerMs = stats.money / stats.time
    const karmaPerMs = Math.abs(stats.karma) / stats.time
    const totalXpPerMs =
      (stats.hacking_exp +
        stats.strength_exp +
        stats.defense_exp +
        stats.dexterity_exp +
        stats.agility_exp +
        stats.charisma_exp) /
      stats.time

    return {
      name: crime,
      chance,
      expectedProfitPerMs: profitPerMs * chance,
      expectedKarmaPerMs: karmaPerMs * chance,
      totalXpPerMs,
    }
  })
}

function compareCrimesByMode(a: CrimeInfo, b: CrimeInfo, mode: CrimeMode): number {
  if (mode === "karma") return b.expectedKarmaPerMs - a.expectedKarmaPerMs
  if (mode === "money") return b.expectedProfitPerMs - a.expectedProfitPerMs
  return b.totalXpPerMs - a.totalXpPerMs
}

function pickBestCrime(crimeInfos: CrimeInfo[], mode: CrimeMode): CrimeInfo {
  return [...crimeInfos].sort((a, b) => compareCrimesByMode(a, b, mode))[0]
}

function getBestCrimesByColumn(crimeInfos: CrimeInfo[]): Record<CrimeMode, CrimeType> {
  return {
    karma: pickBestCrime(crimeInfos, "karma").name,
    money: pickBestCrime(crimeInfos, "money").name,
    xp: pickBestCrime(crimeInfos, "xp").name,
  }
}

function formatKarmaRate(ratePerMs: number): string {
  return `${(ratePerMs * 1000).toFixed(2)}/s`
}

function formatMoneyRate(ns: NS, ratePerMs: number): string {
  return `$${ns.format.number(ratePerMs * 1000)}/s`
}

function formatXpRate(ns: NS, ratePerMs: number): string {
  return `${ns.format.number(ratePerMs * 1000)}/s`
}

function baseCellStyle(
  rowHeightPx: number,
  highlight: boolean,
  selectedRow: boolean,
  borderColor: string
): Record<string, string> {
  return {
    boxSizing: "border-box",
    height: `${rowHeightPx}px`,
    lineHeight: `${LAYOUT.fontSizePx}px`,
    padding: `0 ${LAYOUT.paddingXPx}px`,
    border: `${LAYOUT.borderPx}px solid ${borderColor}`,
    fontSize: `${LAYOUT.fontSizePx}px`,
    verticalAlign: "middle",
    backgroundColor: highlight ? HIGHLIGHT_BG : selectedRow ? SELECTED_ROW_BG : "transparent",
    whiteSpace: "nowrap",
  }
}

function cellStyle(highlight: boolean, selectedRow: boolean): Record<string, string> {
  return baseCellStyle(LAYOUT.bodyRowHeightPx, highlight, selectedRow, "rgba(255, 255, 255, 0.08)")
}

function headerStyle(activeMode: boolean): Record<string, string> {
  return {
    ...baseCellStyle(LAYOUT.headerRowHeightPx, false, false, "rgba(255, 255, 255, 0.15)"),
    fontWeight: "bold",
    backgroundColor: activeMode ? ACTIVE_HEADER_BG : "rgba(255, 255, 255, 0.04)",
  }
}

function buildCrimeTable(ns: NS, crimeInfos: CrimeInfo[], mode: CrimeMode, selected: CrimeInfo): ReactNode {
  const bestByColumn = getBestCrimesByColumn(crimeInfos)
  const rows = [...crimeInfos].sort((a, b) => compareCrimesByMode(a, b, mode))

  return React.createElement(
    "div",
    { style: { display: "block", margin: "0", padding: "0" } },
    React.createElement(
      "table",
      {
        style: {
          borderCollapse: "collapse",
          tableLayout: "fixed",
          width: `${LAYOUT.tableWidthPx}px`,
          margin: "0",
          fontFamily: "monospace",
          fontSize: `${LAYOUT.fontSizePx}px`,
        },
      },
      React.createElement(
        "colgroup",
        null,
        React.createElement("col", { style: { width: `${LAYOUT.colCrimePx}px` } }),
        React.createElement("col", { style: { width: `${LAYOUT.colSuccessPx}px` } }),
        React.createElement("col", { style: { width: `${LAYOUT.colMetricPx}px` } }),
        React.createElement("col", { style: { width: `${LAYOUT.colMetricPx}px` } }),
        React.createElement("col", { style: { width: `${LAYOUT.colMetricPx}px` } })
      ),
      React.createElement(
        "thead",
        null,
        React.createElement(
          "tr",
          null,
          React.createElement("th", { style: headerStyle(false) }, "Crime"),
          React.createElement("th", { style: headerStyle(false) }, "Success"),
          React.createElement("th", { style: headerStyle(mode === "karma") }, "Karma"),
          React.createElement("th", { style: headerStyle(mode === "money") }, "Money"),
          React.createElement("th", { style: headerStyle(mode === "xp") }, "XP")
        )
      ),
      React.createElement(
        "tbody",
        null,
        ...rows.map((crime) => {
          const selectedRow = crime.name === selected.name

          return React.createElement(
            "tr",
            { key: crime.name },
            React.createElement("td", { style: cellStyle(false, selectedRow) }, crime.name),
            React.createElement(
              "td",
              { style: { ...cellStyle(false, selectedRow), textAlign: "right" } },
              `${(crime.chance * 100).toFixed(1)}%`
            ),
            React.createElement(
              "td",
              {
                style: {
                  ...cellStyle(crime.name === bestByColumn.karma, selectedRow),
                  textAlign: "right",
                },
              },
              formatKarmaRate(crime.expectedKarmaPerMs)
            ),
            React.createElement(
              "td",
              {
                style: {
                  ...cellStyle(crime.name === bestByColumn.money, selectedRow),
                  textAlign: "right",
                },
              },
              formatMoneyRate(ns, crime.expectedProfitPerMs)
            ),
            React.createElement(
              "td",
              {
                style: { ...cellStyle(crime.name === bestByColumn.xp, selectedRow), textAlign: "right" },
              },
              formatXpRate(ns, crime.totalXpPerMs)
            )
          )
        })
      )
    )
  )
}

function tailSizeForTable(crimeRowCount: number): { width: number; height: number } {
  const tableHeightPx = LAYOUT.headerRowHeightPx + crimeRowCount * LAYOUT.bodyRowHeightPx
  return {
    width: LAYOUT.tableWidthPx,
    height: tableHeightPx + LAYOUT.tailTitleBarPx,
  }
}

function renderCrimeTable(ns: NS, crimeInfos: CrimeInfo[], mode: CrimeMode, selected: CrimeInfo): void {
  ns.clearLog()
  ns.printRaw(buildCrimeTable(ns, crimeInfos, mode, selected))
  ns.ui.renderTail()
}

function parseMode(ns: NS): CrimeMode {
  const arg = String(ns.args[0] ?? "")
  if (arg === "karma" || arg === "k") return "karma"
  if (arg === "money" || arg === "m") return "money"
  if (arg === "xp" || arg === "x") return "xp"
  return "xp"
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL")
  const mode = parseMode(ns)

  ns.ui.openTail()
  ns.ui.setTailTitle(`Crime - ${mode}`)
  ns.ui.setTailFontSize(LAYOUT.fontSizePx)

  let tailSized = false

  for (;;) {
    const crimeInfos = getCrimeInfos(ns)
    const bestCrime = pickBestCrime(crimeInfos, mode)

    renderCrimeTable(ns, crimeInfos, mode, bestCrime)

    if (!tailSized) {
      const { width, height } = tailSizeForTable(crimeInfos.length)
      ns.ui.resizeTail(width, height)
      tailSized = true
    }

    const crimeTime = ns.singularity.commitCrime(bestCrime.name, false)
    await ns.sleep(crimeTime + 10)
  }
}
