import { NS } from "@ns"
import { FARMLAND_DIVISION, FARMLAND_START_CITY } from "../constants.js"
import { buildSimContext } from "./context.js"
import { compareStageSnapshots } from "./compare.js"
import { simulateStage } from "./simulate.js"
import { captureCorporationSnapshot } from "./snapshot.js"
import type { CorporationSnapshot, StageValidationResult } from "./types.js"

export interface ValidationRun {
  stage: string
  before: CorporationSnapshot
  after: CorporationSnapshot
  predicted: CorporationSnapshot
  result: StageValidationResult
}

/** Wait for the next corp tick, then compare simulated vs actual for `before.nextState`. */
export async function validateCorpStage(ns: NS, before: CorporationSnapshot): Promise<ValidationRun | null> {
  const corp = ns.corporation
  const stage = before.nextState

  await corp.nextUpdate()

  const after = captureCorporationSnapshot(ns, FARMLAND_DIVISION)
  if (!after) return null

  const ctx = buildSimContext(ns)
  const predicted = simulateStage(before, stage, ctx)

  const result = compareStageSnapshots(
    stage,
    FARMLAND_DIVISION,
    FARMLAND_START_CITY,
    before,
    predicted,
    after
  )

  return { stage, before, after, predicted, result }
}
