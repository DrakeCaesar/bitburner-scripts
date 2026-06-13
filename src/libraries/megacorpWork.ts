import type { CompanyName, FactionName, JobField, JobName, Player } from "@ns"
import { NS } from "@ns"
import { col, W, type ReactTableConfig } from "./scriptLogUiLayout.js"

const CYCLES_PER_SECOND = 1000 / 200

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
