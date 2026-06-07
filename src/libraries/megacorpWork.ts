import type { CompanyName, FactionName, JobField, JobName, Player } from "@ns"
import { NS } from "@ns"
import type { ReactTableConfig } from "./scriptLogUi.js"

const CYCLES_PER_SECOND = 1000 / 200
const UNFOCUSED_FOCUS_MULT = 0.8

export const DEFAULT_REQUIRED_REP = 400000

export const REQUIRED_REP_OVERRIDES: Record<string, number> = {
  MegaCorp: 300000,
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
      const rate = companyRepPerSecond(ns, company, job, favor, snapshot.focus)
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
      { header: "Company", align: "left", minWidth: 14 },
      { header: "Status", align: "left", minWidth: 8 },
      { header: "Job", align: "left", minWidth: 18 },
      { header: "Field", align: "left", minWidth: 10 },
      { header: "Rep/s", align: "right", minWidth: 7 },
      { header: "Rep", align: "right" },
      { header: "Target", align: "right" },
      { header: "Favor", align: "right" },
      { header: "Note", align: "left", minWidth: 16 },
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

export function focusMultiplier(focused: boolean): number {
  return focused ? 1 : UNFOCUSED_FOCUS_MULT
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

  if (skills.defense !== 0) return false
  if (skills.hacking > player.skills.hacking) return false
  if (skills.strength > player.skills.strength) return false
  if (skills.defense > player.skills.defense) return false
  if (skills.dexterity > player.skills.dexterity) return false
  if (skills.agility > player.skills.agility) return false
  if (skills.charisma > player.skills.charisma) return false
  if (skills.intelligence > player.skills.intelligence) return false

  return true
}

export function companyRepPerSecond(
  ns: NS,
  company: CompanyName,
  position: JobName,
  companyFavor: number,
  focused: boolean
): number | null {
  try {
    const gains = ns.formulas.work.companyGains(ns.getPlayer(), company, position, companyFavor)
    return gains.reputation * CYCLES_PER_SECOND * focusMultiplier(focused)
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
  player: Player
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

  let current = entry
  for (;;) {
    const next = ns.singularity.getCompanyPositionInfo(company, current).nextPosition
    if (next == null || !fieldPositions.includes(next)) break
    if (!meetsPositionRequirements(player, next, company, ns)) break
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
  focused: boolean
): { field: JobField; positionName: JobName; repPerSecond: number } | null {
  let bestField: JobField | null = null
  let bestPositionName: JobName | null = null
  let bestRepPerSecond = -1

  for (const [field, fieldPositions] of positionsByField(ns, company, positions)) {
    const position = highestQualifiedInField(ns, company, fieldPositions, player)
    if (position == null) continue

    const repPerSecond = companyRepPerSecond(ns, company, position, companyFavor, focused)
    if (repPerSecond == null || repPerSecond <= bestRepPerSecond) continue

    bestRepPerSecond = repPerSecond
    bestField = field
    bestPositionName = position
  }

  if (bestField == null || bestPositionName == null) return null

  return { field: bestField, positionName: bestPositionName, repPerSecond: bestRepPerSecond }
}
