import type { CompanyName, FactionName, JobField, JobName, Player } from "@ns"
import { NS } from "@ns"
import {
  CYCLES_PER_SECOND,
  COMBAT_GYM_SKILLS,
  EXP_GAIN_BY_GYM,
  combinedGymCombatExpPerSecond,
  type CombatGymSkill,
} from "./gymWorkout.js"
import { col, W, type ReactTableConfig } from "./scriptLogUiLayout.js"

const UNFOCUSED_FOCUS_MULT = 0.8

export const DEFAULT_REQUIRED_REP = 400000

export const REQUIRED_REP_OVERRIDES: Record<string, number> = {
  MegaCorp: 400000,
}

export function getMegacorps(ns: NS): CompanyName[] {
  return [
    ns.enums.CompanyName.ECorp,
    ns.enums.CompanyName.MegaCorp,
    ns.enums.CompanyName.FourSigma,
    ns.enums.CompanyName.KuaiGongInternational,
    ns.enums.CompanyName.NWO,
    ns.enums.CompanyName.BladeIndustries,
    ns.enums.CompanyName.OmniTekIncorporated,
    ns.enums.CompanyName.BachmanAndAssociates,
    ns.enums.CompanyName.ClarkeIncorporated,
    ns.enums.CompanyName.FulcrumTechnologies,
  ]
}

export function getRequiredRep(company: CompanyName): number {
  return REQUIRED_REP_OVERRIDES[company] ?? DEFAULT_REQUIRED_REP
}

export function getFactionName(company: CompanyName): FactionName {
  return company === "Fulcrum Technologies" ? "Fulcrum Secret Technologies" : (company as FactionName)
}

/** True if the player is already in this company's faction (no company rep grind needed). */
export function isMegacorpFactionUnlocked(ns: NS, company: CompanyName): boolean {
  return ns.getPlayer().factions.includes(getFactionName(company))
}

/** First megacorp autoWorkMegacorps would still be grinding (not faction-joined). */
export function getActiveMegacorp(ns: NS): CompanyName | null {
  for (const company of getMegacorps(ns)) {
    if (!isMegacorpFactionUnlocked(ns, company)) {
      return company
    }
  }
  return null
}

export interface MegacorpSkillTrainingOffer {
  company: CompanyName
  field: JobField
  position: JobName
  expPerSecond: number
  gymBaseline: number
  skillsBreakdown: string
}

export interface CombinedCombatExp {
  total: number
  gymBaseline: number
  skills: CombatGymSkill[]
  breakdown: string
  bySkill: Partial<Record<CombatGymSkill, number>>
}

function focusMultiplier(focus: boolean): number {
  return focus ? 1 : UNFOCUSED_FOCUS_MULT
}

/** Combat skill exp/s from a company job (formulas API, same assumptions as rep/s display). */
export function combatSkillExpPerSecondFromCompany(
  ns: NS,
  company: CompanyName,
  position: JobName,
  skill: CombatGymSkill,
  focus = ns.singularity.isFocused()
): number | null {
  try {
    const favor = ns.singularity.getCompanyFavor(company)
    const gains = ns.formulas.work.companyGains(ns.getPlayer(), company, position, favor)
    const expPerCycle = gains[EXP_GAIN_BY_GYM[skill]]
    if (expPerCycle <= 0) return null
    return expPerCycle * CYCLES_PER_SECOND * focusMultiplier(focus)
  } catch {
    return null
  }
}

