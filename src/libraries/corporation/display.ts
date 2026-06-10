import { CorpMaterialName, NS } from "@ns"
import {
  col,
  ScriptLogBuilder,
  TabbedScriptLogBuilder,
  W,
  type ReactTableConfig,
  type TabDefinition,
} from "@/libraries/scriptLogUiLayout.js"
import { FARMLAND_DIVISION } from "@/libraries/corporation/farmland.js"
import {
  estimateDevelopmentEtaSeconds,
  estimateDevelopmentProgressPerCycle,
  formatDevelopmentDoneAt,
  formatDevelopmentEta,
  getProductDevelopmentStatuses,
} from "@/libraries/corporation/productDevelopment.js"
import { TOBACCO_DIVISION } from "@/libraries/corporation/tobacco.js"
import { buildSimContext } from "@/libraries/corporation/simulation/context.js"
import type { FieldComparison } from "@/libraries/corporation/simulation/types.js"
import type { ValidationRun } from "@/libraries/corporation/simulation/validate.js"
import {
  buildPerfHistoryRows,
  CorpPerfCollector,
  formatPerfMs,
  type CorpPerfReport,
  type CorpPerfSample,
} from "@/libraries/corporation/perf.js"
import { type HeadcountPlanTable } from "@/libraries/corporation/office.js"
import { asCorpMaterialList } from "@/libraries/corporation/simulation/officeJobs.js"
import { type ManagedSupply } from "@/libraries/corporation/supplies.js"

export const CORP_TABS: TabDefinition[] = [
  { id: "overview", label: "Overview" },
  { id: "warehouse", label: "Warehouse" },
  { id: "staff", label: "Staff" },
  { id: "sim", label: "Sim" },
  { id: "perf", label: "Perf" },
  { id: "log", label: "Log" },
]

function formatMoney(ns: NS, value: number): string {
  return `$${ns.format.number(value)}`
}

function formatDivisionProducts(ns: NS, divisionName: string, productNames: string[]): string {
  if (productNames.length === 0) return "—"

  const developing = getProductDevelopmentStatuses(ns, divisionName)
  if (developing.length === 0) return productNames.join(", ")

  const parts = developing.map((d) => `${d.name} @ ${d.city} ${d.progress.toFixed(1)}%`)
  const finished = productNames.filter((name) => !developing.some((d) => d.name === name))
  if (finished.length > 0) parts.push(`ready: ${finished.join(", ")}`)
  return parts.join(" | ")
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
      {
        label: "Products",
        value: formatDivisionProducts(ns, divisionName, division.products),
      },
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

  const { developing, ready } = collectDivisionProductRows(ns, divisionName)
  if (developing.length > 0) {
    builder.table(buildProductDevelopingTable(`${divisionName} products`, developing))
  }
  if (ready.length > 0) {
    builder.table(buildProductReadyTable(`${divisionName} products`, ready))
  }
}

