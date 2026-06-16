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
  getActiveMegacorp,
  getMegacorpSkillTrainingOffer,
  tickInfiltrationMegacorpWork,
} from "./megacorpWork.js"
import { travelToInfiltrationCity } from "./infiltration/infiltrationRun.js"
import {
  areAllInfiltrationsDoable,
  canAffordInfiltrationTravel,
} from "./infiltration/infiltrationTargets.js"
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
  const activeCompany = getActiveMegacorp(ns)

  if (areAllInfiltrationsDoable(ns) && activeCompany != null) {
    return {
      skill,
      mode: "megacorp",
      expPerSecond: megacorpExpPerSecond ?? 0,
      gymExpPerSecond,
      megacorpExpPerSecond,
      megacorpGymBaseline,
      skillsBreakdown: megacorp?.skillsBreakdown ?? null,
      company: megacorp?.company ?? activeCompany,
      position: megacorp?.position,
      field: megacorp?.field,
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

/** Train combat via gym until all infiltrations doable, then megacorp rep grind. */
export async function prepareCombatSkillTraining(ns: NS, skill: CombatGymSkill): Promise<void> {
  if (ns.singularity.getCurrentWork()?.type === "FACTION") {
    ns.print("Skipping combat training; faction work active")
    return
  }

  const plan = getCombatSkillTrainingPlan(ns, skill)
  const focus = ns.singularity.isFocused()

  if (plan.mode === "megacorp") {
    const result = tickInfiltrationMegacorpWork(ns, focus)
    if (result.ok) {
      const jobLabel =
        result.position != null && result.company != null
          ? `${result.company} ${result.position}`
          : (result.company ?? "megacorp")
      ns.print(`Megacorp (all infiltrations doable): ${jobLabel} — ${result.message}`)
      return
    }
    ns.print(`Megacorp work failed: ${result.message}; falling back to gym`)
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
