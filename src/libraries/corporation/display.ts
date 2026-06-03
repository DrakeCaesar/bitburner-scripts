import { CityName, CorpIndustryName, CorpMaterialName, NS } from "@ns"
import { ScriptLogBuilder, type ReactTableConfig, type TableLayout } from "../scriptLogUi.js"
import { buildSimContext } from "./simulation/context.js"
import type { FieldComparison } from "./simulation/types.js"
import type { ValidationRun } from "./simulation/validate.js"
import { type ManagedSupply } from "./supplies.js"

export const FARMLAND_DIVISION = "Farmland"
export const FARMLAND_INDUSTRY: CorpIndustryName = "Agriculture"
export const FARMLAND_START_CITY: CityName = "Sector-12"

export const CORP_LOG_LAYOUT: Partial<TableLayout> = {
  tableWidthPx: 880,
  fontSizePx: 12,
}

function formatMoney(ns: NS, value: number): string {
  return `$${ns.format.number(value)}`
}

function formatJobs(jobs: Record<string, number>): string {
  const parts: string[] = []
  for (const [job, count] of Object.entries(jobs)) {
    if (count > 0 && job !== "Unassigned") {
      parts.push(`${job.slice(0, 3)}:${count}`)
    }
  }
  const unassigned = jobs.Unassigned ?? 0
  if (unassigned > 0) parts.push(`Un:${unassigned}`)
  return parts.length > 0 ? parts.join(" ") : "—"
}

function tryCorpAction(action: () => void): string | null {
  try {
    action()
    return null
  } catch (err) {
    return String(err)
  }
}

/** Create Farmland (Agriculture) and open Sector-12 office + warehouse when affordable. */
export function ensureFarmlandDivision(ns: NS): string[] {
  const corp = ns.corporation
  const lines: string[] = []

  if (!corp.hasCorporation()) return lines

  const info = corp.getCorporation()

  if (!info.divisions.includes(FARMLAND_DIVISION)) {
    const industry = corp.getIndustryData(FARMLAND_INDUSTRY)
    if (info.funds < industry.startingCost) {
      lines.push(
        `Waiting for funds to create ${FARMLAND_DIVISION} (need ${formatMoney(ns, industry.startingCost)})`
      )
      return lines
    }
    const err = tryCorpAction(() => corp.expandIndustry(FARMLAND_INDUSTRY, FARMLAND_DIVISION))
    if (err) {
      lines.push(`Farmland: ${err}`)
      return lines
    }
    lines.push(`Created division ${FARMLAND_DIVISION} (${FARMLAND_INDUSTRY})`)
  }

  const division = corp.getDivision(FARMLAND_DIVISION)

  if (!division.cities.includes(FARMLAND_START_CITY)) {
    const err = tryCorpAction(() => corp.expandCity(FARMLAND_DIVISION, FARMLAND_START_CITY))
    if (err) {
      lines.push(`Farmland/${FARMLAND_START_CITY} office: ${err}`)
      return lines
    }
    lines.push(`Opened office: ${FARMLAND_DIVISION} @ ${FARMLAND_START_CITY}`)
  }

  if (!corp.hasWarehouse(FARMLAND_DIVISION, FARMLAND_START_CITY)) {
    const err = tryCorpAction(() => corp.purchaseWarehouse(FARMLAND_DIVISION, FARMLAND_START_CITY))
    if (err) {
      lines.push(`Farmland warehouse: ${err}`)
      return lines
    }
    lines.push(`Purchased warehouse: ${FARMLAND_DIVISION} @ ${FARMLAND_START_CITY}`)
  }

  return lines
}