function collectDivisionProductRows(
  ns: NS,
  divisionName: string
): { developing: string[][]; ready: string[][] } {
  const corp = ns.corporation
  const division = corp.getDivision(divisionName)
  const spc = corp.getConstants().secondsPerMarketCycle
  const developing: string[][] = []
  const ready: string[][] = []

  for (const city of division.cities) {
    if (!corp.hasWarehouse(divisionName, city)) continue

    for (const productName of division.products) {
      try {
        const product = corp.getProduct(divisionName, city, productName)
        const progress = product.developmentProgress

        if (progress < 100) {
          let devPerCycle = "—"
          let eta = "—"
          let doneAt = "—"
          try {
            const office = corp.getOffice(divisionName, city)
            const progPerCycle = estimateDevelopmentProgressPerCycle(office.employeeProductionByJob, 1)
            const etaSec = estimateDevelopmentEtaSeconds(progress, progPerCycle, spc)
            devPerCycle = `~${progPerCycle.toFixed(2)}%/c`
            eta = formatDevelopmentEta(etaSec)
            doneAt = formatDevelopmentDoneAt(etaSec)
          } catch {
            // office missing in this city
          }
          developing.push([city, productName, `${progress.toFixed(2)}%`, devPerCycle, eta, doneAt])
        } else {
          const sell =
            typeof product.desiredSellPrice === "string"
              ? product.desiredSellPrice
              : formatMoney(ns, product.desiredSellPrice)
          const sellAmt =
            typeof product.desiredSellAmount === "string"
              ? product.desiredSellAmount
              : ns.format.number(product.desiredSellAmount)
          ready.push([
            city,
            productName,
            String(product.rating.toFixed(2)),
            `${sellAmt} @ ${sell}`,
            ns.format.number(product.stored, 1),
          ])
        }
      } catch {
        // product not tracked in this city yet
      }
    }
  }

  return { developing, ready }
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
    columns: [col("City", "left"), col("Match", "center"), col("Notes", "left", W.notesWide)],
    rows: [[`${simRun.result.city}`, simRun.result.allOk ? "PASS" : "FAIL", simRun.result.notes.join(" · ") || "—"]],
  })

  if (simRun.result.comparisons.length > 0) {
    builder.table({
      title: "Sim: predicted vs actual",
      columns: [
        col("Field", "left", W.jobs),
        col("Predicted", "right", W.predicted),
        col("Actual", "right", W.actual),
        col("Δ", "right", W.delta),
        col("Err%", "right", W.errPct),
        col("OK", "center", W.ok),
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
        col("Stage", "left", W.division),
        col("OK", "center", W.ok),
        col("Fails", "right", W.rep),
        col("Notes", "left", W.notes),
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
        col("Division", "left", W.division),
        col("City", "left", W.city),
        col("Staff", "right", W.staff),
        col("Morale", "right", W.morale),
        col("Energy", "right", W.energy),
        col("Jobs", "left", W.jobs),
        col("XP", "right", W.xp),
      ],
      rows: officeRows,
    })
  }

  if (tables.length === 0) {
    builder.text("No headcount plan tables yet (need warehouse + office per city).")
    return
  }

  for (const plan of tables) {
    const isDev = plan.mode === "development"
    const gameProfitK = (plan.gameProfitPerSec / 1e3).toFixed(1)
    const staffLabel = `${plan.currentEmployees}/${plan.officeSize}`
    const devProgress =
      plan.devProgressLabel != null && plan.devProgressLabel.length > 0 ? ` · ${plan.devProgressLabel}` : ""
    const title = isDev
      ? `Product dev ${plan.divisionName}/${plan.city} (${staffLabel} staff, office -> ${plan.optimalEmployees})${devProgress} — ` +
        `cycle ${plan.secondsPerMarketCycle}s · ETA from sim Dev/c`
      : `Staff plan ${plan.divisionName}/${plan.city} (${staffLabel}, optimal ${plan.optimalEmployees}) — ` +
        `$ /s · cycle ${plan.secondsPerMarketCycle}s · game $${gameProfitK}k/s · ` +
        `Est PnL = (rev-inputs)-payroll · * best · < current`
    const columns: ReactTableConfig["columns"] = [
      col("N", "right", W.role),
      col("Ops", "right", W.role),
      col("Eng", "right", W.role),
      col("Bus", "right", W.role),
      col("Mgmt", "right", W.mgmt),
      col("R&D", "right", W.role),
      col("Int", "right", W.role),
      col(isDev ? "—" : "Gross/s", "right", W.gross),
      col(isDev ? "—" : "Pay/s", "right", W.pay),
      col(isDev ? "Dev/c" : "Est/s", "right", W.est),
    ]
    if (isDev) {
      columns.push(col("ETA", "right", W.num))
    }
    columns.push(col("", "center", W.stat))
    builder.table({ title, columns, rows: plan.rows })
  }
}

function formatSimMismatchWarning(simRun: ValidationRun): string {
  const failed = simRun.result.comparisons.filter((c) => !c.ok)
  const lines = [
    `SIM MISMATCH (automation continues): stage ${simRun.stage}, ${failed.length} field(s) off`,
    `Division ${simRun.result.division} / ${simRun.result.city}`,
  ]
  for (const c of failed) {
    lines.push(
      `  ${c.path}: predicted ${Number.isFinite(c.predicted) ? c.predicted.toFixed(3) : "—"}, ` +
        `actual ${Number.isFinite(c.actual) ? c.actual.toFixed(3) : "—"}`
    )
  }
  for (const note of simRun.result.notes) {
    lines.push(`  note: ${note}`)
  }
  lines.push("See Sim tab for details. Warning clears when validation passes.")
  return lines.join("\n")
}

function populatePerformanceTab(
  tabbedLog: TabbedScriptLogBuilder,
  report: CorpPerfReport,
  history: CorpPerfReport[],
  phase: "pre-render" | "final" = "final"
): void {
  const builder = tabbedLog.tab("perf")

  const sorted = [...report.samples].sort((a, b) => b.ms - a.ms)
  const historyRows = buildPerfHistoryRows(history)
  const phaseNote = phase === "pre-render" ? " (excludes ui render)" : ""

  builder.keyValueTable({
    title: `Cycle ${report.cycle} timing${phaseNote}`,
    rows: [
      { label: "Loop total", value: `${formatPerfMs(report.loopTotalMs)} ms` },
      { label: "Measured sum", value: `${formatPerfMs(report.measuredSumMs)} ms` },
      { label: "Unmeasured", value: `${formatPerfMs(report.unmeasuredMs)} ms` },
      {
        label: "History",
        value: history.length > 0 ? `${history.length} cycles (avg/max below)` : "building…",
      },
    ],
  })

  builder.table({
    title: "Last cycle (sorted by ms)",
    columns: [
      col("Step", "left", W.step),
      col("ms", "right", W.timing),
      col("% loop", "right", W.pctLoop),
      col("Note", "left", W.city),
    ],
    rows: sorted.map((s: CorpPerfSample) => [
      s.label,
      formatPerfMs(s.ms),
      report.loopTotalMs > 0 ? `${((s.ms / report.loopTotalMs) * 100).toFixed(1)}%` : "—",
      s.note ?? "",
    ]),
  })

  if (historyRows.length > 0) {
    builder.table({
      title: `Rolling stats (${history.length} cycles)`,
      columns: [
        col("Step", "left", W.step),
        col("Last", "right", W.timing),
        col("Avg", "right", W.timing),
        col("Max", "right", W.timing),
      ],
      rows: historyRows.map((r) => [
        r.label,
        formatPerfMs(r.lastMs),
        formatPerfMs(r.avgMs),
        formatPerfMs(r.maxMs),
      ]),
    })
  }

  builder.text(
    [
      "Wall-clock ms via performance.now (or Date.now).",
      "sim nextUpdate is mostly waiting for the corp market tick, not CPU.",
      "headcount * is enumerateHeadcountEconomics for profit offices; dev cities are cheap.",
      phase === "pre-render"
        ? "ui render React is recorded in history after this panel is built."
        : "",
    ]
      .filter((line) => line.length > 0)
      .join("\n")
  )
}

