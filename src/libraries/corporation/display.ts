import { CorpMaterialName, NS } from "@ns"
import {
  ScriptLogBuilder,
  TabbedScriptLogBuilder,
  type ReactTableConfig,
  type TabDefinition,
  type TableLayout,
} from "@/libraries/scriptLogUi.js"
import { FARMLAND_DIVISION } from "@/libraries/corporation/farmland.js"
import { TOBACCO_DIVISION } from "@/libraries/corporation/tobacco.js"
import { buildSimContext } from "@/libraries/corporation/simulation/context.js"
import type { FieldComparison } from "@/libraries/corporation/simulation/types.js"
import type { ValidationRun } from "@/libraries/corporation/simulation/validate.js"
import { buildDivisionHeadcountPlanTables, type HeadcountPlanTable } from "@/libraries/corporation/office.js"
import { asCorpMaterialList } from "@/libraries/corporation/simulation/officeJobs.js"
import { type ManagedSupply } from "@/libraries/corporation/supplies.js"

export const CORP_LOG_LAYOUT: Partial<TableLayout> = {
  tableWidthPx: 880,
  fontSizePx: 12,
}

export const CORP_TABS: TabDefinition[] = [
  { id: "overview", label: "Overview" },
  { id: "warehouse", label: "Warehouse" },
  { id: "staff", label: "Staff" },
  { id: "sim", label: "Sim" },
  { id: "log", label: "Log" },
]

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

function populateOverviewTab(ns: NS, tabbedLog: TabbedScriptLogBuilder, managedSupplies: ManagedSupply[]): void {
  const builder = tabbedLog.tab("overview")
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

  if (info.divisions.includes(FARMLAND_DIVISION)) {
    appendDivisionOverview(ns, builder, FARMLAND_DIVISION)
    if (managedSupplies.length === 0) {
      builder.text("See Warehouse tab for Farmland supplies and produce.")
    }
  }

  if (info.divisions.includes(TOBACCO_DIVISION)) {
    appendDivisionOverview(ns, builder, TOBACCO_DIVISION)
  }
}

function appendDivisionOverview(ns: NS, builder: ScriptLogBuilder, divisionName: string): void {
  const corp = ns.corporation
  const division = corp.getDivision(divisionName)
  const profitLast = division.lastCycleRevenue - division.lastCycleExpenses
  const profitThis = division.thisCycleRevenue - division.thisCycleExpenses

  builder.keyValueTable({
    title: `${divisionName} (${division.industry})`,
    rows: [
      { label: "Awareness", value: division.awareness.toFixed(2) },
      { label: "Popularity", value: division.popularity.toFixed(2) },
      { label: "Production mult", value: division.productionMult.toFixed(3) },
      { label: "Research", value: ns.format.number(division.researchPoints) },
      { label: "Ad campaigns", value: String(division.numAdVerts) },
      { label: "Products", value: division.products.length > 0 ? division.products.join(", ") : "—" },
      { label: "Revenue/s (last)", value: formatMoney(ns, division.lastCycleRevenue) },
      { label: "Expenses/s (last)", value: formatMoney(ns, division.lastCycleExpenses) },
      { label: "Profit/s (last)", value: formatMoney(ns, profitLast) },
      { label: "This cycle rev", value: formatMoney(ns, division.thisCycleRevenue) },
      { label: "This cycle exp", value: formatMoney(ns, division.thisCycleExpenses) },
      { label: "This cycle profit", value: formatMoney(ns, profitThis) },
      { label: "Cities", value: division.cities.join(", ") || "—" },
    ],
  })

  const officeRows: string[][] = []
  for (const city of division.cities) {
    try {
      const office = corp.getOffice(divisionName, city)
      officeRows.push([
        city,
        `${office.numEmployees}/${office.size}`,
        `${office.avgMorale.toFixed(0)}%`,
        `${office.avgEnergy.toFixed(0)}%`,
        formatJobs(office.employeeJobs),
        ns.format.number(office.totalExperience, 0),
      ])
    } catch {
      officeRows.push([city, "—", "—", "—", "no office", "—"])
    }
  }

  if (officeRows.length > 0) {
    builder.table(buildOfficeTable(`${divisionName} offices`, officeRows))
  }
}

function collectOfficeSnapshotRows(ns: NS): string[][] {
  const corp = ns.corporation
  const rows: string[][] = []
  if (!corp.hasCorporation()) return rows

  for (const divisionName of corp.getCorporation().divisions) {
    const division = corp.getDivision(divisionName)
    for (const city of division.cities) {
      try {
        const office = corp.getOffice(divisionName, city)
        rows.push([
          divisionName,
          city,
          `${office.numEmployees}/${office.size}`,
          `${office.avgMorale.toFixed(0)}%`,
          `${office.avgEnergy.toFixed(0)}%`,
          formatJobs(office.employeeJobs),
          ns.format.number(office.totalExperience, 0),
        ])
      } catch {
        rows.push([divisionName, city, "—", "—", "—", "no office", "—"])
      }
    }
  }

  return rows
}