function populateCorporationLog(ns: NS, builder: ScriptLogBuilder, managedSupplies: ManagedSupply[] = []): void {
  const corp = ns.corporation

  if (!corp.hasCorporation()) {
    builder.text("No corporation yet — waiting to create dracorp…")
    return
  }

  const info = corp.getCorporation()
  const state = `${info.prevState} → ${info.nextState}`

  builder.keyValueTable({
    title: info.name,
    rows: [
      { label: "Funds", value: formatMoney(ns, info.funds) },
      { label: "Valuation", value: formatMoney(ns, info.valuation) },
      { label: "Revenue/s", value: formatMoney(ns, info.revenue) },
      { label: "Expenses/s", value: formatMoney(ns, info.expenses) },
      { label: "Corp state", value: state },
      { label: "Public", value: info.public ? "yes" : "no" },
    ],
  })

  if (!info.divisions.includes(FARMLAND_DIVISION)) {
    return
  }

  const division = corp.getDivision(FARMLAND_DIVISION)
  const industry = corp.getIndustryData(division.industry)
  const profitLast = division.lastCycleRevenue - division.lastCycleExpenses
  const profitThis = division.thisCycleRevenue - division.thisCycleExpenses

  builder.keyValueTable({
    title: `${FARMLAND_DIVISION} (${division.industry})`,
    rows: [
      { label: "Awareness", value: division.awareness.toFixed(2) },
      { label: "Popularity", value: division.popularity.toFixed(2) },
      { label: "Production mult", value: division.productionMult.toFixed(3) },
      { label: "Research", value: ns.format.number(division.researchPoints) },
      { label: "Ad campaigns", value: String(division.numAdVerts) },
      { label: "Last cycle rev", value: formatMoney(ns, division.lastCycleRevenue) },
      { label: "Last cycle exp", value: formatMoney(ns, division.lastCycleExpenses) },
      { label: "Last cycle profit", value: formatMoney(ns, profitLast) },
      { label: "This cycle rev", value: formatMoney(ns, division.thisCycleRevenue) },
      { label: "This cycle exp", value: formatMoney(ns, division.thisCycleExpenses) },
      { label: "This cycle profit", value: formatMoney(ns, profitThis) },
      { label: "Cities", value: division.cities.join(", ") || "—" },
    ],
  })

  const officeRows: string[][] = []
  for (const city of division.cities) {
    const office = corp.getOffice(FARMLAND_DIVISION, city)
    officeRows.push([
      city,
      `${office.numEmployees}/${office.size}`,
      `${office.avgMorale.toFixed(0)}%`,
      `${office.avgEnergy.toFixed(0)}%`,
      formatJobs(office.employeeJobs),
      ns.format.number(office.totalExperience, 0),
    ])
  }

  if (officeRows.length > 0) {
    builder.table(buildOfficeTable(officeRows))
  }

  const supplyRows: string[][] = managedSupplies.map((s) => [
    s.city,
    s.material,
    ns.format.number(s.stored, 1),
    s.consumptionPerSec.toFixed(2),
    s.buyPerSec.toFixed(2),
    s.tier,
  ])

  if (supplyRows.length > 0) {
    builder.table(buildSupplyTable(supplyRows))
  }

  const materialRows: string[][] = []
  const materialNames = new Set<CorpMaterialName>()
  for (const name of industry.producedMaterials ?? []) {
    materialNames.add(name as CorpMaterialName)
  }

  for (const city of division.cities) {
    if (!corp.hasWarehouse(FARMLAND_DIVISION, city)) continue
    const warehouse = corp.getWarehouse(FARMLAND_DIVISION, city)
    for (const materialName of materialNames) {
      try {
        const mat = corp.getMaterial(FARMLAND_DIVISION, city, materialName)
        const sell =
          typeof mat.desiredSellPrice === "string" ? mat.desiredSellPrice : formatMoney(ns, mat.desiredSellPrice)
        const sellAmt =
          typeof mat.desiredSellAmount === "string" ? mat.desiredSellAmount : ns.format.number(mat.desiredSellAmount)
        materialRows.push([
          city,
          materialName,
          ns.format.number(mat.stored, 1),
          ns.format.number(mat.productionAmount, 2),
          String(mat.quality),
          formatMoney(ns, mat.marketPrice),
          `${sellAmt} @ ${sell}`,
          mat.demand != null ? mat.demand.toFixed(2) : "—",
          `${warehouse.sizeUsed}/${warehouse.size}`,
        ])
      } catch {
        // material not present in this warehouse yet
      }
    }

  }

  if (materialRows.length > 0) {
    builder.table(buildMaterialTable(materialRows))
  } else if (division.cities.some((city) => corp.hasWarehouse(FARMLAND_DIVISION, city))) {
    builder.text("Warehouse open — no tracked materials in storage yet.")
  }
}

function formatSimPct(rel: number | null): string {
  if (rel == null) return "—"
  return `${(rel * 100).toFixed(1)}%`
}