/** Sum combat skill exp/s from a job for every stat it trains, plus per-stat gym baseline. */
export function getCombinedCombatExpFromCompany(
  ns: NS,
  company: CompanyName,
  position: JobName,
  focus = ns.singularity.isFocused()
): CombinedCombatExp {
  const empty: CombinedCombatExp = {
    total: 0,
    gymBaseline: 0,
    skills: [],
    breakdown: "",
    bySkill: {},
  }

  try {
    const favor = ns.singularity.getCompanyFavor(company)
    const gains = ns.formulas.work.companyGains(ns.getPlayer(), company, position, favor)
    const bySkill: Partial<Record<CombatGymSkill, number>> = {}
    const skills: CombatGymSkill[] = []
    let total = 0

    for (const skill of COMBAT_GYM_SKILLS) {
      const expPerCycle = gains[EXP_GAIN_BY_GYM[skill]]
      if (expPerCycle > 0) {
        const rate = expPerCycle * CYCLES_PER_SECOND * focusMultiplier(focus)
        bySkill[skill] = rate
        skills.push(skill)
        total += rate
      }
    }

    return {
      total,
      gymBaseline: combinedGymCombatExpPerSecond(ns, skills, focus),
      skills,
      breakdown: skills.join("+"),
      bySkill,
    }
  } catch {
    return empty
  }
}

/**
 * Megacorp job autoWorkMegacorps would pick for the active company, rated by combined combat exp/s.
 * Returns null when no qualified position or the job grants no combat exp.
 */
export function getMegacorpSkillTrainingOffer(
  ns: NS,
  focus = ns.singularity.isFocused()
): MegacorpSkillTrainingOffer | null {
  const company = getActiveMegacorp(ns)
  if (!company) return null

  const positions = ns.singularity.getCompanyPositions(company)
  if (positions.length === 0) return null

  const player = ns.getPlayer()
  const companyRep = ns.singularity.getCompanyRep(company)
  const companyFavor = ns.singularity.getCompanyFavor(company)
  const best = pickBestCompanyField(ns, company, positions, player, companyFavor, companyRep)
  if (!best) return null

  const combined = getCombinedCombatExpFromCompany(ns, company, best.positionName, focus)
  if (combined.total <= 0) return null

  return {
    company,
    field: best.field,
    position: best.positionName,
    expPerSecond: combined.total,
    gymBaseline: combined.gymBaseline,
    skillsBreakdown: combined.breakdown,
  }
}

/** Apply and start the megacorp job autoWorkMegacorps would use for the active company. */
export function ensureMegacorpSkillWork(
  ns: NS,
  company: CompanyName,
  focus = ns.singularity.isFocused()
): boolean {
  const positions = ns.singularity.getCompanyPositions(company)
  if (positions.length === 0) return false

  const player = ns.getPlayer()
  const companyRep = ns.singularity.getCompanyRep(company)
  const companyFavor = ns.singularity.getCompanyFavor(company)
  const best = pickBestCompanyField(ns, company, positions, player, companyFavor, companyRep)
  if (!best) return false

  const currentJob = player.jobs[company]
  const currentField = currentJob
    ? ns.singularity.getCompanyPositionInfo(company, currentJob).field
    : null

  if (currentJob == null || currentField !== best.field) {
    const applied = ns.singularity.applyToCompany(company, best.field)
    if (!applied && currentJob == null) return false
  }

  if (!isWorkingAtCompany(ns, company)) {
    return ns.singularity.workForCompany(company, focus)
  }

  return true
}

export interface MegacorpRow {
  company: CompanyName
  faction: FactionName
  status: string
  job: string
  field: string
  repPerSecond: string
  rep: string
  target: string
  favor: string
  isSelected: boolean
  note: string
}

export interface MegacorpPositionRow {
  position: JobName
  field: JobField
  requiredRep: string
  qualified: string
  repPerSecond: string
  fieldPick: string
  isSelected: boolean
  note: string
}

export interface CombatSkillPositionRow {
  position: JobName
  field: JobField
  requiredRep: string
  qualified: string
  skillsBreakdown: string
  combinedExpPerSecond: number
  combinedExpLabel: string
  gymBaseline: number
  repPerSecond: string
  vsGym: string
  fieldPick: string
  isRepPick: boolean
  isBestCombined: boolean
  isTrainingPick: boolean
  note: string
}

