import type { CityName, CorpMaterialName } from "@ns"
import { cloneSnapshot } from "@/libraries/corporation/simulation/math.js"
import { getDivisionWarehouse } from "@/libraries/corporation/simulation/snapshot.js"
import { simulateStage } from "@/libraries/corporation/simulation/simulate.js"
import type { CorporationSnapshot, CorpStage, SimContext, WarehouseSnapshot } from "@/libraries/corporation/simulation/types.js"

/** Mirrors officeJobs.OfficeJobCounts — kept here to avoid importing officeJobs (circular deps). */
export interface JobCountSplit {
  Operations: number
  Engineer: number
  Management: number
  Business: number
  "Research & Development": number
  Intern: number
}

export interface PerEmployeeRateSplit {
  Operations: number
  Engineer: number
  Management: number
  Business: number
  "Research & Development": number
}

const MARKET_CYCLE_STAGES: CorpStage[] = ["START", "PURCHASE", "PRODUCTION", "EXPORT", "SALE"]

function buildEmployeeProductionByJob(
  counts: JobCountSplit,
  rates: PerEmployeeRateSplit
): Record<string, number> {
  return {
    Operations: counts.Operations * rates.Operations,
    Engineer: counts.Engineer * rates.Engineer,
    Management: counts.Management * rates.Management,
    Business: counts.Business * rates.Business,
    "Research & Development": counts["Research & Development"] * rates["Research & Development"],
    Intern: 0,
    Unassigned: 0,
    total: 0,
  }
}

function listAllJobCounts(numEmployees: number): JobCountSplit[] {
  const out: JobCountSplit[] = []
  const n = numEmployees
  for (let ops = 0; ops <= n; ops++) {
    for (let engr = 0; engr <= n - ops; engr++) {
      for (let mgmt = 0; mgmt <= n - ops - engr; mgmt++) {
        for (let bus = 0; bus <= n - ops - engr - mgmt; bus++) {
          for (let rnd = 0; rnd <= n - ops - engr - mgmt - bus; rnd++) {
            const intern = n - ops - engr - mgmt - bus - rnd
            out.push({
              Operations: ops,
              Engineer: engr,
              Management: mgmt,
              Business: bus,
              "Research & Development": rnd,
              Intern: intern,
            })
          }
        }
      }
    }
  }
  return out
}

function scoreJobCountsOverSimCycles(
  baseSnapshot: CorporationSnapshot,
  ctx: SimContext,
  divisionName: string,
  city: CityName,
  counts: JobCountSplit,
  rates: PerEmployeeRateSplit,
  cycles: number
): number {
  let snap = cloneSnapshot(baseSnapshot)
  const division = snap.divisions.find((d) => d.name === divisionName)
  const office = division?.offices.find((o) => o.city === city)
  if (!division || !office) return -Infinity

  office.employeeProductionByJob = buildEmployeeProductionByJob(counts, rates)

  const spc = ctx.secondsPerMarketCycle * ctx.marketCycles
  let totalScore = 0

  for (let c = 0; c < cycles; c++) {
    let whAtCycleStart: WarehouseSnapshot | undefined
    let whAfterPurchase: WarehouseSnapshot | undefined

    for (const stage of MARKET_CYCLE_STAGES) {
      if (stage === "START") {
        const wh = getDivisionWarehouse(snap, divisionName, city)
        if (wh) whAtCycleStart = cloneSnapshot(wh)
      }

      snap = simulateStage(snap, stage, ctx)

      if (stage === "PURCHASE") {
        const wh = getDivisionWarehouse(snap, divisionName, city)
        if (wh) whAfterPurchase = cloneSnapshot(wh)
      }

      if (stage === "SALE") {
        const wh = getDivisionWarehouse(snap, divisionName, city)
        if (!wh) continue

        for (const name of division.producedMaterials) {
          const mat = wh.materials[name]
          if (mat) totalScore += (mat.actualSellAmount ?? 0) * spc * mat.marketPrice
        }

        if (whAtCycleStart && whAfterPurchase) {
          for (const name of Object.keys(division.requiredMaterials) as CorpMaterialName[]) {
            if (!division.requiredMaterials[name]) continue
            const before = whAtCycleStart.materials[name]
            const after = whAfterPurchase.materials[name]
            if (!before || !after) continue
            const bought = after.stored - before.stored
            if (bought > 0) totalScore -= bought * after.marketPrice
          }
        }
      }
    }
  }

  return totalScore
}

/** Try every job split; return the best by multi-cycle warehouse sim score. */
export function findBestJobCountsBySimCycles(
  baseSnapshot: CorporationSnapshot,
  ctx: SimContext,
  divisionName: string,
  city: CityName,
  numEmployees: number,
  rates: PerEmployeeRateSplit,
  cycles: number
): { counts: JobCountSplit; score: number } | null {
  if (numEmployees <= 0) return null

  let best: { counts: JobCountSplit; score: number } | null = null

  const allCounts = listAllJobCounts(numEmployees)
  for (let i = 0; i < allCounts.length; i++) {
    const counts = allCounts[i]
    const score = scoreJobCountsOverSimCycles(baseSnapshot, ctx, divisionName, city, counts, rates, cycles)
    if (!best || score > best.score) {
      best = { counts, score }
    }
  }

  return best
}