function appendSimulationLog(builder: ScriptLogBuilder, ns: NS, run: ValidationRun, history: ValidationRun[]): void {
  const div = run.before.divisions.find((d) => d.name === FARMLAND_DIVISION)
  const ctx = buildSimContext(ns, div?.advertisingFactor ?? 0.04)
  const info = ns.corporation.getCorporation()

  builder.text(
    [
      `Simulation (${run.result.allOk ? "PASS" : "FAIL"}): stage ${run.stage}`,
      `Corp cycle: ${info.prevState} → ${info.nextState} | corpProductionMult=${ctx.corpProductionMult}`,
    ].join("\n")
  )

  builder.table({
    title: "Sim summary",
    columns: [
      { header: "City", align: "left" },
      { header: "Match", align: "center" },
      { header: "Notes", align: "left", minWidth: 48 },
    ],
    rows: [[`${run.result.city}`, run.result.allOk ? "PASS" : "FAIL", run.result.notes.join(" · ") || "—"]],
  })

  if (run.result.comparisons.length > 0) {
    builder.table({
      title: "Sim: predicted vs actual",
      columns: [
        { header: "Field", align: "left", minWidth: 22 },
        { header: "Predicted", align: "right", minWidth: 12 },
        { header: "Actual", align: "right", minWidth: 12 },
        { header: "Δ", align: "right", minWidth: 10 },
        { header: "Err%", align: "right", minWidth: 8 },
        { header: "OK", align: "center", minWidth: 4 },
      ],
      rows: run.result.comparisons.map((c: FieldComparison) => [
        c.path,
        Number.isFinite(c.predicted) ? c.predicted.toFixed(3) : "—",
        Number.isFinite(c.actual) ? c.actual.toFixed(3) : "—",
        Number.isFinite(c.delta) ? c.delta.toFixed(3) : "—",
        formatSimPct(c.relError),
        c.ok ? "✓" : "✗",
      ]),
    })
  }

  if (history.length > 1) {
    builder.table({
      title: "Sim: recent stages",
      columns: [
        { header: "Stage", align: "left", minWidth: 10 },
        { header: "OK", align: "center", minWidth: 4 },
        { header: "Fails", align: "right", minWidth: 6 },
        { header: "Notes", align: "left", minWidth: 36 },
      ],
      rows: history.map((h) => [
        h.stage,
        h.result.allOk ? "✓" : "✗",
        String(h.result.comparisons.filter((c) => !c.ok).length),
        h.result.notes.join("; ") || "—",
      ]),
    })
  }
}

export async function renderCorporationDashboard(
  ns: NS,
  statusLines: string[],
  managedSupplies: ManagedSupply[] = [],
  simRun: ValidationRun | null = null,
  simHistory: ValidationRun[] = []
): Promise<void> {
  const builder = new ScriptLogBuilder(CORP_LOG_LAYOUT)
  populateCorporationLog(ns, builder, managedSupplies)
  if (simRun) {
    appendSimulationLog(builder, ns, simRun, simHistory)
  }
  if (statusLines.length > 0) {
    builder.text(statusLines.join("\n"))
  }
  await builder.render(ns)
}

function buildSupplyTable(rows: string[][]): ReactTableConfig {
  return {
    title: "Input supplies (Water, Chemicals)",
    columns: [
      { header: "City", align: "left", minWidth: 12 },
      { header: "Material", align: "left", minWidth: 10 },
      { header: "Stored", align: "right", minWidth: 8 },
      { header: "Use/s", align: "right", minWidth: 8 },
      { header: "Buy/s", align: "right", minWidth: 8 },
      { header: "Tier", align: "left", minWidth: 6 },
    ],
    rows,
  }
}

function buildOfficeTable(rows: string[][]): ReactTableConfig {
  return {
    title: "Offices",
    columns: [
      { header: "City", align: "left", minWidth: 12 },
      { header: "Staff", align: "right", minWidth: 8 },
      { header: "Morale", align: "right", minWidth: 7 },
      { header: "Energy", align: "right", minWidth: 7 },
      { header: "Jobs", align: "left", minWidth: 22 },
      { header: "XP", align: "right", minWidth: 8 },
    ],
    rows,
  }
}

function buildMaterialTable(rows: string[][]): ReactTableConfig {
  return {
    title: "Produce (sell MAX @ MP)",
    columns: [
      { header: "City", align: "left", minWidth: 12 },
      { header: "Material", align: "left", minWidth: 10 },
      { header: "Stored", align: "right", minWidth: 8 },
      { header: "Rate/s", align: "right", minWidth: 8 },
      { header: "Qual", align: "right", minWidth: 5 },
      { header: "Mkt $", align: "right", minWidth: 8 },
      { header: "Sell", align: "left", minWidth: 14 },
      { header: "Demand", align: "right", minWidth: 7 },
      { header: "WH used", align: "right", minWidth: 9 },
    ],
    rows,
  }
}
