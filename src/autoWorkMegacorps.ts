import type { CompanyName, JobField } from "@ns"

import { NS } from "@ns"
import { killOtherInstances } from "./libraries/batchCalculations"

interface MegacorpTarget {
  company: CompanyName
  requiredRep: number
  factionName: string
  backdoorServer?: string
}

export async function main(ns: NS) {
  const megacorps: MegacorpTarget[] = [
    { company: "ECorp" as CompanyName, requiredRep: 300000, factionName: "ECorp" },
    { company: "MegaCorp" as CompanyName, requiredRep: 300000, factionName: "MegaCorp" },
    { company: "Four Sigma" as CompanyName, requiredRep: 300000, factionName: "Four Sigma" },
    { company: "KuaiGong International" as CompanyName, requiredRep: 300000, factionName: "KuaiGong International" },
    { company: "NWO" as CompanyName, requiredRep: 300000, factionName: "NWO" },
    { company: "Blade Industries" as CompanyName, requiredRep: 300000, factionName: "Blade Industries" },
    { company: "OmniTek Incorporated" as CompanyName, requiredRep: 300000, factionName: "OmniTek Incorporated" },
    { company: "Bachman & Associates" as CompanyName, requiredRep: 300000, factionName: "Bachman & Associates" },
    { company: "Clarke Incorporated" as CompanyName, requiredRep: 300000, factionName: "Clarke Incorporated" },
    {
      company: "Fulcrum Secret Technologies" as CompanyName,
      requiredRep: 350000,
      factionName: "Fulcrum Secret Technologies",
      backdoorServer: "fulcrumassets",
    },
  ]

  const checkInterval = 1000

  await killOtherInstances(ns)

  ns.tprint("Starting megacorp reputation grind...")

  for (const target of megacorps) {
    ns.tprint(`\n${"=".repeat(60)}`)
    ns.tprint(`Target: ${target.company} (${target.factionName})`)
    ns.tprint(`Required Reputation: ${ns.formatNumber(target.requiredRep)}`)
    ns.tprint(`${"=".repeat(60)}`)

    // Check if backdoor is required and installed
    if (target.backdoorServer) {
      const server = ns.getServer(target.backdoorServer)
      if (!server.backdoorInstalled) {
        ns.tprint(`ERROR: Backdoor not installed on ${target.backdoorServer}!`)
        ns.tprint(`Install backdoor manually and restart script.`)
        return
      }
      ns.tprint(`✓ Backdoor installed on ${target.backdoorServer}`)
    }

    // Work at this company until we reach the required reputation
    while (true) {
      const currentRep = ns.singularity.getCompanyRep(target.company)

      // Check if we've reached the target
      if (currentRep >= target.requiredRep) {
        ns.tprint(
          `✓ Reached target reputation for ${target.company}: ${ns.formatNumber(currentRep)}/${ns.formatNumber(target.requiredRep)}`
        )

        // Check if we can join the faction
        const invitations = ns.singularity.checkFactionInvitations()
        if (invitations.includes(target.factionName)) {
          ns.tprint(`✓ Faction invitation received: ${target.factionName}`)
          ns.singularity.joinFaction(target.factionName)
          ns.tprint(`✓ Joined faction: ${target.factionName}`)
        } else {
          ns.tprint(`⚠ Waiting for faction invitation from ${target.factionName}...`)
        }
        break
      }

      // Get all available positions at this company
      const positions = ns.singularity.getCompanyPositions(target.company)

      if (positions.length === 0) {
        ns.tprint(`ERROR: No positions available at ${target.company}`)
        return
      }

      // Find the position with the highest sum of required skills (proxy for rep gain)
      let bestField: JobField | null = null
      let bestPositionName = ""
      let bestSkillSum = -1

      for (const position of positions) {
        const posInfo = ns.singularity.getCompanyPositionInfo(target.company, position)
        const skills = posInfo.requiredSkills
        const player = ns.getPlayer()

        // if (skills.charisma != 0) continue

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
        ns.tprint(`ERROR: Could not find best position at ${target.company}`)
        return
      }

      // Apply for a job in the best field (this will get us the highest position we qualify for in that field)
      const jobName = ns.singularity.applyToCompany(target.company, bestField)
      if (jobName) {
        ns.tprint(`Applied to ${target.company} in field: ${bestField}, got position: ${jobName}`)
      }

      const working = ns.singularity.workForCompany(target.company, false)
      if (!working) {
        ns.tprint(`ERROR: Failed to work at ${target.company}`)
        return
      }

      ns.tprint(
        `Working: ${jobName || bestPositionName} (skill req: ${bestSkillSum}) | Current: ${ns.formatNumber(currentRep)}/${ns.formatNumber(target.requiredRep)}`
      )

      // Wait before checking again
      await ns.sleep(checkInterval)
    }
  }

  ns.tprint("\n✓ All megacorp factions completed!")
}
