import { NS } from "@ns"

export async function main(ns: NS) {
  const outputFile = ns.args[0] ? String(ns.args[0]) : "augments-export.txt"

  // All factions in the game
  const allFactions = [
    "Illuminati",
    "Daedalus",
    "The Covenant",
    "ECorp",
    "MegaCorp",
    "Bachman & Associates",
    "Blade Industries",
    "NWO",
    "Clarke Incorporated",
    "OmniTek Incorporated",
    "Four Sigma",
    "KuaiGong International",
    "Fulcrum Secret Technologies",
    "BitRunners",
    "The Black Hand",
    "NiteSec",
    "Aevum",
    "Chongqing",
    "Ishima",
    "New Tokyo",
    "Sector-12",
    "Volhaven",
    "Speakers for the Dead",
    "The Dark Army",
    "The Syndicate",
    "Silhouette",
    "Tetrads",
    "Slum Snakes",
    "Netburners",
    "Tian Di Hui",
    "CyberSec",
    "Bladeburners",
    "Church of the Machine God",
    "Shadows of Anarchy",
  ]

  // Map to store augmentation data
  const augmentMap = new Map<
    string,
    {
      name: string
      factions: string[]
      price: number
      basePrice: number
      repReq: number
      prereqs: string[]
      stats: any
    }
  >()

  ns.tprint("Collecting augmentation data from all factions...")

  // Iterate through all factions
  for (const faction of allFactions) {
    try {
      const augments = ns.singularity.getAugmentationsFromFaction(faction)

      for (const augName of augments) {
        if (augmentMap.has(augName)) {
          // Just add this faction to the existing entry
          augmentMap.get(augName)!.factions.push(faction)
        } else {
          // Create new entry with all augmentation properties
          const price = ns.singularity.getAugmentationPrice(augName)
          const basePrice = ns.singularity.getAugmentationBasePrice(augName)
          const repReq = ns.singularity.getAugmentationRepReq(augName)
          const prereqs = ns.singularity.getAugmentationPrereq(augName)
          const stats = ns.singularity.getAugmentationStats(augName)

          augmentMap.set(augName, {
            name: augName,
            factions: [faction],
            price: price,
            basePrice: basePrice,
            repReq: repReq,
            prereqs: prereqs,
            stats: stats,
          })
        }
      }
    } catch (error) {
      // Some factions might not be accessible or might cause errors
      ns.tprint(`Warning: Could not access faction "${faction}": ${error}`)
    }
  }

  // Convert to array and sort by name
  const augmentArray = Array.from(augmentMap.values()).sort((a, b) => a.name.localeCompare(b.name))

  // Create output object
  const output = {
    exportDate: new Date().toISOString(),
    totalAugmentations: augmentArray.length,
    augmentations: augmentArray,
  }

  // Write to file
  const jsonOutput = JSON.stringify(output, null, 2)
  await ns.write(outputFile, jsonOutput, "w")

  ns.tprint(`\n${"=".repeat(80)}`)
  ns.tprint(`Successfully exported ${augmentArray.length} augmentations to ${outputFile}`)
  ns.tprint(`${"=".repeat(80)}\n`)

  // Print some stats
  const totalFactionCount = augmentArray.reduce((sum, aug) => sum + aug.factions.length, 0)
  const avgFactionsPerAug = (totalFactionCount / augmentArray.length).toFixed(2)

  ns.tprint(`Statistics:`)
  ns.tprint(`  - Total augmentations: ${augmentArray.length}`)
  ns.tprint(`  - Average factions per augmentation: ${avgFactionsPerAug}`)
  ns.tprint(`  - Augmentations with multiple factions: ${augmentArray.filter((a) => a.factions.length > 1).length}`)
  ns.tprint(`  - Augmentations exclusive to one faction: ${augmentArray.filter((a) => a.factions.length === 1).length}`)
}