export interface MegacorpWorkSnapshot {
  currentCompany: CompanyName
  completedCompanies: readonly CompanyName[]
  charismaGrind: boolean
  focus: boolean
  bestField: JobField | null
  bestPosition: JobName | null
  bestRepPerSecond: number | null
  alreadyWorking: boolean
  needsApply: boolean
  message: string
}

export function buildMegacorpRows(ns: NS, snapshot: MegacorpWorkSnapshot, megacorps: CompanyName[]): MegacorpRow[] {
  const player = ns.getPlayer()
  const rows: MegacorpRow[] = []

  for (const company of megacorps) {
    const faction = getFactionName(company)
    const requiredRep = getRequiredRep(company)
    const currentRep = ns.singularity.getCompanyRep(company)
    const favor = ns.singularity.getCompanyFavor(company)
    const job = player.jobs[company] ?? "—"
    const field = job !== "—" ? ns.singularity.getCompanyPositionInfo(company, job).field : "—"

    let status = "Pending"
    if (isMegacorpFactionUnlocked(ns, company)) {
      status = "Joined"
    } else if (snapshot.completedCompanies.includes(company)) {
      status = "Done"
    } else if (company === snapshot.currentCompany) {
      status = snapshot.charismaGrind ? "Charisma" : snapshot.alreadyWorking ? "Working" : "Setup"
    }

    let repPerSecond = "—"
    if (company === snapshot.currentCompany && job !== "—") {
      const rate = companyRepPerSecond(ns, company, job, favor)
      if (rate != null) repPerSecond = rate.toFixed(2)
    }

    let note = ""
    if (company === snapshot.currentCompany) {
      if (snapshot.message) note = snapshot.message
      else if (snapshot.needsApply && snapshot.bestField) note = `Apply ${snapshot.bestField}`
      else if (!snapshot.alreadyWorking) note = "Start work"
    }

    rows.push({
      company,
      faction,
      status,
      job,
      field,
      repPerSecond,
      rep: ns.format.number(currentRep),
      target: ns.format.number(requiredRep),
      favor: favor.toFixed(1),
      isSelected: company === snapshot.currentCompany,
      note,
    })
  }

  return rows.sort((a, b) => {
    if (a.isSelected) return -1
    if (b.isSelected) return 1
    const order = megacorps.indexOf(a.company) - megacorps.indexOf(b.company)
    return order
  })
}

function qualifiedPositionByField(
  ns: NS,
  company: CompanyName,
  positions: JobName[],
  player: Player,
  companyRep: number
): Map<JobField, JobName | null> {
  const result = new Map<JobField, JobName | null>()

  for (const [field, fieldPositions] of positionsByField(ns, company, positions)) {
    result.set(field, highestQualifiedInField(ns, company, fieldPositions, player, companyRep))
  }

  return result
}

