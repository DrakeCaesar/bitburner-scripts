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

  const checkInterval = 1000

  await killOtherInstances(ns)

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

        ns.singularity.universityCourse(uni, uniClass, false)
        await ns.sleep(checkInterval)
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
      const favor = player.factions.includes(factionName) ? ns.singularity.getFactionFavor(factionName) : 0
      const best = pickBestCompanyPosition(ns, company, positions, player, favor)

      if (!best) {
        ns.tprint(`ERROR: Could not find best position at ${company}`)
        return
      }

      const { field: bestField, positionName: bestPositionName, repPerSecond } = best

      // Apply for a job in the best field (this will get us the highest position we qualify for in that field)
      const jobName = ns.singularity.applyToCompany(company, bestField)
      if (jobName) {
        ns.tprint(`Applied to ${company} in field: ${bestField}, got position: ${jobName}`)
      }

      const working = ns.singularity.workForCompany(company, false)
      if (!working) {
        ns.tprint(`ERROR: Failed to work at ${company}`)
        return
      }

      ns.print(
        `Working: ${jobName || bestPositionName} (${ns.format.number(repPerSecond, "0.00")} rep/s) | Current: ${ns.format.number(currentRep)}/${ns.format.number(requiredRep)}`
      )

      // Wait before checking again
      await ns.sleep(checkInterval)
    }
  }

  ns.tprint("\n✓ All megacorp factions completed!")
  ns.exec("autoWorkFactions.js", "home")
}

function focusMultiplier(ns: NS): number {
  return ns.singularity.isFocused() ? 1 : UNFOCUSED_FOCUS_MULT
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

function companyRepPerSecond(ns: NS, company: CompanyName, position: JobName, favor: number): number | null {
  try {
    const gains = ns.formulas.work.companyGains(ns.getPlayer(), company, position, favor)
    return gains.reputation * CYCLES_PER_SECOND * focusMultiplier(ns)
  } catch {
    return null
  }
}

function pickBestCompanyPosition(
  ns: NS,
  company: CompanyName,
  positions: JobName[],
  player: Player,
  favor: number
): { field: JobField; positionName: JobName; repPerSecond: number } | null {
  let bestField: JobField | null = null
  let bestPositionName: JobName | null = null
  let bestRepPerSecond = -1

  for (const position of positions) {
    if (!meetsPositionRequirements(player, position, company, ns)) continue

    const repPerSecond = companyRepPerSecond(ns, company, position, favor)
    if (repPerSecond == null || repPerSecond <= bestRepPerSecond) continue

    bestRepPerSecond = repPerSecond
    bestField = ns.singularity.getCompanyPositionInfo(company, position).field
    bestPositionName = position
  }

  if (bestField == null || bestPositionName == null) return null

  return { field: bestField, positionName: bestPositionName, repPerSecond: bestRepPerSecond }
}
