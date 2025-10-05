import { NS } from "@ns"

interface MegacorpTarget {
  company: string
  requiredRep: number
  factionName: string
  backdoorServer?: string
}

export async function main(ns: NS) {
  const megacorps: MegacorpTarget[] = [
    { company: "ECorp", requiredRep: 200000, factionName: "ECorp" },
    { company: "MegaCorp", requiredRep: 200000, factionName: "MegaCorp" },
    { company: "Four Sigma", requiredRep: 200000, factionName: "Four Sigma" },
    { company: "KuaiGong International", requiredRep: 200000, factionName: "KuaiGong International" },
    { company: "NWO", requiredRep: 200000, factionName: "NWO" },
    { company: "Blade Industries", requiredRep: 200000, factionName: "Blade Industries" },
    { company: "OmniTek Incorporated", requiredRep: 200000, factionName: "OmniTek Incorporated" },
    { company: "Bachman & Associates", requiredRep: 200000, factionName: "Bachman & Associates" },
    { company: "Clarke Incorporated", requiredRep: 200000, factionName: "Clarke Incorporated" },
    {
      company: "Fulcrum Technologies",
      requiredRep: 250000,
      factionName: "Fulcrum Secret Technologies",
      backdoorServer: "fulcrumassets",
    },
  ]

  const checkInterval = 60000 // Check every 60 seconds

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
      let bestField = ""
      let bestPositionName = ""
      let bestSkillSum = -1

      for (const position of positions) {
        const posInfo = ns.singularity.getCompanyPositionInfo(target.company, position)
        const skills = posInfo.requiredSkills

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

      const working = ns.singularity.workForCompany(target.company, true)
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
