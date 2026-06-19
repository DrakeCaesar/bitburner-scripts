import type { CompanyName, FactionName, NS } from "@ns"
import {
  getInfiltrationGrindTarget,
  getInfiltrationMoneyGoal,
  type InfiltrationMoneyGoal,
  type InfiltrationRepTier,
} from "../factionWork.js"
import {
  GYM_NAME,
  combatGymExpPerSecond,
  getLowestCombatGymSkill,
  type CombatGymSkill,
} from "../gymWorkout.js"
import {
  CHARISMA_GRIND_THRESHOLD,
  getActiveMegacorp,
  getRequiredRep,
  isStudyingLeadershipAtVolhaven,
  isWorkingAtCompany,
  pickBestCompanyField,
  VOLHAVEN_CITY,
} from "../megacorpWork.js"
import { areAllInfiltrationsDoable, getEffectiveInfiltrationRepReward } from "./infiltrationTargets.js"
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
  moneyGoal: InfiltrationMoneyGoal | null
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

export function getInfiltrationRepGoal(ns: NS, faction: FactionName): InfiltrationRepGoal | null {
  const grind = getInfiltrationGrindTarget(ns)
  if (!grind || grind.faction !== faction || grind.repGap <= 0) return null

  return { label: grind.augmentName, repNeeded: grind.repGap }
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

  beginCycle(
    ns: NS,
    target: InfiltrationTarget,
    goal: InfiltrationRewardGoal,
    faction: FactionName | null
  ): void {
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
      goal === "money"
        ? target.data.reward.sellCash
        : faction != null
          ? getEffectiveInfiltrationRepReward(ns, target, faction)
          : target.data.reward.tradeRep
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
    const repGoal =
      this.rewardGoal === "reputation" && this.faction != null
        ? getInfiltrationRepGoal(ns, this.faction)
        : null
    const moneyGoal = this.rewardGoal === "money" ? getInfiltrationMoneyGoal(ns) : null

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
      this.predictedReward > 0
    ) {
      etaRuns = Math.ceil(repGoal.repNeeded / this.predictedReward)
      if (avgCycleMs != null && avgCycleMs > 0) {
        etaMs = etaRuns * avgCycleMs
      }
    } else if (
      this.rewardGoal === "money" &&
      moneyGoal != null &&
      moneyGoal.moneyNeeded > 0 &&
      this.predictedReward > 0
    ) {
      etaRuns = Math.ceil(moneyGoal.moneyNeeded / this.predictedReward)
      if (avgCycleMs != null && avgCycleMs > 0) {
        etaMs = etaRuns * avgCycleMs
      }
    }

    return {
      city: this.city,
      location: this.location,
      rewardGoal: this.rewardGoal,
      faction: this.faction,
      predictedReward: this.predictedReward,
      repGoal,
      moneyGoal,
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

function formatInfiltrationTierLabel(tier: InfiltrationRepTier): string {
  switch (tier) {
    case "pre-favor-aug":
      return "pre-favor augment"
    case "favor":
      return "donation favor"
    case "post-favor-aug":
      return "post-favor augment"
    case "neuroflux":
      return "NeuroFlux Governor"
  }
}

function formatInfiltrationMoneyTierLabel(tier: InfiltrationMoneyGoal["tier"]): string {
  switch (tier) {
    case "pre-favor-aug":
      return "pre-favor augments"
    case "post-favor-aug":
      return "post-favor augments"
    case "neuroflux":
      return "NeuroFlux Governor"
  }
}

function describeMegacorpJobName(ns: NS, company: CompanyName): string {
  const currentJob = ns.getPlayer().jobs[company]
  if (currentJob) return currentJob

  const positions = ns.singularity.getCompanyPositions(company)
  if (positions.length === 0) return ""

  const player = ns.getPlayer()
  const best = pickBestCompanyField(
    ns,
    company,
    positions,
    player,
    ns.singularity.getCompanyFavor(company),
    ns.singularity.getCompanyRep(company)
  )
  return best?.positionName ?? ""
}

/** Combat training pick for the infiltration DOM overlay. */
export function formatCombatSkillTrainingDomLines(
  ns: NS,
  skill: CombatGymSkill = getLowestCombatGymSkill(ns)
): string[] {
  const lines: string[] = ["--- Training ---"]
  const work = ns.singularity.getCurrentWork()

  if (work?.type === "FACTION") {
    lines.push("Pick: faction work (skipped)")
    return lines
  }

  if (isStudyingLeadershipAtVolhaven(ns)) {
    const company = getActiveMegacorp(ns)
    lines.push("Pick: studying charisma (leadership)")
    if (company) lines.push(`Next: megacorp ${company}`)
    return lines
  }

  const company = getActiveMegacorp(ns)
  const megacorpMode = areAllInfiltrationsDoable(ns) && company != null

  if (megacorpMode && company) {
    if (ns.getPlayer().skills.charisma < CHARISMA_GRIND_THRESHOLD) {
      if (ns.getPlayer().city !== VOLHAVEN_CITY) {
        lines.push(`Pick: travel to ${VOLHAVEN_CITY} for charisma study`)
      } else {
        lines.push("Pick: studying charisma (leadership)")
      }
      lines.push(`Next: megacorp ${company}`)
    } else if (ns.singularity.getCompanyRep(company) >= getRequiredRep(company)) {
      lines.push(`Pick: megacorp ${company} (faction invite)`)
    } else if (isWorkingAtCompany(ns, company)) {
      const job = describeMegacorpJobName(ns, company)
      lines.push(`Pick: megacorp ${company}${job ? ` ${job}` : ""}`)
    } else {
      const job = describeMegacorpJobName(ns, company)
      lines.push(`Pick: megacorp ${company}${job ? ` ${job}` : ""} (rep grind)`)
    }
    lines.push("Mode: all infiltrations doable")
    return lines
  }

  const gymRate = combatGymExpPerSecond(ns, skill, ns.singularity.isFocused()) ?? 0
  lines.push(`Pick: gym ${skill} @ ${GYM_NAME} (${ns.format.number(gymRate)}/s)`)
  lines.push("Mode: combat for infiltrations")
  return lines
}

export function formatInfiltrationRunViewLines(ns: NS, view: InfiltrationRunView | null): string[] {
  if (!view || !view.location) {
    return ["Run: waiting for target..."]
  }

  const lines: string[] = ["--- Run ---"]

  lines.push(`City: ${view.city}`)
  lines.push(`Location: ${view.location}`)

  if (view.rewardGoal === "money") {
    if (view.moneyGoal) {
      lines.push("Grinding: money")
      lines.push(
        `Target: ${view.moneyGoal.label} (infiltration queue slot ${view.moneyGoal.queueSlot}, ${formatInfiltrationMoneyTierLabel(view.moneyGoal.tier)})`
      )
      lines.push(`Price: ${ns.format.number(view.moneyGoal.targetPrice)}`)
      if (view.moneyGoal.moneyNeeded > 0) {
        lines.push(`Need: ${ns.format.number(view.moneyGoal.moneyNeeded)} more`)
      } else {
        lines.push("Need: affordable now")
      }
    } else {
      lines.push("Grinding: money (no augment target)")
    }
    lines.push(`Predicted: ${ns.format.number(view.predictedReward)}`)
  } else if (view.faction) {
    lines.push(`Grinding: ${view.faction} reputation`)
    const grind = getInfiltrationGrindTarget(ns)
    if (grind?.faction === view.faction) {
      lines.push(`Target: ${grind.augmentName} (${formatInfiltrationTierLabel(grind.tier)})`)
    }
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
    if (view.etaRuns != null) {
      if (view.etaMs != null) {
        lines.push(`Est: ${ns.format.time(view.etaMs)} (${view.etaRuns} runs)`)
      } else {
        lines.push(`Est: ${view.etaRuns} runs (${ns.format.number(view.predictedReward)} rep/run predicted)`)
        lines.push("Time: need 1 completed round at this location")
      }
    }
  } else if (view.rewardGoal === "money" && view.moneyGoal && view.moneyGoal.moneyNeeded > 0) {
    lines.push("")
    lines.push("--- ETA ---")
    lines.push(`Goal: ${view.moneyGoal.label}`)
    lines.push(`Need: ${ns.format.number(view.moneyGoal.moneyNeeded)}`)
    if (view.etaRuns != null) {
      if (view.etaMs != null) {
        lines.push(`Est: ${ns.format.time(view.etaMs)} (${view.etaRuns} runs)`)
      } else {
        lines.push(`Est: ${view.etaRuns} runs (${ns.format.number(view.predictedReward)}/round predicted)`)
        lines.push("Time: need 1 completed round at this location")
      }
    }
  }

  return lines
}