function populateLogTab(
  tabbedLog: TabbedScriptLogBuilder,
  statusLines: string[],
  simMismatchWarning: ValidationRun | null = null
): void {
  const builder = tabbedLog.tab("log")
  const parts: string[] = []
  if (simMismatchWarning) {
    parts.push(formatSimMismatchWarning(simMismatchWarning))
    parts.push("")
    parts.push("--- cycle log ---")
    parts.push("")
  }
  if (statusLines.length > 0) {
    parts.push(statusLines.join("\n"))
  } else if (!simMismatchWarning) {
    parts.push("(no log lines this cycle)")
  }
  builder.text(parts.join("\n"))
}

export async function renderCorporationDashboard(
  ns: NS,
  tabbedLog: TabbedScriptLogBuilder,
  statusLines: string[],
  managedSupplies: ManagedSupply[] = [],
  simRun: ValidationRun | null = null,
  simHistory: ValidationRun[] = [],
  headcountPlans: HeadcountPlanTable[] = [],
  simMismatchWarning: ValidationRun | null = null,
  perf: CorpPerfCollector,
  perfCycle: number,
  perfHistory: CorpPerfReport[] = []
): Promise<CorpPerfReport> {
  tabbedLog.clearPanels()
  perf.measure("ui tab Overview", () => populateOverviewTab(ns, tabbedLog, managedSupplies))
  perf.measure("ui tab Warehouse", () => populateWarehouseTab(ns, tabbedLog, managedSupplies))
  perf.measure("ui tab Staff", () => populateStaffTab(ns, tabbedLog, headcountPlans))
  perf.measure("ui tab Sim", () => populateSimulationTab(ns, tabbedLog, simRun, simHistory))
  perf.measure("ui tab Log", () => populateLogTab(tabbedLog, statusLines, simMismatchWarning))

  populatePerformanceTab(tabbedLog, perf.peekReport(perfCycle), perfHistory, "pre-render")
  await perf.measureAsync("ui render React", () => tabbedLog.render(ns))
  return perf.finishLoop(perfCycle)
}

function buildSupplyTable(rows: string[][]): ReactTableConfig {
  return {
    title: "Input supplies (Water, Chemicals)",
    columns: [
      col("City", "left", W.city),
      col("Material", "left", W.material),
      col("Stored", "right", W.stored),
      col("Use/s", "right", W.useRate),
      col("Buy/s", "right", W.useRate),
      col("Tier", "left", W.tier),
    ],
    rows,
  }
}

function buildOfficeTable(title: string, rows: string[][]): ReactTableConfig {
  return {
    title,
    columns: [
      col("City", "left", W.city),
      col("Staff", "right", W.staff),
      col("Morale", "right", W.morale),
      col("Energy", "right", W.energy),
      col("Jobs", "left", W.jobs),
      col("XP", "right", W.xp),
    ],
    rows,
  }
}

function buildProductDevelopingTable(title: string, rows: string[][]): ReactTableConfig {
  return {
    title: `${title} (designing; wall-clock ETA, ${rows.length} active)`,
    columns: [
      col("City", "left", W.city),
      col("Product", "left", W.product),
      col("Progress", "right", W.progress),
      col("Dev/c", "right", W.est),
      col("ETA", "right", W.eta),
      col("Done at", "right", W.eta),
    ],
    rows,
  }
}

function buildProductReadyTable(title: string, rows: string[][]): ReactTableConfig {
  return {
    title: `${title} (ready)`,
    columns: [
      col("City", "left", W.city),
      col("Product", "left", W.product),
      col("Rating", "right", W.rating),
      col("Sell", "left", W.sell),
      col("Stored", "right", W.stored),
    ],
    rows,
  }
}

function buildMaterialTable(rows: string[][]): ReactTableConfig {
  return {
    title: "Produce (sell MAX @ MP)",
    columns: [
      col("City", "left", W.city),
      col("Material", "left", W.material),
      col("Stored", "right", W.stored),
      col("Rate/s", "right", W.useRate),
      col("Qual", "right", W.qual),
      col("Mkt $", "right", W.est),
      col("Sell", "left", W.sell),
      col("Demand", "right", W.rating),
      col("WH used", "right", W.whUsed),
    ],
    rows,
  }
}
