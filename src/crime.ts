import { CrimeType, NS } from "@ns"
import {
  buildReactTable,
  initScriptLogTail,
  renderScriptLog,
  tailSizeForTable,
  type TableLayout,
} from "./libraries/scriptLogUi.js"

type CrimeMode = "money" | "karma" | "xp"

interface CrimeInfo {
  name: CrimeType
  chance: number
  expectedProfitPerMs: number
  expectedKarmaPerMs: number
  totalXpPerMs: number
}

const CRIME_LAYOUT: Partial<TableLayout> = {
  tableWidthPx: 640,
}

const COL_WIDTHS = [160, 72, 136, 136, 136]

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

function buildCrimeTable(ns: NS, crimeInfos: CrimeInfo[], mode: CrimeMode, selected: CrimeInfo) {
  const bestByColumn = getBestCrimesByColumn(crimeInfos)
  const rows = [...crimeInfos].sort((a, b) => compareCrimesByMode(a, b, mode))
  const highlightCells = new Set<string>()
  const activeHeaderColumns = new Set<number>()

  if (mode === "karma") activeHeaderColumns.add(2)
  if (mode === "money") activeHeaderColumns.add(3)
  if (mode === "xp") activeHeaderColumns.add(4)

  rows.forEach((crime, rowIdx) => {
    if (crime.name === bestByColumn.karma) highlightCells.add(`${rowIdx},2`)
    if (crime.name === bestByColumn.money) highlightCells.add(`${rowIdx},3`)
    if (crime.name === bestByColumn.xp) highlightCells.add(`${rowIdx},4`)
  })

  const selectedRowIndex = rows.findIndex((crime) => crime.name === selected.name)

  return buildReactTable({
    layout: CRIME_LAYOUT,
    tableWidth: CRIME_LAYOUT.tableWidthPx,
    columnWidths: COL_WIDTHS,
    columns: [
      { header: "Crime", align: "left" },
      { header: "Success", align: "right" },
      { header: "Karma", align: "right" },
      { header: "Money", align: "right" },
      { header: "XP", align: "right" },
    ],
    rows: rows.map((crime) => [
      crime.name,
      `${(crime.chance * 100).toFixed(1)}%`,
      formatKarmaRate(crime.expectedKarmaPerMs),
      formatMoneyRate(ns, crime.expectedProfitPerMs),
      formatXpRate(ns, crime.totalXpPerMs),
    ]),
    selectedRowIndex,
    highlightCells,
    activeHeaderColumns,
  })
}

async function renderCrimeTable(
  ns: NS,
  crimeInfos: CrimeInfo[],
  mode: CrimeMode,
  selected: CrimeInfo,
  tailHeightPx?: number
): Promise<void> {
  await renderScriptLog(ns, buildCrimeTable(ns, crimeInfos, mode, selected), { ...CRIME_LAYOUT, tailHeightPx })
}

function parseMode(ns: NS): CrimeMode {
  const arg = String(ns.args[0] ?? "")
  if (arg === "karma" || arg === "k") return "karma"
  if (arg === "money" || arg === "m") return "money"
  if (arg === "xp" || arg === "x") return "xp"
  return "xp"
}

export async function main(ns: NS): Promise<void> {
  const mode = parseMode(ns)

  initScriptLogTail(ns, `Crime - ${mode}`, CRIME_LAYOUT)

  let tailHeightPx: number | undefined

  for (;;) {
    const crimeInfos = getCrimeInfos(ns)
    const bestCrime = pickBestCrime(crimeInfos, mode)

    if (tailHeightPx == null) {
      const { width, height } = tailSizeForTable(crimeInfos.length, CRIME_LAYOUT)
      ns.ui.resizeTail(width, height)
      tailHeightPx = height
    }

    await renderCrimeTable(ns, crimeInfos, mode, bestCrime, tailHeightPx)

    const crimeTime = ns.singularity.commitCrime(bestCrime.name, false)
    await ns.sleep(crimeTime + 10)
  }
}
