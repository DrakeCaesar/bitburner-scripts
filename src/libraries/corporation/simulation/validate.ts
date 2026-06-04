import { CityName, NS } from "@ns"
import { type CorpPerfCollector, perfNow } from "@/libraries/corporation/perf.js"
import { buildSimContext } from "@/libraries/corporation/simulation/context.js"
import { compareStageSnapshots } from "@/libraries/corporation/simulation/compare.js"
import { simulateStage } from "@/libraries/corporation/simulation/simulate.js"
import { captureCorporationSnapshot } from "@/libraries/corporation/simulation/snapshot.js"
import type { CorporationSnapshot, StageValidationResult } from "@/libraries/corporation/simulation/types.js"

/** Primary city for stage sim — inlined so sim modules do not import farmland.ts (RAM calc). */
const FARMLAND_DIVISION = "Farmland"
const FARMLAND_SIM_CITY = "Sector-12" as CityName

export interface ValidationRun {
  stage: string
  before: CorporationSnapshot
  after: CorporationSnapshot
  predicted: CorporationSnapshot
  result: StageValidationResult
}

/** Wait for the next corp tick, then compare simulated vs actual for `before.nextState`. */
export async function validateCorpStage(
  ns: NS,
  before: CorporationSnapshot,
  perf?: CorpPerfCollector
): Promise<ValidationRun | null> {
  const corp = ns.corporation
  const stage = before.nextState

  const waitStart = perfNow()
  await corp.nextUpdate()
  perf?.add("sim nextUpdate (wait)", perfNow() - waitStart)

  const captureStart = perfNow()
  const after = captureCorporationSnapshot(ns, FARMLAND_DIVISION)
  perf?.add("sim capture after", perfNow() - captureStart)
  if (!after) return null

  const div = before.divisions.find((d) => d.name === FARMLAND_DIVISION)
  const ctxStart = perfNow()
  const ctx = buildSimContext(ns, div?.advertisingFactor ?? 0.04)
  perf?.add("sim build context", perfNow() - ctxStart)

  const simStart = perfNow()
  const predicted = simulateStage(before, stage, ctx)
  perf?.add("sim simulate stage", perfNow() - simStart)

  const compareStart = perfNow()
  const result = compareStageSnapshots(
    stage,
    FARMLAND_DIVISION,
    FARMLAND_SIM_CITY,
    before,
    predicted,
    after
  )
  perf?.add("sim compare snapshots", perfNow() - compareStart)

  return { stage, before, after, predicted, result }
}
