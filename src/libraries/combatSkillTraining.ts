import type { CompanyName, JobField, JobName, NS } from "@ns"
import {
  GYM_CITY,
  GYM_NAME,
  combatGymExpPerSecond,
  getCombatGymSkillLevel,
  startGymWorkout,
  type CombatGymSkill,
} from "./gymWorkout.js"
import {
  buildCombatSkillPositionRows,
  buildCombatSkillPositionTableConfig,
  ensureMegacorpSkillWork,
  getActiveMegacorp,
  getMegacorpSkillTrainingOffer,
} from "./megacorpWork.js"
import { travelToInfiltrationCity } from "./infiltration/infiltrationRun.js"
import { canAffordInfiltrationTravel } from "./infiltration/infiltrationTargets.js"
import { createTailLog } from "./scriptLogUiLayout.js"

export type CombatSkillTrainingMode = "gym" | "megacorp"

export interface CombatSkillTrainingPlan {
  skill: CombatGymSkill
  mode: CombatSkillTrainingMode
  expPerSecond: number
  gymExpPerSecond: number
  megacorpExpPerSecond: number | null
  megacorpGymBaseline: number | null
  skillsBreakdown: string | null
  company?: CompanyName
  position?: JobName
  field?: JobField
}

export function getCombatSkillTrainingPlan(ns: NS, skill: CombatGymSkill): CombatSkillTrainingPlan {
  const focus = ns.singularity.isFocused()
  const gymExpPerSecond = combatGymExpPerSecond(ns, skill, focus) ?? 0
  const megacorp = getMegacorpSkillTrainingOffer(ns, focus)
  const megacorpExpPerSecond = megacorp?.expPerSecond ?? null
  const megacorpGymBaseline = megacorp?.gymBaseline ?? null

  if (
    megacorp != null &&
    megacorpExpPerSecond != null &&
    megacorpGymBaseline != null &&
    megacorpExpPerSecond > megacorpGymBaseline
  ) {
    return {
      skill,
      mode: "megacorp",
      expPerSecond: megacorpExpPerSecond,
      gymExpPerSecond,
      megacorpExpPerSecond,
      megacorpGymBaseline,
      skillsBreakdown: megacorp.skillsBreakdown,
      company: megacorp.company,
      position: megacorp.position,
      field: megacorp.field,
    }
  }

  return {
    skill,
    mode: "gym",
    expPerSecond: gymExpPerSecond,
    gymExpPerSecond,
    megacorpExpPerSecond,
    megacorpGymBaseline,
    skillsBreakdown: megacorp?.skillsBreakdown ?? null,
  }
}

/** Tail table of every megacorp position vs gym for one combat skill. */
export async function renderCombatSkillTrainingTable(ns: NS, skill: CombatGymSkill): Promise<void> {
  const plan = getCombatSkillTrainingPlan(ns, skill)
  const company = getActiveMegacorp(ns)
  const log = createTailLog()

  if (!company) {
    log.text(`Combat ${skill}: no active megacorp (gym ${ns.format.number(plan.gymExpPerSecond)}/s)`)
    await log.render(ns)
    return
  }

  const trainingPosition = plan.mode === "megacorp" ? (plan.position ?? null) : null
  const rows = buildCombatSkillPositionRows(ns, company, {
    focus: ns.singularity.isFocused(),
    trainingPosition,
  })

  if (rows.length === 0) {
    log.text(`Combat ${skill} @ ${company}: no positions (gym ${ns.format.number(plan.gymExpPerSecond)}/s)`)
    await log.render(ns)
    return
  }

  log.table(
    buildCombatSkillPositionTableConfig(
      ns,
      rows,
      skill,
      company,
      plan.gymExpPerSecond,
      plan.mode
    )
  )
  await log.render(ns)
}

/** Train lowest combat stat via gym or megacorp work, whichever yields more skill exp/s. */
export async function prepareCombatSkillTraining(ns: NS, skill: CombatGymSkill): Promise<void> {
  if (ns.singularity.getCurrentWork()?.type === "FACTION") {
    ns.print("Skipping combat training; faction work active")
    return
  }

  const plan = getCombatSkillTrainingPlan(ns, skill)
  const focus = ns.singularity.isFocused()

  if (plan.mode === "megacorp" && plan.company) {
    if (ensureMegacorpSkillWork(ns, plan.company, focus)) {
      const breakdown = plan.skillsBreakdown ?? plan.skill
      const gymBaseline = plan.megacorpGymBaseline ?? plan.gymExpPerSecond
      ns.print(
        `Megacorp: ${plan.company} ${plan.position} (${breakdown} ${ns.format.number(plan.expPerSecond)}/s vs gym ${ns.format.number(gymBaseline)}/s)`
      )
      return
    }
  }

  if (ns.getPlayer().city !== GYM_CITY) {
    if (!canAffordInfiltrationTravel(ns)) {
      ns.print(`Skipping gym; cannot afford travel to ${GYM_CITY}`)
      return
    }
    ns.print(`Traveling to ${GYM_CITY} for gym (${skill})`)
    if (!(await travelToInfiltrationCity(ns, GYM_CITY))) {
      ns.print(`Travel to ${GYM_CITY} failed; skipping gym`)
      return
    }
  }

  const level = getCombatGymSkillLevel(ns, skill)
  const megacorpNote =
    plan.megacorpExpPerSecond != null && plan.megacorpGymBaseline != null
      ? `, megacorp ${plan.skillsBreakdown ?? ""} ${ns.format.number(plan.megacorpExpPerSecond)}/s vs gym ${ns.format.number(plan.megacorpGymBaseline)}/s`
      : ""
  ns.print(
    `Gym: ${GYM_NAME} (${skill}, level ${level}, ${ns.format.number(plan.gymExpPerSecond)}/s${megacorpNote})`
  )
  startGymWorkout(ns, skill, focus)
}