export function buildMegacorpPositionRows(ns: NS, snapshot: MegacorpWorkSnapshot): MegacorpPositionRow[] {
  const company = snapshot.currentCompany
  if (isMegacorpFactionUnlocked(ns, company)) return []

  const positions = ns.singularity.getCompanyPositions(company)
  if (positions.length === 0) return []

  const player = ns.getPlayer()
  const companyRep = ns.singularity.getCompanyRep(company)
  const companyFavor = ns.singularity.getCompanyFavor(company)
  const qualifiedByField = qualifiedPositionByField(ns, company, positions, player, companyRep)
  const best = pickBestCompanyField(ns, company, positions, player, companyFavor, companyRep)
  const rows: MegacorpPositionRow[] = []

  for (const position of positions) {
    const info = ns.singularity.getCompanyPositionInfo(company, position)
    const skillsOk = meetsPositionRequirements(player, position, company, ns)
    const repOk = meetsPositionReputation(companyRep, info.requiredReputation)
    const qualified = skillsOk && repOk
    const fieldCandidate = qualifiedByField.get(info.field) === position
    const isSelected = best?.positionName === position
    const repRate = qualified
      ? companyRepPerSecond(ns, company, position, companyFavor)
      : null

    let note = ""
    if (!skillsOk) {
      note = "Skill requirements not met"
    } else if (!repOk) {
      note = `Need ${ns.format.number(info.requiredReputation)} company rep`
    } else if (!fieldCandidate) {
      note = "Not top qualified in field"
    } else if (!isSelected && best) {
      note = `Lower rep/s than ${best.field}`
    }

    rows.push({
      position,
      field: info.field,
      requiredRep: ns.format.number(info.requiredReputation),
      qualified: qualified ? "yes" : skillsOk ? "low rep" : "no",
      repPerSecond: repRate != null ? repRate.toFixed(2) : "—",
      fieldPick: fieldCandidate ? "yes" : "—",
      isSelected,
      note,
    })
  }

  return rows.sort((a, b) => {
    if (a.isSelected) return -1
    if (b.isSelected) return 1
    if (a.fieldPick === "yes" && b.fieldPick !== "yes") return -1
    if (b.fieldPick === "yes" && a.fieldPick !== "yes") return 1
    const aRep = a.repPerSecond === "—" ? -1 : Number(a.repPerSecond)
    const bRep = b.repPerSecond === "—" ? -1 : Number(b.repPerSecond)
    if (aRep !== bRep) return bRep - aRep
    return a.position.localeCompare(b.position)
  })
}

export function buildMegacorpPositionTableConfig(
  ns: NS,
  rows: MegacorpPositionRow[],
  snapshot: MegacorpWorkSnapshot
): ReactTableConfig {
  const selectedRowIndex = rows.findIndex((row) => row.isSelected)
  const highlightCells =
    selectedRowIndex >= 0
      ? new Set([`${selectedRowIndex},0`, `${selectedRowIndex},1`, `${selectedRowIndex},4`])
      : undefined

  const selected = rows.find((row) => row.isSelected)
  const titleParts = [
    `Positions @ ${snapshot.currentCompany}`,
    selected?.position ?? snapshot.bestPosition ?? null,
    selected != null && selected.repPerSecond !== "—"
      ? `${selected.repPerSecond} rep/s`
      : snapshot.bestRepPerSecond != null
        ? `${snapshot.bestRepPerSecond.toFixed(2)} rep/s`
        : null,
  ].filter(Boolean)

  return {
    title: titleParts.join(" — "),
    columns: [
      col("Pick", "center", W.pick),
      col("Position", "left", W.position),
      col("Field", "left", W.field),
      col("Req rep", "right"),
      col("Qualified", "center", W.job),
      col("Rep/s", "right", W.num),
      col("Field pick", "center", W.job),
      col("Why", "left", W.position),
    ],
    rows: rows.map((row) => [
      row.isSelected ? "->" : "",
      row.position,
      row.field,
      row.requiredRep,
      row.qualified,
      row.repPerSecond,
      row.fieldPick,
      row.note,
    ]),
    selectedRowIndex: selectedRowIndex >= 0 ? selectedRowIndex : undefined,
    highlightCells,
  }
}

function formatVsGym(skillExpPerSecond: number, gymExpPerSecond: number): string {
  if (skillExpPerSecond <= 0) return "—"
  const delta = skillExpPerSecond - gymExpPerSecond
  if (Math.abs(delta) < 0.005) return "0"
  return delta > 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2)
}

