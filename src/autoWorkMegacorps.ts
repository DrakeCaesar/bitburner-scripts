import type { CompanyName, FactionName, JobField, JobName, Player } from "@ns"

import { NS } from "@ns"
import { killOtherInstances } from "./libraries/batchCalculations"

const CYCLES_PER_SECOND = 1000 / 200
const UNFOCUSED_FOCUS_MULT = 0.8

// Default required reputation for most megacorporations
const DEFAULT_REQUIRED_REP = 400000

// Per-company overrides. Use the company enum string as the key.
// Example: MegaCorp requires 300,000 rep while others use the default.
const REQUIRED_REP_OVERRIDES: Record<string, number> = {
  MegaCorp: 300000,
  // Add other overrides here if needed, e.g.
  // "ECorp": 500000,
}

export async function main(ns: NS) {
  const megacorps: CompanyName[] = [
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

  const activeIntervalMs = 1000
  const stableIntervalMs = 5000

  await killOtherInstances(ns)
  ns.disableLog("ALL")

  ns.tprint("Starting megacorp reputation grind...")

  for (const company of megacorps) {
    // Map company to faction name (most are the same, except Fulcrum)
    const factionName: FactionName =
      company === ns.enums.CompanyName.FulcrumTechnologies ? "Fulcrum Secret Technologies" : (company as FactionName)

    ns.tprint(`\n${"=".repeat(60)}`)
    ns.tprint(`Target: ${company} (${factionName})`)
    const requiredRep = REQUIRED_REP_OVERRIDES[company] ?? DEFAULT_REQUIRED_REP
    ns.tprint(`Required Reputation: ${ns.format.number(requiredRep)}`)
    ns.tprint(`${"=".repeat(60)}`)

    // Work at this company until we reach the required reputation
    while (true) {
      const focus = ns.singularity.isFocused()
      const currentRep = ns.singularity.getCompanyRep(company)

      const currentCharisma = ns.getPlayer().skills.charisma
      const currentCity = ns.getPlayer().city
      const uniCity = ns.enums.CityName.Aevum
      const uniClass = ns.enums.UniversityClassType.leadership
      const uni = ns.enums.LocationName.AevumSummitUniversity

      if (currentCharisma < 500) {
        if (currentCity != uniCity) {
          ns.singularity.travelToCity(uniCity)
        }

        ns.singularity.universityCourse(uni, uniClass, focus)
        await ns.sleep(activeIntervalMs)
        continue
      }

      // Check if we've reached the target
      if (currentRep >= requiredRep) {
        ns.tprint(
          `✓ Reached target reputation for ${company}: ${ns.format.number(currentRep)}/${ns.format.number(requiredRep)}`
        )

        // Check if we can join the faction
        const invitations = ns.singularity.checkFactionInvitations()
        if (invitations.includes(factionName)) {
          ns.tprint(`✓ Faction invitation received: ${factionName}`)
          ns.singularity.joinFaction(factionName)
          ns.tprint(`✓ Joined faction: ${factionName}`)
        } else {
          ns.tprint(`⚠ Waiting for faction invitation from ${factionName}...`)
        }
        break
      }

      // Get all available positions at this company
      const positions = ns.singularity.getCompanyPositions(company)

      if (positions.length === 0) {
        ns.tprint(`ERROR: No positions available at ${company}`)
        return
      }

      const player = ns.getPlayer()
      const companyFavor = ns.singularity.getCompanyFavor(company)
      const best = pickBestCompanyField(ns, company, positions, player, companyFavor, focus)

      if (!best) {
        ns.tprint(`ERROR: Could not find best position at ${company}`)
        return
      }

      const { field: bestField, positionName: targetPosition, repPerSecond } = best
      const currentJob = player.jobs[company]
      const currentField = currentJob
        ? ns.singularity.getCompanyPositionInfo(company, currentJob).field
        : null
      const alreadyWorking = isWorkingAtCompany(ns, company)
      // Only apply when unemployed or switching field — not every tick for in-track promotions
      const needsApply = currentJob == null || currentField !== bestField

      if (needsApply) {
        const jobName = ns.singularity.applyToCompany(company, bestField)
        if (jobName) {
          ns.print(`Applied ${bestField}: ${jobName}`)
        } else if (currentJob) {
          ns.print(`Could not switch to ${bestField}; still ${currentJob}`)
        }
      }

      if (!alreadyWorking) {
        const working = ns.singularity.workForCompany(company, focus)
        if (!working) {
          ns.tprint(`ERROR: Failed to work at ${company}`)
          return
        }
      }

      if (needsApply || !alreadyWorking) {
        const activeJob = ns.getPlayer().jobs[company] ?? targetPosition
        const activeRepPerSecond =
          activeJob != null ? companyRepPerSecond(ns, company, activeJob, companyFavor, focus) : null
        const repLabel =
          activeRepPerSecond != null ? activeRepPerSecond.toFixed(2) : repPerSecond.toFixed(2)
        ns.print(
          `Working: ${activeJob} (${repLabel} rep/s) | ${ns.format.number(currentRep)}/${ns.format.number(requiredRep)}`
        )
      }

      const interval = alreadyWorking && !needsApply ? stableIntervalMs : activeIntervalMs
      await ns.sleep(interval)
    }
  }

  ns.tprint("\n✓ All megacorp factions completed!")
  ns.exec("autoWorkFactions.js", "home")
}

function focusMultiplier(focused: boolean): number {
  return focused ? 1 : UNFOCUSED_FOCUS_MULT
}

/** workForCompany always calls startWork() and resets the timer — skip if already on this company. */
function isWorkingAtCompany(ns: NS, company: CompanyName): boolean {
  const work = ns.singularity.getCurrentWork()
  return work != null && work.type === "COMPANY" && work.companyName === company
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

function companyRepPerSecond(
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

/** Group company positions by job field. */
function positionsByField(
  ns: NS,
  company: CompanyName,
  positions: JobName[]
): Map<JobField, JobName[]> {
  const byField = new Map<JobField, JobName[]>()

  for (const position of positions) {
    const field = ns.singularity.getCompanyPositionInfo(company, position).field
    const list = byField.get(field) ?? []
    list.push(position)
    byField.set(field, list)
  }

  return byField
}

/**
 * Highest job in a field's promotion ladder you qualify for (same logic as applyToCompany).
 */
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

/**
 * Pick the field whose promotion-track job has the best rep/s.
 * applyToCompany(company, field) always assigns that track's highest qualified job, not an arbitrary listing.
 */
function pickBestCompanyField(
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