function populateWarehouseTab(ns: NS, tabbedLog: TabbedScriptLogBuilder, managedSupplies: ManagedSupply[]): void {
  const builder = tabbedLog.tab("warehouse")
  const corp = ns.corporation

  if (!corp.hasCorporation() || !corp.getCorporation().divisions.includes(FARMLAND_DIVISION)) {
    builder.text("No Farmland division yet.")
    return
  }

  const division = corp.getDivision(FARMLAND_DIVISION)
  const industry = corp.getIndustryData(division.industry)

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
  } else {
    builder.text("No input supply data yet.")
  }

  const materialRows: string[][] = []
  const materialNames = new Set<CorpMaterialName>()
  for (const name of asCorpMaterialList(industry.producedMaterials)) {
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

function populateSimulationTab(
  ns: NS,
  tabbedLog: TabbedScriptLogBuilder,
  simRun: ValidationRun | null,
  simHistory: ValidationRun[]
): void {
  const builder = tabbedLog.tab("sim")

  if (!simRun) {
    builder.text("Waiting for first corp cycle validation…")
    return
  }

  const div = simRun.before.divisions.find((d) => d.name === FARMLAND_DIVISION)
  const ctx = buildSimContext(ns, div?.advertisingFactor ?? 0.04)
  const info = ns.corporation.getCorporation()

  builder.text(
    [
      `Simulation (${simRun.result.allOk ? "PASS" : "FAIL"}): stage ${simRun.stage}`,
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
    rows: [[`${simRun.result.city}`, simRun.result.allOk ? "PASS" : "FAIL", simRun.result.notes.join(" · ") || "—"]],
  })

  if (simRun.result.comparisons.length > 0) {
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
      rows: simRun.result.comparisons.map((c: FieldComparison) => [
        c.path,
        Number.isFinite(c.predicted) ? c.predicted.toFixed(3) : "—",
        Number.isFinite(c.actual) ? c.actual.toFixed(3) : "—",
        Number.isFinite(c.delta) ? c.delta.toFixed(3) : "—",
        formatSimPct(c.relError),
        c.ok ? "Y" : "N",
      ]),
    })
  }

  if (simHistory.length > 1) {
    builder.table({
      title: "Sim: recent stages",
      columns: [
        { header: "Stage", align: "left", minWidth: 10 },
        { header: "OK", align: "center", minWidth: 4 },
        { header: "Fails", align: "right", minWidth: 6 },
        { header: "Notes", align: "left", minWidth: 36 },
      ],
      rows: simHistory.map((h) => [
        h.stage,
        h.result.allOk ? "Y" : "N",
        String(h.result.comparisons.filter((c) => !c.ok).length),
        h.result.notes.join("; ") || "—",
      ]),
    })
  }
}

function populateStaffTab(ns: NS, tabbedLog: TabbedScriptLogBuilder, tables: HeadcountPlanTable[]): void {
  const builder = tabbedLog.tab("staff")

  const officeRows = collectOfficeSnapshotRows(ns)
  if (officeRows.length > 0) {
    builder.table({
      title: "Offices (all divisions)",
      columns: [
        { header: "Division", align: "left", minWidth: 10 },
        { header: "City", align: "left", minWidth: 12 },
        { header: "Staff", align: "right", minWidth: 8 },
        { header: "Morale", align: "right", minWidth: 7 },
        { header: "Energy", align: "right", minWidth: 7 },
        { header: "Jobs", align: "left", minWidth: 22 },
        { header: "XP", align: "right", minWidth: 8 },
      ],
      rows: officeRows,
    })
  }

  if (tables.length === 0) {
    builder.text("No headcount plan tables yet (need warehouse + office per city).")
    return
  }

  for (const plan of tables) {
    const gameProfitK = (plan.gameProfitPerSec / 1e3).toFixed(1)
    builder.table({
      title:
        `Staff plan ${plan.divisionName}/${plan.city} (${plan.currentEmployees}/${plan.officeSize}, ` +
        `optimal ${plan.optimalEmployees}) — $/s · cycle ${plan.secondsPerMarketCycle}s · ` +
        `game $${gameProfitK}k/s · Est PnL = (rev-inputs)-payroll · * best · < current`,
      columns: [
        { header: "N", align: "right", minWidth: 3 },
        { header: "Ops", align: "right", minWidth: 3 },
        { header: "Eng", align: "right", minWidth: 3 },
        { header: "Bus", align: "right", minWidth: 3 },
        { header: "Mgmt", align: "right", minWidth: 4 },
        { header: "R&D", align: "right", minWidth: 3 },
        { header: "Int", align: "right", minWidth: 3 },
        { header: "Gross/s", align: "right", minWidth: 8 },
        { header: "Pay/s", align: "right", minWidth: 8 },
        { header: "Est/s", align: "right", minWidth: 8 },
        { header: "", align: "center", minWidth: 3 },
      ],
      rows: plan.rows,
    })
  }
}

function populateLogTab(tabbedLog: TabbedScriptLogBuilder, statusLines: string[]): void {
  const builder = tabbedLog.tab("log")
  if (statusLines.length > 0) {
    builder.text(statusLines.join("\n"))
  } else {
    builder.text("(no log lines this cycle)")
  }
}

export async function renderCorporationDashboard(
  ns: NS,
  tabbedLog: TabbedScriptLogBuilder,
  statusLines: string[],
  managedSupplies: ManagedSupply[] = [],
  simRun: ValidationRun | null = null,
  simHistory: ValidationRun[] = [],
  headcountPlans: HeadcountPlanTable[] = []
): Promise<void> {
  tabbedLog.clearPanels()
  populateOverviewTab(ns, tabbedLog, managedSupplies)
  populateWarehouseTab(ns, tabbedLog, managedSupplies)
  populateStaffTab(ns, tabbedLog, headcountPlans)
  populateSimulationTab(ns, tabbedLog, simRun, simHistory)
  populateLogTab(tabbedLog, statusLines)
  await tabbedLog.render(ns)
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

function buildOfficeTable(title: string, rows: string[][]): ReactTableConfig {
  return {
    title,
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