/** All company positions with combined combat exp/s vs gym, including unqualified jobs. */
export function buildCombatSkillPositionRows(
  ns: NS,
  company: CompanyName,
  options?: { focus?: boolean; trainingPosition?: JobName | null }
): CombatSkillPositionRow[] {
  if (isMegacorpFactionUnlocked(ns, company)) return []

  const positions = ns.singularity.getCompanyPositions(company)
  if (positions.length === 0) return []

  const focus = options?.focus ?? ns.singularity.isFocused()
  const trainingPosition = options?.trainingPosition ?? null
  const player = ns.getPlayer()
  const companyRep = ns.singularity.getCompanyRep(company)
  const companyFavor = ns.singularity.getCompanyFavor(company)
  const qualifiedByField = qualifiedPositionByField(ns, company, positions, player, companyRep)
  const best = pickBestCompanyField(ns, company, positions, player, companyFavor, companyRep)
  const rows: CombatSkillPositionRow[] = []

  let bestCombinedExp = -1
  let bestCombinedPosition: JobName | null = null

  for (const position of positions) {
    const combined = getCombinedCombatExpFromCompany(ns, company, position, focus)
    if (combined.total > bestCombinedExp) {
      bestCombinedExp = combined.total
      bestCombinedPosition = position
    }
  }

  for (const position of positions) {
    const info = ns.singularity.getCompanyPositionInfo(company, position)
    const skillsOk = meetsPositionRequirements(player, position, company, ns)
    const repOk = meetsPositionReputation(companyRep, info.requiredReputation)
    const qualified = skillsOk && repOk
    const fieldCandidate = qualifiedByField.get(info.field) === position
    const isRepPick = best?.positionName === position
    const combined = getCombinedCombatExpFromCompany(ns, company, position, focus)
    const repRate = qualified
      ? companyRepPerSecond(ns, company, position, companyFavor)
      : null

    let note = ""
    if (combined.total <= 0) {
      note = "No combat exp from job"
    } else if (!skillsOk) {
      note = "Skill requirements not met"
    } else if (!repOk) {
      note = `Need ${ns.format.number(info.requiredReputation)} company rep`
    } else if (!fieldCandidate) {
      note = "Not top qualified in field"
    } else if (!isRepPick && best) {
      note = `Lower rep/s than ${best.field}`
    }

    rows.push({
      position,
      field: info.field,
      requiredRep: ns.format.number(info.requiredReputation),
      qualified: qualified ? "yes" : skillsOk ? "low rep" : "no",
      skillsBreakdown: combined.breakdown || "—",
      combinedExpPerSecond: combined.total,
      combinedExpLabel: combined.total > 0 ? combined.total.toFixed(2) : "—",
      gymBaseline: combined.gymBaseline,
      repPerSecond: repRate != null ? repRate.toFixed(2) : "—",
      vsGym: formatVsGym(combined.total, combined.gymBaseline),
      fieldPick: fieldCandidate ? "yes" : "—",
      isRepPick,
      isBestCombined: bestCombinedPosition === position && combined.total > 0,
      isTrainingPick: trainingPosition === position,
      note,
    })
  }

  return rows.sort((a, b) => {
    if (a.isTrainingPick) return -1
    if (b.isTrainingPick) return 1
    if (a.isBestCombined) return -1
    if (b.isBestCombined) return 1
    if (a.combinedExpPerSecond !== b.combinedExpPerSecond) {
      return b.combinedExpPerSecond - a.combinedExpPerSecond
    }
    const aRep = a.repPerSecond === "—" ? -1 : Number(a.repPerSecond)
    const bRep = b.repPerSecond === "—" ? -1 : Number(b.repPerSecond)
    if (aRep !== bRep) return bRep - aRep
    return a.position.localeCompare(b.position)
  })
}

