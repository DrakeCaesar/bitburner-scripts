import type { CompanyName, JobField } from "@ns"

import { NS } from "@ns"
import { killOtherInstances } from "./libraries/batchCalculations"

const REQUIRED_REP = 300000

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
    const factionName = company === ns.enums.CompanyName.FulcrumTechnologies ? "Fulcrum Secret Technologies" : company

    ns.tprint(`\n${"=".repeat(60)}`)
    ns.tprint(`Target: ${company} (${factionName})`)
    ns.tprint(`Required Reputation: ${ns.formatNumber(REQUIRED_REP)}`)
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
      if (currentRep >= REQUIRED_REP) {
        ns.tprint(
          `✓ Reached target reputation for ${company}: ${ns.formatNumber(currentRep)}/${ns.formatNumber(REQUIRED_REP)}`
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

      // Find the position with the highest sum of required skills (proxy for rep gain)
      let bestField: JobField | null = null
      let bestPositionName = ""
      let bestSkillSum = -1

      for (const position of positions) {
        const posInfo = ns.singularity.getCompanyPositionInfo(company, position)
        const skills = posInfo.requiredSkills
        const player = ns.getPlayer()

        if (skills.defense != 0) continue

        if (skills.hacking > player.skills.hacking) continue
        if (skills.strength > player.skills.strength) continue
        if (skills.defense > player.skills.defense) continue
        if (skills.dexterity > player.skills.dexterity) continue
        if (skills.agility > player.skills.agility) continue
        if (skills.charisma > player.skills.charisma) continue
        if (skills.intelligence > player.skills.intelligence) continue

        // Calculate sum of all skill requirements as a proxy for reputation gain
        const skillSum =
          skills.hacking +
          skills.strength +
          skills.defense +
          skills.dexterity +
          skills.agility +
          skills.charisma +
          skills.intelligence

        if (skillSum > bestSkillSum) {
          bestSkillSum = skillSum
          bestField = posInfo.field
          bestPositionName = position
        }
      }

      if (!bestField) {
        ns.tprint(`ERROR: Could not find best position at ${company}`)
        return
      }

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
        `Working: ${jobName || bestPositionName} (skill req: ${bestSkillSum}) | Current: ${ns.formatNumber(currentRep)}/${ns.formatNumber(REQUIRED_REP)}`
      )

      // Wait before checking again
      await ns.sleep(checkInterval)
    }
  }

  ns.tprint("\n✓ All megacorp factions completed!")
}
