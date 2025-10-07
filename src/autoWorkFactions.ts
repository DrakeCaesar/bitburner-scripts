import { NS } from "@ns"

interface AugmentTarget {
  augmentName: string
  faction: string
  currentRep: number
  requiredRep: number
  repGap: number
}

export async function main(ns: NS) {
  ns.disableLog("ALL")
  const checkInterval = 10000 // Check every 10 seconds

  ns.tprint("Starting faction hacking contract automation...")

  let currentTargetKey = ""

  while (true) {
    const player = ns.getPlayer()
    const playerFactions = player.factions

    if (playerFactions.length === 0) {
      ns.tprint("ERROR: You are not in any factions yet!")
      return
    }

    // Find all augments we don't have enough rep for
    const targets = findBestAugmentTarget(ns, playerFactions)

    if (targets.length === 0) {
      ns.tprint("✓ You have enough reputation for all available augments!")
      return
    }

    // Pick the target where we're closest to fulfilling requirements
    const bestTarget = targets[0]
    const targetKey = `${bestTarget.faction}:${bestTarget.augmentName}`

    // Only print when target changes
    if (targetKey !== currentTargetKey) {
      currentTargetKey = targetKey
      ns.print(`\n${"=".repeat(60)}`)
      ns.print(`Target Augment: ${bestTarget.augmentName}`)
      ns.print(`Faction: ${bestTarget.faction}`)
      ns.print(`Current Rep: ${ns.formatNumber(bestTarget.currentRep)}`)
      ns.print(`Required Rep: ${ns.formatNumber(bestTarget.requiredRep)}`)
      ns.print(`Gap: ${ns.formatNumber(bestTarget.repGap)}`)
      ns.print(`${"=".repeat(60)}`)
    }

    const currentRep = ns.singularity.getFactionRep(bestTarget.faction)

    // Check if we've reached the target
    if (currentRep >= bestTarget.requiredRep) {
      ns.print(
        `✓ Reached target reputation for ${bestTarget.augmentName} in ${bestTarget.faction}: ${ns.formatNumber(currentRep)}/${ns.formatNumber(bestTarget.requiredRep)}`
      )
      // Continue to next iteration to pick new target
      continue
    }

    // Start hacking contract work for the faction
    const focus = ns.singularity.isFocused()
    const working = ns.singularity.workForFaction(bestTarget.faction, "hacking", focus)

    if (!working) {
      ns.print(`ERROR: Failed to work for ${bestTarget.faction}. Faction may not offer hacking contracts.`)
      // Sleep and try again (maybe work type will become available)
      await ns.sleep(checkInterval)
      continue
    }

    // Wait before checking again
    await ns.sleep(checkInterval)
  }
}

function findBestAugmentTarget(ns: NS, playerFactions: string[]): AugmentTarget[] {
  const ownedAugments = new Set(ns.singularity.getOwnedAugmentations(true))
  const targets: AugmentTarget[] = []
  const augmentsWithEnoughRep = new Set<string>()

  // First pass: identify which augments we already have enough rep for in ANY faction
  for (const faction of playerFactions) {
    const augments = ns.singularity.getAugmentationsFromFaction(faction)
    const currentRep = ns.singularity.getFactionRep(faction)

    for (const augName of augments) {
      if (ownedAugments.has(augName)) continue
      if (augName.startsWith("NeuroFlux Governor")) continue

      const requiredRep = ns.singularity.getAugmentationRepReq(augName)

      // If we have enough rep in this faction, mark the augment as satisfied
      if (currentRep >= requiredRep) {
        augmentsWithEnoughRep.add(augName)
      }
    }
  }

  // Second pass: collect augments we still need to work for
  for (const faction of playerFactions) {
    const augments = ns.singularity.getAugmentationsFromFaction(faction)
    const currentRep = ns.singularity.getFactionRep(faction)

    for (const augName of augments) {
      // Skip owned augments
      if (ownedAugments.has(augName)) continue

      // Skip NeuroFlux Governor (it's special)
      if (augName.startsWith("NeuroFlux Governor")) continue

      // Skip augments we already have enough rep for in another faction
      if (augmentsWithEnoughRep.has(augName)) continue

      const requiredRep = ns.singularity.getAugmentationRepReq(augName)

      // Only consider augments we don't have enough rep for
      if (currentRep < requiredRep) {
        targets.push({
          augmentName: augName,
          faction: faction,
          currentRep: currentRep,
          requiredRep: requiredRep,
          repGap: requiredRep - currentRep,
        })
      }
    }
  }

  // Sort by smallest rep gap first (closest to achieving)
  targets.sort((a, b) => a.repGap - b.repGap)

  return targets
}