export function buildCombatSkillPositionTableConfig(
  ns: NS,
  rows: CombatSkillPositionRow[],
  skill: CombatGymSkill,
  company: CompanyName,
  gymExpPerSecond: number,
  trainingMode: "gym" | "megacorp"
): ReactTableConfig {
  const selectedRowIndex = rows.findIndex((row) => row.isTrainingPick)
  const highlightCells =
    selectedRowIndex >= 0
      ? new Set([
          `${selectedRowIndex},0`,
          `${selectedRowIndex},1`,
          `${selectedRowIndex},5`,
          `${selectedRowIndex},6`,
          `${selectedRowIndex},7`,
        ])
      : undefined

  const trainingRow = rows.find((row) => row.isTrainingPick)
  const bestCombinedRow = rows.find((row) => row.isBestCombined)
  const pickLabel =
    trainingMode === "gym"
      ? `gym ${gymExpPerSecond.toFixed(2)}/s (${skill})`
      : trainingRow != null
        ? `${trainingRow.position} ${trainingRow.skillsBreakdown} ${trainingRow.combinedExpLabel}/s`
        : "megacorp"

  const titleParts = [
    `Combat ${skill} @ ${company}`,
    `gym ${skill} ${gymExpPerSecond.toFixed(2)}/s`,
    bestCombinedRow != null && bestCombinedRow.combinedExpPerSecond > 0
      ? `best job ${bestCombinedRow.skillsBreakdown} ${bestCombinedRow.combinedExpLabel}/s`
      : null,
    `pick ${pickLabel}`,
  ].filter(Boolean)

  return {
    title: titleParts.join(" — "),
    columns: [
      col("Pick", "center", W.pick),
      col("Position", "left", W.position),
      col("Field", "left", W.field),
      col("Req rep", "right"),
      col("Qualified", "center", W.job),
      col("Stats", "left", W.stat),
      col("XP/s", "right", W.xp),
      col("vs gym", "right", W.num),
      col("Rep/s", "right", W.num),
      col("Field pick", "center", W.job),
      col("Why", "left", W.why),
    ],
    rows: rows.map((row) => {
      const pickParts: string[] = []
      if (row.isTrainingPick) pickParts.push("->")
      if (row.isBestCombined) pickParts.push("*")
      if (row.isRepPick && !row.isTrainingPick) pickParts.push("R")
      return [
        pickParts.join(" "),
        row.position,
        row.field,
        row.requiredRep,
        row.qualified,
        row.skillsBreakdown,
        row.combinedExpLabel,
        row.vsGym,
        row.repPerSecond,
        row.fieldPick,
        row.note,
      ]
    }),
    selectedRowIndex: selectedRowIndex >= 0 ? selectedRowIndex : undefined,
    highlightCells,
  }
}

export function buildMegacorpTableConfig(ns: NS, rows: MegacorpRow[], snapshot: MegacorpWorkSnapshot): ReactTableConfig {
  const selectedRowIndex = rows.findIndex((r) => r.isSelected)
  const highlightCells =
    selectedRowIndex >= 0
      ? new Set([`${selectedRowIndex},0`, `${selectedRowIndex},2`, `${selectedRowIndex},5`])
      : undefined

  const job = ns.getPlayer().jobs[snapshot.currentCompany]
  const titleParts = [
    "Megacorp work",
    snapshot.currentCompany,
    job != null ? job : null,
    snapshot.bestRepPerSecond != null ? `${snapshot.bestRepPerSecond.toFixed(2)} rep/s` : null,
    snapshot.focus ? "focused" : "unfocused",
  ].filter(Boolean)

  return {
    title: titleParts.join(" — "),
    columns: [
      col("Company", "left", W.company),
      col("Status", "left", W.status),
      col("Job", "left", W.jobLong),
      col("Field", "left", W.field),
      col("Rep/s", "right", W.num),
      col("Rep", "right"),
      col("Target", "right"),
      col("Favor", "right"),
      col("Note", "left", W.note),
    ],
    rows: rows.map((row) => [
      row.company,
      row.status,
      row.job,
      row.field,
      row.repPerSecond,
      row.rep,
      row.target,
      row.favor,
      row.note,
    ]),
    selectedRowIndex: selectedRowIndex >= 0 ? selectedRowIndex : undefined,
    highlightCells,
  }
}

export function isWorkingAtCompany(ns: NS, company: CompanyName): boolean {
  const work = ns.singularity.getCurrentWork()
  return work != null && work.type === "COMPANY" && work.companyName === company
}

