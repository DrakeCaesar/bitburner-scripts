import type { FactionName, NS } from "@ns"
import {
  findAugmentTargets,
  filterWorkableFactions,
  getTargetFavor,
  parseFactionWorkPriority,
  repNeededForTargetFavor,
  type FactionWorkPriority,
} from "../factionWork.js"
import type { InfiltrationRewardGoal, InfiltrationTarget } from "./infiltrationTargets.js"

const MAX_CYCLE_SAMPLES = 5

interface CycleSample {
  durationMs: number
  predictedReward: number
}

export interface InfiltrationRepGoal {
  label: string
  repNeeded: number
}

export interface InfiltrationRunView {
  city: string
  location: string
  rewardGoal: InfiltrationRewardGoal
  faction: FactionName | null
  predictedReward: number
  repGoal: InfiltrationRepGoal | null
  roundCount: number
  lastCycleMs: number | null
  avgCycleMs: number | null
  avgRewardPerCycle: number | null
  rewardPerHour: number | null
  etaMs: number | null
  etaRuns: number | null
  cycleInProgress: boolean
}

function locationKey(target: InfiltrationTarget): string {
  return `${target.city}|${target.name}`
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function getInfiltrationRepGoal(
  ns: NS,
  faction: FactionName,
  priority: FactionWorkPriority
): InfiltrationRepGoal | null {
  const targetFavor = getTargetFavor(ns)
  const favor = ns.singularity.getFactionFavor(faction)
  const favorGain = ns.singularity.getFactionFavorGain(faction)
  const currentRep = ns.singularity.getFactionRep(faction)

  if (priority === "favor" && favor + favorGain < targetFavor) {
    const repNeeded = repNeededForTargetFavor(ns, faction, favor, currentRep, targetFavor)
    if (repNeeded == null) return null
    return { label: `donation favor ${targetFavor}`, repNeeded }
  }

  const workableFactions = filterWorkableFactions(ns, ns.getPlayer().factions)
  const augmentTarget = findAugmentTargets(ns, workableFactions, priority).find((row) => row.faction === faction)
  if (!augmentTarget || augmentTarget.repGap <= 0) return null

  return { label: augmentTarget.augmentName, repNeeded: augmentTarget.repGap }
}

export class InfiltrationRunStatsTracker {
  private samples: CycleSample[] = []
  private activeLocationKey = ""
  private cycleStartMs: number | null = null
  private city = ""
  private location = ""
  private rewardGoal: InfiltrationRewardGoal = "money"
  private faction: FactionName | null = null
  private predictedReward = 0

  beginCycle(target: InfiltrationTarget, goal: InfiltrationRewardGoal, faction: FactionName | null): void {
    const key = locationKey(target)
    if (key !== this.activeLocationKey) {
      this.samples = []
      this.activeLocationKey = key
    }

    this.city = target.city
    this.location = target.name
    this.rewardGoal = goal
    this.faction = faction
    this.predictedReward =
      goal === "money" ? target.data.reward.sellCash : target.data.reward.tradeRep
    this.cycleStartMs = Date.now()
  }

  /** Record a finished victory cycle. No-op if beginCycle was not called. */
  completeCycle(): void {
    if (this.cycleStartMs == null) return

    const durationMs = Date.now() - this.cycleStartMs
    this.cycleStartMs = null

    this.samples.push({ durationMs, predictedReward: this.predictedReward })
    if (this.samples.length > MAX_CYCLE_SAMPLES) {
      this.samples.shift()
    }
  }

  abandonCycle(): void {
    this.cycleStartMs = null
  }

  getView(ns: NS): InfiltrationRunView {
    const priority = parseFactionWorkPriority(ns)
    const repGoal =
      this.rewardGoal === "reputation" && this.faction != null
        ? getInfiltrationRepGoal(ns, this.faction, priority)
        : null

    const roundCount = this.samples.length
    const lastCycleMs = roundCount > 0 ? this.samples[roundCount - 1].durationMs : null
    const avgCycleMs = roundCount > 1 ? average(this.samples.map((sample) => sample.durationMs)) : lastCycleMs

    const avgRewardPerCycle =
      roundCount > 1
        ? average(this.samples.map((sample) => sample.predictedReward))
        : roundCount === 1
          ? this.samples[0].predictedReward
          : null

    let rewardPerHour: number | null = null
    if (avgRewardPerCycle != null && avgCycleMs != null && avgCycleMs > 0) {
      rewardPerHour = (avgRewardPerCycle / avgCycleMs) * 3_600_000
    }

    let etaMs: number | null = null
    let etaRuns: number | null = null
    if (
      this.rewardGoal === "reputation" &&
      repGoal != null &&
      repGoal.repNeeded > 0 &&
      avgCycleMs != null &&
      avgCycleMs > 0 &&
      this.predictedReward > 0
    ) {
      etaRuns = Math.ceil(repGoal.repNeeded / this.predictedReward)
      etaMs = etaRuns * avgCycleMs
    }

    return {
      city: this.city,
      location: this.location,
      rewardGoal: this.rewardGoal,
      faction: this.faction,
      predictedReward: this.predictedReward,
      repGoal,
      roundCount,
      lastCycleMs,
      avgCycleMs,
      avgRewardPerCycle,
      rewardPerHour,
      etaMs,
      etaRuns,
      cycleInProgress: this.cycleStartMs != null,
    }
  }
}

export function formatInfiltrationRunViewLines(ns: NS, view: InfiltrationRunView | null): string[] {
  if (!view || !view.location) {
    return ["Run: waiting for target..."]
  }

  const lines: string[] = ["--- Run ---"]

  lines.push(`City: ${view.city}`)
  lines.push(`Location: ${view.location}`)

  if (view.rewardGoal === "money") {
    lines.push("Grinding: money")
    lines.push(`Predicted: ${ns.format.number(view.predictedReward)}`)
  } else if (view.faction) {
    lines.push(`Grinding: ${view.faction} reputation`)
    lines.push(`Predicted: ${ns.format.number(view.predictedReward)} rep`)
  } else {
    lines.push("Grinding: money (no faction target)")
    lines.push(`Predicted: ${ns.format.number(view.predictedReward)}`)
  }

  if (view.cycleInProgress) {
    lines.push("Status: cycle in progress")
  }

  lines.push("")
  lines.push("--- Cycle stats ---")

  if (view.roundCount === 0) {
    lines.push("No completed rounds at this location yet")
  } else if (view.roundCount === 1 && view.lastCycleMs != null) {
    lines.push(`Last round: ${ns.format.time(view.lastCycleMs)}`)
    if (view.avgRewardPerCycle != null) {
      const unit = view.rewardGoal === "money" ? "" : " rep"
      lines.push(`Last gain: ${ns.format.number(view.avgRewardPerCycle)}${unit}`)
    }
  } else {
    const sampleNote =
      view.roundCount > 1 ? ` (avg of ${Math.min(view.roundCount, MAX_CYCLE_SAMPLES)})` : ""
    if (view.avgCycleMs != null) {
      lines.push(`Avg round time${sampleNote}: ${ns.format.time(view.avgCycleMs)}`)
    }
    if (view.avgRewardPerCycle != null) {
      const unit = view.rewardGoal === "money" ? "" : " rep"
      lines.push(`Avg gain${sampleNote}: ${ns.format.number(view.avgRewardPerCycle)}${unit}/round`)
    }
    if (view.rewardPerHour != null) {
      const unit = view.rewardGoal === "money" ? "/hr" : " rep/hr"
      lines.push(`Rate: ${ns.format.number(view.rewardPerHour)}${unit}`)
    }
  }

  if (view.rewardGoal === "reputation" && view.repGoal && view.repGoal.repNeeded > 0) {
    lines.push("")
    lines.push("--- ETA ---")
    lines.push(`Goal: ${view.repGoal.label}`)
    lines.push(`Need: ${ns.format.number(view.repGoal.repNeeded)} rep`)
    if (view.etaMs != null && view.etaRuns != null) {
      lines.push(`Est: ${ns.format.time(view.etaMs)} (${view.etaRuns} runs)`)
    } else {
      lines.push("Est: need 2+ rounds at this location")
    }
  }

  return lines
}