export function isStudyingLeadershipAtVolhaven(ns: NS): boolean {
  const work = ns.singularity.getCurrentWork()
  if (!work || work.type !== "CLASS") return false
  return (
    work.classType === ns.enums.UniversityClassType.leadership &&
    work.location === ns.enums.LocationName.VolhavenZBInstituteOfTechnology
  )
}

function meetsPositionRequirements(player: Player, position: JobName, company: CompanyName, ns: NS): boolean {
  const skills = ns.singularity.getCompanyPositionInfo(company, position).requiredSkills

  if (skills.hacking > player.skills.hacking) return false
  if (skills.strength > player.skills.strength) return false
  if (skills.defense > player.skills.defense) return false
  if (skills.dexterity > player.skills.dexterity) return false
  if (skills.agility > player.skills.agility) return false
  if (skills.charisma > player.skills.charisma) return false
  if (skills.intelligence > player.skills.intelligence) return false

  return true
}

function meetsPositionReputation(companyRep: number, requiredRep: number): boolean {
  return companyRep >= requiredRep
}

/** Focused rep/s from formulas API (favor, augments, BitNode mults included). */
export function companyRepPerSecond(
  ns: NS,
  company: CompanyName,
  position: JobName,
  companyFavor: number
): number | null {
  try {
    const gains = ns.formulas.work.companyGains(ns.getPlayer(), company, position, companyFavor)
    return gains.reputation * CYCLES_PER_SECOND
  } catch {
    return null
  }
}

function positionsByField(ns: NS, company: CompanyName, positions: JobName[]): Map<JobField, JobName[]> {
  const byField = new Map<JobField, JobName[]>()

  for (const position of positions) {
    const field = ns.singularity.getCompanyPositionInfo(company, position).field
    const list = byField.get(field) ?? []
    list.push(position)
    byField.set(field, list)
  }

  return byField
}

function highestQualifiedInField(
  ns: NS,
  company: CompanyName,
  fieldPositions: JobName[],
  player: Player,
  companyRep: number
): JobName | null {
  if (fieldPositions.length === 0) return null

  let entry = fieldPositions[0]
  let minRep = ns.singularity.getCompanyPositionInfo(company, entry).requiredReputation

  for (const position of fieldPositions) {
    const req = ns.singularity.getCompanyPositionInfo(company, position).requiredReputation
    if (req < minRep) {
      minRep = req
      entry = position
    }
  }

  if (!meetsPositionRequirements(player, entry, company, ns)) {
    return null
  }
  if (!meetsPositionReputation(companyRep, minRep)) {
    return null
  }

  let current = entry
  for (;;) {
    const next = ns.singularity.getCompanyPositionInfo(company, current).nextPosition
    if (next == null || !fieldPositions.includes(next)) break

    const nextInfo = ns.singularity.getCompanyPositionInfo(company, next)
    if (!meetsPositionRequirements(player, next, company, ns)) break
    if (!meetsPositionReputation(companyRep, nextInfo.requiredReputation)) break

    current = next
  }

  return current
}

export function pickBestCompanyField(
  ns: NS,
  company: CompanyName,
  positions: JobName[],
  player: Player,
  companyFavor: number,
  companyRep = ns.singularity.getCompanyRep(company)
): { field: JobField; positionName: JobName; repPerSecond: number } | null {
  let bestField: JobField | null = null
  let bestPositionName: JobName | null = null
  let bestRepPerSecond = -1

  for (const [field, fieldPositions] of positionsByField(ns, company, positions)) {
    const position = highestQualifiedInField(ns, company, fieldPositions, player, companyRep)
    if (position == null) continue

    const repPerSecond = companyRepPerSecond(ns, company, position, companyFavor)
    if (repPerSecond == null || repPerSecond <= bestRepPerSecond) continue

    bestRepPerSecond = repPerSecond
    bestField = field
    bestPositionName = position
  }

  if (bestField == null || bestPositionName == null) return null

  return { field: bestField, positionName: bestPositionName, repPerSecond: bestRepPerSecond }
}
